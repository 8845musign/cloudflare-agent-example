# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A learning/demo Claude Code-style chat agent on Cloudflare: a headless browser plus a persistent per-workspace virtual filesystem, exposed through a React chat UI. Not for production — no auth, no rate limiting (see `REQUIREMENTS.md`).

## Commands

```sh
npm run dev        # vite dev (local Worker + client)
npm run deploy     # vite build && wrangler deploy
npm run types      # regenerate env.d.ts from wrangler.jsonc bindings — run after changing bindings/vars
npm run check      # oxfmt --check + oxlint src/ + tsc (full gate)
npm run lint       # oxlint src/ only
npm run format     # oxfmt --write .
```

There is no test suite. Local dev **requires `npx wrangler login`** even offline: Browser Rendering (`browser.remote: true`) always executes remotely. Copy `.dev.vars.example` → `.dev.vars` and set `GOOGLE_GENERATIVE_AI_API_KEY`; for deploy use `npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY`.

## Architecture

Single Worker serving both the API and the SPA. The whole agent (conversation history, files, tool execution) lives in one Durable Object, `ChatAgent`, subclassing `AIChatAgent` from `@cloudflare/ai-chat`.

**Request flow:** `src/server/index.ts` is the Worker entry (Hono). It forwards `/agents/*` to `routeAgentRequest` (the Agents SDK), which dispatches to a `ChatAgent` instance. Everything else is served as static SPA assets (`wrangler.jsonc` `assets`, with `run_worker_first: ["/agents/*"]`).

**One workspace = one DO instance.** The instance name comes from the URL: `/` → `default`, `/w/:name` → `:name` (`src/app.tsx` `getWorkspaceFromUrl`). Switching workspace is a full navigation. Note the Agents SDK naming convention: the DO class is `ChatAgent`, the client's `useAgent({ agent: "ChatAgent" })` and raw file URLs use the kebab-cased `chat-agent` path segment.

**`ChatAgent.onRequest` fall-through (`src/server/agent.ts` + `routes.ts`):** the agent first runs its own Hono router (serves `GET /agents/:agent/:name/file?path=` for raw file content, used by the file panel and in-chat screenshots). If no route matches, the router returns a 404 carrying the `UNMATCHED_HEADER`; `onRequest` detects that header and falls through to `super.onRequest` (the base chat/WebSocket handler). Don't remove the header check — it's how custom routes coexist with the SDK's built-in handling.

**Virtual filesystem (`src/server/fs.ts`):** `WorkspaceFS` is a flat `files` table in the DO's embedded SQLite (`this.ctx.storage.sql`). Every mutation calls an `onChange` callback wired to `this.setState({ files })`, so file-list metadata syncs to the UI live via Agents state sync (`onStateUpdate` in `app.tsx`). All tool paths go through `normalizePath`, which rejects absolute paths and `..` traversal — keep using it for any new path input.

**Tools (`src/server/tools.ts`):** built with the Vercel AI SDK `tool()` helper, wired up once in the `ChatAgent` constructor. `write_file` and `delete_file` set `needsApproval: true` (human-in-the-loop) — the UI renders Approve/Reject buttons and calls `addToolApprovalResponse`. `fetch_page`/`screenshot` use `BrowserClient` (`browser.ts`), a thin Puppeteer wrapper that launches and closes a fresh browser per call.

**LLM (`onChatMessage`):** streams from Google Gemini via `@ai-sdk/google`. Model is `env.MODEL` (default `gemini-2.5-flash`, set in `wrangler.jsonc` `vars`). `stopWhen: stepCountIs(10)` caps the agentic tool loop; `pruneMessages` trims old tool calls from context. System prompt is in `src/server/prompt.ts`.

**Client (`src/app.tsx`):** single file. React 19 + Vite + Tailwind v4 + `@cloudflare/kumo` components. Uses `useAgent` + `useAgentChat`. Two-pane layout (chat left, file panel right). Supports image attachments (sent as data-URI file parts) and renders tool/reasoning/image/text message parts distinctly.

## Conventions

- Formatting/linting is **oxfmt + oxlint** (not prettier/eslint despite a `.prettierignore`). Run `npm run check` before considering work done.
- Server code is split by concern under `src/server/` (`agent`, `routes`, `tools`, `fs`, `browser`, `prompt`, `index`); keep new server logic in the matching module rather than growing `agent.ts`.
- After changing `wrangler.jsonc` bindings or vars, run `npm run types` so `Env` in `env.d.ts` stays accurate.
