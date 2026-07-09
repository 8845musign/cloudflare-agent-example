import { routeAgentRequest } from "agents";
import { Hono } from "hono";

export { ChatAgent } from "./agent";
export { ArtifactStore } from "./artifact";
export { NewsWorkflow } from "./workflows";

const app = new Hono<{ Bindings: Env }>();

// Agent traffic (chat WebSocket, agent HTTP routes) is handled by the SDK.
app.all("/agents/*", async (c) => {
  const response = await routeAgentRequest(c.req.raw, c.env);
  return response ?? c.notFound();
});

export default app;
