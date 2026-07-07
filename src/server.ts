import { createGoogleGenerativeAI } from "@ai-sdk/google";
import puppeteer, {
  type BrowserWorker,
  type Page
} from "@cloudflare/puppeteer";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";

export interface FileMeta {
  path: string;
  size: number;
  mediaType: string;
  updatedAt: string;
}

export interface WorkspaceState {
  files: FileMeta[];
}

const MAX_PAGE_TEXT = 20_000;

const TEXT_MEDIA_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  html: "text/html",
  css: "text/css",
  csv: "text/csv",
  js: "text/javascript",
  ts: "text/typescript"
};

function guessMediaType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_MEDIA_TYPES[ext] ?? "text/plain";
}

// Reject absolute paths and traversal; collapse to a clean relative path
function normalizePath(raw: string): string | null {
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

export class ChatAgent extends AIChatAgent<Env, WorkspaceState> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  initialState: WorkspaceState = { files: [] };

  onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        content BLOB NOT NULL,
        media_type TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
    this.syncFiles();
  }

  // ── Virtual filesystem (rows in the agent's SQLite) ──────────────────

  private syncFiles() {
    const rows = this.sql<{
      path: string;
      size: number;
      media_type: string;
      updated_at: string;
    }>`
      SELECT path, length(content) AS size, media_type, updated_at
      FROM files ORDER BY path
    `;
    this.setState({
      files: rows.map((r) => ({
        path: r.path,
        size: r.size,
        mediaType: r.media_type,
        updatedAt: r.updated_at
      }))
    });
  }

  private putFile(path: string, content: Uint8Array, mediaType: string) {
    // this.sql`` does not accept BLOB params, so use the raw SQL API here
    this.ctx.storage.sql.exec(
      `INSERT INTO files (path, content, media_type, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         content = excluded.content,
         media_type = excluded.media_type,
         updated_at = excluded.updated_at`,
      path,
      content.buffer as ArrayBuffer,
      mediaType,
      new Date().toISOString()
    );
    this.syncFiles();
  }

  private getFile(path: string) {
    const rows = this.sql<{ content: ArrayBuffer; media_type: string }>`
      SELECT content, media_type FROM files WHERE path = ${path}
    `;
    return rows[0] ?? null;
  }

  // Serve raw file content so the UI (and screenshots in chat) can load it
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/file")) {
      const path = normalizePath(url.searchParams.get("path") ?? "");
      const file = path ? this.getFile(path) : null;
      if (!file) return new Response("Not found", { status: 404 });
      return new Response(file.content, {
        headers: {
          "content-type": file.media_type,
          "cache-control": "no-store"
        }
      });
    }
    return super.onRequest(request);
  }

  // ── Browser Rendering ─────────────────────────────────────────────────

  private async withPage<T>(
    url: string,
    fn: (page: Page) => Promise<T>
  ): Promise<T> {
    const browser = await puppeteer.launch(this.env.BROWSER as BrowserWorker);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
      return await fn(page);
    } finally {
      await browser.close();
    }
  }

  // ── Chat loop ─────────────────────────────────────────────────────────

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const google = createGoogleGenerativeAI({
      apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY
    });

    const result = streamText({
      model: google(this.env.MODEL || "gemini-2.5-flash"),
      system: `You are a coding-assistant-style agent with a persistent workspace of files and a headless browser.

Workspace rules:
- Files live in a flat virtual filesystem (paths like "notes/todo.md"). Use list_files / read_file freely.
- write_file and delete_file require the user's approval in the UI; if a call is rejected, ask what to do instead of retrying.
- When you gather content from the web that the user wants to keep, save it with write_file.

Browser rules:
- fetch_page opens a URL and returns the page title and readable text (browsing only — you cannot click or type).
- screenshot captures a page and saves it as a PNG file in the workspace; it is shown to the user in chat automatically.

Answer in the user's language.`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        list_files: tool({
          description:
            "List all files in the workspace with size and last-updated time",
          inputSchema: z.object({}),
          execute: async () => {
            const files = this.state.files;
            return files.length > 0 ? files : "The workspace is empty.";
          }
        }),

        read_file: tool({
          description: "Read the content of a text file in the workspace",
          inputSchema: z.object({
            path: z
              .string()
              .describe("Workspace-relative path, e.g. notes/todo.md")
          }),
          execute: async ({ path }) => {
            const normalized = normalizePath(path);
            const file = normalized ? this.getFile(normalized) : null;
            if (!file || !normalized) {
              return { error: `File not found: ${path}` };
            }
            if (file.media_type.startsWith("image/")) {
              return {
                path: normalized,
                mediaType: file.media_type,
                note: "Binary image file — content not readable as text."
              };
            }
            return {
              path: normalized,
              content: new TextDecoder().decode(file.content)
            };
          }
        }),

        write_file: tool({
          description:
            "Create or overwrite a text file in the workspace. Requires user approval.",
          inputSchema: z.object({
            path: z
              .string()
              .describe("Workspace-relative path, e.g. notes/todo.md"),
            content: z.string().describe("Full text content of the file")
          }),
          needsApproval: true,
          execute: async ({ path, content }) => {
            const normalized = normalizePath(path);
            if (!normalized) return { error: `Invalid path: ${path}` };
            this.putFile(
              normalized,
              new TextEncoder().encode(content),
              guessMediaType(normalized)
            );
            return { ok: true, path: normalized, bytes: content.length };
          }
        }),

        delete_file: tool({
          description:
            "Delete a file from the workspace. Requires user approval.",
          inputSchema: z.object({
            path: z
              .string()
              .describe("Workspace-relative path of the file to delete")
          }),
          needsApproval: true,
          execute: async ({ path }) => {
            const normalized = normalizePath(path);
            if (!normalized || !this.getFile(normalized)) {
              return { error: `File not found: ${path}` };
            }
            this.sql`DELETE FROM files WHERE path = ${normalized}`;
            this.syncFiles();
            return { ok: true, deleted: normalized };
          }
        }),

        fetch_page: tool({
          description:
            "Open a URL in a headless browser and return the page title and readable text content",
          inputSchema: z.object({
            url: z
              .url()
              .describe("Absolute URL to open, e.g. https://example.com")
          }),
          execute: async ({ url }) => {
            try {
              return await this.withPage(url, async (page) => {
                const title = await page.title();
                const text = await page.evaluate(
                  () => document.body?.innerText ?? ""
                );
                return {
                  url,
                  title,
                  truncated: text.length > MAX_PAGE_TEXT,
                  text: text.slice(0, MAX_PAGE_TEXT)
                };
              });
            } catch (error) {
              return { error: `Failed to load ${url}: ${error}` };
            }
          }
        }),

        screenshot: tool({
          description:
            "Take a screenshot of a web page and save it as a PNG file in the workspace",
          inputSchema: z.object({
            url: z.url().describe("Absolute URL to capture"),
            path: z
              .string()
              .optional()
              .describe(
                "Optional workspace path for the PNG, e.g. shots/top.png"
              )
          }),
          execute: async ({ url, path }) => {
            try {
              return await this.withPage(url, async (page) => {
                const png = (await page.screenshot({
                  type: "png"
                })) as Uint8Array;
                const fallback = `screenshots/${new URL(url).hostname}-${Date.now()}.png`;
                const normalized = normalizePath(path ?? fallback) ?? fallback;
                this.putFile(normalized, new Uint8Array(png), "image/png");
                return { ok: true, url, path: normalized };
              });
            } catch (error) {
              return { error: `Failed to capture ${url}: ${error}` };
            }
          }
        })
      },
      stopWhen: stepCountIs(10),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
