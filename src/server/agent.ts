import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import type { AgentContext } from "agents";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type ToolSet
} from "ai";
import type { Hono } from "hono";
import { BrowserClient } from "./browser";
import { WorkspaceFS, type WorkspaceState } from "./fs";
import { SYSTEM_PROMPT } from "./prompt";
import { createAgentRoutes, UNMATCHED_HEADER } from "./routes";
import { createTools } from "./tools";

export type { FileMeta, WorkspaceState } from "./fs";

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
      this.setState({ files })
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
