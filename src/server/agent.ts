import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import { callable, getAgentByName, type AgentContext } from "agents";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ToolSet,
  type UIMessage
} from "ai";
import type { ArtifactStore } from "./artifact";
import { BrowserClient } from "./browser";
import {
  guessMediaType,
  normalizePath,
  type AsyncFS,
  type NewsRun,
  type WorkspaceState
} from "./fs";
import { SYSTEM_PROMPT } from "./prompt";
import { createTools } from "./tools";
import type { NewsProgress } from "./workflows";

export type { FileMeta, NewsRun, WorkspaceState } from "./fs";

// Fixed name of the single shared artifact store (see `artifact.ts`).
const ARTIFACT_NAME = "shared";

export class ChatAgent extends AIChatAgent<Env, WorkspaceState> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  initialState: WorkspaceState = { files: [] };

  private readonly fs: AsyncFS;
  private readonly tools: ToolSet;
  private storePromise?: Promise<DurableObjectStub<ArtifactStore>>;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    this.fs = this.artifactFs();
    this.tools = createTools({
      fs: this.fs,
      browser: new BrowserClient(this.env.BROWSER as BrowserWorker)
    });
  }

  // Cached stub for the shared ArtifactStore DO.
  private store(): Promise<DurableObjectStub<ArtifactStore>> {
    this.storePromise ??= getAgentByName(this.env.ArtifactStore, ARTIFACT_NAME);
    return this.storePromise;
  }

  // Async filesystem backed by DO-to-DO RPC into the shared ArtifactStore.
  private artifactFs(): AsyncFS {
    return {
      list: async () => (await this.store()).listFiles(),
      get: async (path) => (await this.store()).readFile(path),
      put: async (path, content, mediaType) => {
        // Send a tight ArrayBuffer so a subarray view doesn't drag its whole
        // backing buffer across the RPC boundary.
        const buffer =
          content.byteOffset === 0 &&
          content.byteLength === content.buffer.byteLength
            ? (content.buffer as ArrayBuffer)
            : (content.slice().buffer as ArrayBuffer);
        await (await this.store()).writeFile(path, buffer, mediaType);
      },
      delete: async (path) => (await this.store()).deleteFile(path)
    };
  }

  private model(): LanguageModel {
    const google = createGoogleGenerativeAI({
      apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY
    });
    return google(this.env.MODEL || "gemini-2.5-flash");
  }

  // ── News runbook (NewsWorkflow) ─────────────────────────────────────

  @callable()
  async startNewsRunbook(): Promise<NewsRun> {
    const current = this.state.newsRun;
    if (current?.status === "running") return current;

    // Claim "running" synchronously BEFORE any await, so a second click /
    // re-entry can't slip past the guard and start a duplicate workflow.
    // All speaking/thinking ordering is owned by the workflow itself.
    const messageId = `assistant_news_${Date.now()}`;
    this.setState({
      ...this.state,
      newsRun: { status: "running", workflowId: "", messageId, thinking: "" }
    });

    const workflowId = await this.runWorkflow("NEWS_WORKFLOW", {});
    const newsRun: NewsRun = {
      status: "running",
      workflowId,
      messageId,
      thinking: ""
    };
    this.setState({ ...this.state, newsRun });
    return newsRun;
  }

  // Called over RPC by NewsWorkflow's "save" step. Writes go to the shared
  // artifact store, same as the chat tools.
  async writeWorkspaceFile(path: string, content: string) {
    const normalized = normalizePath(path);
    if (!normalized) throw new Error(`Invalid path: ${path}`);
    await this.fs.put(
      normalized,
      new TextEncoder().encode(content),
      guessMediaType(normalized)
    );
    return { ok: true, path: normalized };
  }

  // Push the workflow's progress/thinking/result into the chat session as a
  // single assistant message that is updated in place across the run.
  private async upsertNewsMessage(
    run: NewsRun,
    text: string,
    thinkingDone: boolean
  ) {
    if (!run.messageId) return;

    const parts: UIMessage["parts"] = [];
    if (run.thinking) {
      parts.push({
        type: "reasoning",
        text: run.thinking,
        state: thinkingDone ? "done" : "streaming"
      });
    }
    parts.push({ type: "text", text });
    const message = {
      id: run.messageId,
      role: "assistant",
      parts
    } as UIMessage;

    // Serialize against any in-flight chat turn before writing history.
    await this.waitUntilStable({ timeout: 15_000 });
    const exists = this.messages.some((m) => m.id === run.messageId);
    const next = exists
      ? this.messages.map((m) => (m.id === run.messageId ? message : m))
      : [...this.messages, message];
    await this.persistMessages(next);
  }

  async onWorkflowProgress(
    _workflowName: string,
    workflowId: string,
    progress: unknown
  ) {
    const current = this.state.newsRun;
    if (current?.workflowId !== workflowId) return;

    const { message, thinking, say } = progress as NewsProgress;

    // A `say` event is the spoken line: it sets the message text, not reasoning.
    if (say !== undefined) {
      const next: NewsRun = { ...current, say };
      this.setState({ ...this.state, newsRun: next });
      await this.upsertNewsMessage(next, say, false);
      return;
    }

    const entry = thinking
      ? `${message}\n\n> ${thinking.replace(/\n/g, "\n> ")}`
      : message;
    const buffer = current.thinking ? `${current.thinking}\n\n${entry}` : entry;
    const next: NewsRun = { ...current, step: message, thinking: buffer };

    this.setState({ ...this.state, newsRun: next });
    await this.upsertNewsMessage(
      next,
      current.say ?? "📰 ニュースを収集中…",
      false
    );
  }

  async onWorkflowComplete(
    _workflowName: string,
    workflowId: string,
    result?: unknown
  ) {
    const current = this.state.newsRun;
    if (current?.workflowId !== workflowId) return;

    const { path } = (result ?? {}) as { path?: string };
    let body = "✅ ニュースを保存しました。";
    const file = path ? await this.fs.get(path) : null;
    if (file) body = new TextDecoder().decode(file.content);
    if (path) {
      const url = `/agents/artifact-store/${ARTIFACT_NAME}/file?path=${encodeURIComponent(path)}&download=1`;
      body += `\n\n---\n\n[📥 Markdownをダウンロード (${path})](${url})`;
    }

    const next: NewsRun = { ...current, status: "done", step: undefined, path };
    this.setState({ ...this.state, newsRun: next });
    await this.upsertNewsMessage(next, body, true);
  }

  async onWorkflowError(
    _workflowName: string,
    workflowId: string,
    error: string
  ) {
    const current = this.state.newsRun;
    if (current?.workflowId !== workflowId) return;

    const next: NewsRun = {
      ...current,
      status: "error",
      step: undefined,
      error
    };
    this.setState({ ...this.state, newsRun: next });
    await this.upsertNewsMessage(
      next,
      `❌ ニュース収集に失敗しました: ${error}`,
      true
    );
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const result = streamText({
      model: this.model(),
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
