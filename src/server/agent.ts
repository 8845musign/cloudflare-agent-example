import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import { callable, type AgentContext } from "agents";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type ToolSet
} from "ai";
import type { Hono } from "hono";
import { BrowserClient } from "./browser";
import {
  guessMediaType,
  normalizePath,
  WorkspaceFS,
  type NewsRun,
  type WorkspaceState
} from "./fs";
import { SYSTEM_PROMPT } from "./prompt";
import { createAgentRoutes, UNMATCHED_HEADER } from "./routes";
import { createTools } from "./tools";
import type { NewsProgress } from "./workflows";

export type { FileMeta, NewsRun, WorkspaceState } from "./fs";

export class ChatAgent extends AIChatAgent<Env, WorkspaceState> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  initialState: WorkspaceState = { files: [] };

  private readonly fs: WorkspaceFS;
  private readonly routes: Hono;
  private readonly tools: ToolSet;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    this.fs = new WorkspaceFS(this.ctx.storage.sql, (files) =>
      this.setState({ ...this.state, files })
    );
    this.routes = createAgentRoutes(this.fs);
    this.tools = createTools({
      fs: this.fs,
      browser: new BrowserClient(this.env.BROWSER as BrowserWorker)
    });
  }

  onStart() {
    this.fs.init();
  }

  async onRequest(request: Request): Promise<Response> {
    const response = await this.routes.fetch(request);
    // Fall through to the base chat handler only when no route matched.
    if (response.headers.has(UNMATCHED_HEADER)) return super.onRequest(request);
    return response;
  }

  // ── News runbook (NewsWorkflow) ─────────────────────────────────────

  @callable()
  async startNewsRunbook(): Promise<NewsRun> {
    const current = this.state.newsRun;
    if (current?.status === "running") return current;

    const workflowId = await this.runWorkflow("NEWS_WORKFLOW", {});
    const newsRun: NewsRun = { status: "running", workflowId };
    this.setState({ ...this.state, newsRun });
    return newsRun;
  }

  // Called over RPC by NewsWorkflow's "save" step.
  async writeWorkspaceFile(path: string, content: string) {
    const normalized = normalizePath(path);
    if (!normalized) throw new Error(`Invalid path: ${path}`);
    this.fs.put(
      normalized,
      new TextEncoder().encode(content),
      guessMediaType(normalized)
    );
    return { ok: true, path: normalized };
  }

  private updateNewsRun(workflowId: string, patch: Partial<NewsRun>) {
    const current = this.state.newsRun;
    if (current?.workflowId !== workflowId) return;
    this.setState({ ...this.state, newsRun: { ...current, ...patch } });
  }

  async onWorkflowProgress(
    _workflowName: string,
    workflowId: string,
    progress: unknown
  ) {
    const { message } = progress as NewsProgress;
    this.updateNewsRun(workflowId, { step: message });
  }

  async onWorkflowComplete(
    _workflowName: string,
    workflowId: string,
    result?: unknown
  ) {
    const { path } = (result ?? {}) as { path?: string };
    this.updateNewsRun(workflowId, { status: "done", step: undefined, path });
  }

  async onWorkflowError(
    _workflowName: string,
    workflowId: string,
    error: string
  ) {
    this.updateNewsRun(workflowId, { status: "error", step: undefined, error });
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const google = createGoogleGenerativeAI({
      apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY
    });

    const result = streamText({
      model: google(this.env.MODEL || "gemini-2.5-flash"),
      system: SYSTEM_PROMPT,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: this.tools,
      stopWhen: stepCountIs(10),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}
