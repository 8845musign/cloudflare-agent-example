import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { guessMediaType, normalizePath, type AsyncFS } from "./fs";
import type { BrowserClient } from "./browser";

export interface ToolDeps {
  fs: AsyncFS;
  browser: BrowserClient;
}

export function createTools({ fs, browser }: ToolDeps): ToolSet {
  return {
    list_files: tool({
      description:
        "List all files in the workspace with size and last-updated time",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await fs.list();
        return files.length > 0 ? files : "The workspace is empty.";
      }
    }),

    read_file: tool({
      description: "Read the content of a text file in the workspace",
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative path, e.g. notes/todo.md")
      }),
      execute: async ({ path }) => {
        const normalized = normalizePath(path);
        const file = normalized ? await fs.get(normalized) : null;
        if (!file || !normalized) {
          return { error: `File not found: ${path}` };
        }
        if (file.mediaType.startsWith("image/")) {
          return {
            path: normalized,
            mediaType: file.mediaType,
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
        await fs.put(
          normalized,
          new TextEncoder().encode(content),
          guessMediaType(normalized)
        );
        return { ok: true, path: normalized, bytes: content.length };
      }
    }),

    delete_file: tool({
      description: "Delete a file from the workspace. Requires user approval.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Workspace-relative path of the file to delete")
      }),
      needsApproval: true,
      execute: async ({ path }) => {
        const normalized = normalizePath(path);
        // Single RPC: delete reports whether the file existed, avoiding a
        // separate get() that could race another session's mutation.
        if (!normalized || !(await fs.delete(normalized))) {
          return { error: `File not found: ${path}` };
        }
        return { ok: true, deleted: normalized };
      }
    }),

    fetch_page: tool({
      description:
        "Open a URL in a headless browser and return the page title and readable text content",
      inputSchema: z.object({
        url: z.url().describe("Absolute URL to open, e.g. https://example.com")
      }),
      execute: async ({ url }) => {
        try {
          return await browser.fetchPage(url);
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
          .describe("Optional workspace path for the PNG, e.g. shots/top.png")
      }),
      execute: async ({ url, path }) => {
        try {
          const png = await browser.screenshot(url);
          const fallback = `screenshots/${new URL(url).hostname}-${Date.now()}.png`;
          const normalized = normalizePath(path ?? fallback) ?? fallback;
          await fs.put(normalized, png, "image/png");
          return { ok: true, url, path: normalized };
        } catch (error) {
          return { error: `Failed to capture ${url}: ${error}` };
        }
      }
    })
  };
}
