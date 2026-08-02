import { routeAgentRequest } from "agents";
import { AgentSearchProvider } from "agents/experimental/memory/session";
import { createOpenAI } from "@ai-sdk/openai";
import {
  Session,
  Think,
  type ToolCallResultContext,
  type TurnContext
} from "@cloudflare/think";
import { createGatewayProvider } from "workers-ai-provider/gateway";

export class ThinkAgent extends Think<Env> {
  getModel() {
    const openai = createGatewayProvider(createOpenAI, {
      binding: this.env.AI,
      gateway: this.env.AI_GATEWAY_ID || "default"
    });
    const modelId = (this.env.MODEL || "openai/gpt-5.6-luna").replace(
      /^openai\//,
      ""
    );

    return openai.responses(modelId);
  }

  beforeTurn(ctx: TurnContext) {
    console.log("[system prompt]", ctx.system);

    return {
      providerOptions: {
        openai: { reasoningEffort: "none" }
      }
    };
  }

  async afterToolCall(ctx: ToolCallResultContext) {
    if (ctx.toolName === "set_context") {
      await this.session.refreshSystemPrompt();
    }
  }

  configureSession(session: Session) {
    return session
      .withContext("soul", {
        provider: {
          get: async () =>
            [
              "You are a helpful, concise assistant.",
              "Answer in the user's language.",
              "Use the memory block for short facts that should be visible on every turn.",
              "Use the searchable knowledge block for durable project details and search it before answering project-specific questions.",
              "Treat memory and knowledge as shared workspace context, not private user storage.",
              "Do not store secrets, credentials, or other sensitive personal data in either block."
            ].join(" ")
        }
      })
      .withContext("memory", {
        description:
          "Important durable facts about the user's preferences, projects, and ongoing context.",
        maxTokens: 2000
      })
      .withContext("knowledge", {
        description: [
          "Searchable long-term knowledge for this shared workspace.",
          "Store durable project facts, design decisions, and stable notes as separate keyed entries.",
          "Search this block before answering project-specific questions.",
          "Do not store secrets, credentials, or temporary conversation details."
        ].join(" "),
        provider: new AgentSearchProvider(this)
      })
      .withCachedPrompt();
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
