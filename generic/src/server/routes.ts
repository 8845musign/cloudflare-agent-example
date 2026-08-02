import { Hono } from "hono";
import { normalizePath, type WorkspaceFS } from "./fs";

// Marks a 404 that means "no route matched here" (as opposed to a route
// matching but the resource being absent). ChatAgent.onRequest uses it to
// decide whether to fall through to the base AIChatAgent handler.
export const UNMATCHED_HEADER = "x-agent-route-unmatched";

// HTTP routes served from inside the agent (mounted by ChatAgent.onRequest).
// Serves raw file content so the UI and in-chat screenshots can load it.
export function createAgentRoutes(fs: WorkspaceFS): Hono {
  const app = new Hono();

  app.get("/agents/:agent/:name/file", (c) => {
    const path = normalizePath(c.req.query("path") ?? "");
    const file = path ? fs.get(path) : null;
    if (!file) return new Response("File not found", { status: 404 });
    return new Response(file.content, {
      headers: {
        "content-type": file.mediaType,
        "cache-control": "no-store"
      }
    });
  });

  app.notFound(
    () =>
      new Response(null, { status: 404, headers: { [UNMATCHED_HEADER]: "1" } })
  );

  return app;
}
