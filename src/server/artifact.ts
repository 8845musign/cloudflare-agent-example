import { Agent, type AgentContext, type Connection } from "agents";
import type { Hono } from "hono";
import {
  WorkspaceFS,
  type FileMeta,
  type StoredFile,
  type WorkspaceState
} from "./fs";
import { createAgentRoutes, UNMATCHED_HEADER } from "./routes";

// Shared artifact store. One instance (addressed by the fixed name "shared")
// backs the virtual filesystem for every ChatAgent workspace, so files are
// common across sessions. ChatAgents mutate it over DO-to-DO RPC; the client
// subscribes to its state for a live file list.
export class ArtifactStore extends Agent<Env, WorkspaceState> {
  initialState: WorkspaceState = { files: [] };

  private readonly fs: WorkspaceFS;
  private readonly routes: Hono;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    this.fs = new WorkspaceFS(this.ctx.storage.sql, (files) =>
      this.setState({ files })
    );
    this.routes = createAgentRoutes(this.fs);
  }

  onStart() {
    this.fs.init();
  }

  // The file list is server-owned. Clients subscribe read-only, so reject any
  // state mutation that originates from a connection.
  validateStateChange(_next: WorkspaceState, source: Connection | "server") {
    if (source !== "server") {
      throw new Error("Artifact state is read-only for clients");
    }
  }

  async onRequest(request: Request): Promise<Response> {
    const response = await this.routes.fetch(request);
    // Fall through to the base handler only when no route matched.
    if (response.headers.has(UNMATCHED_HEADER)) return super.onRequest(request);
    return response;
  }

  // ── Internal RPC (invoked by ChatAgent via getAgentByName) ──────────────
  // Deliberately NOT marked @callable: @callable would expose these over the
  // browser WebSocket RPC too, letting the client mutate files directly and
  // bypass the write/delete approval flow enforced in ChatAgent's tool loop.
  listFiles(): FileMeta[] {
    return this.fs.list();
  }

  readFile(path: string): StoredFile | null {
    return this.fs.get(path);
  }

  writeFile(path: string, content: ArrayBuffer, mediaType: string): void {
    this.fs.put(path, new Uint8Array(content), mediaType);
  }

  deleteFile(path: string): boolean {
    const existed = this.fs.get(path) !== null;
    this.fs.delete(path);
    return existed;
  }
}
