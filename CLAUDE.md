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

Single Worker serving both the API and the SPA, backed by **two Durable Object classes**: `ChatAgent` (conversation history + tool execution, subclassing `AIChatAgent` from `@cloudflare/ai-chat`) and `ArtifactStore` (the shared virtual filesystem, subclassing `Agent` from `agents`). Both are exported from the main module `src/server/index.ts` (required for `wrangler.jsonc` `class_name` resolution).

**Request flow:** `src/server/index.ts` is the Worker entry (Hono). It forwards `/agents/*` to `routeAgentRequest` (the Agents SDK), which dispatches to a `ChatAgent` or `ArtifactStore` instance by kebab-cased class name. Everything else is served as static SPA assets (`wrangler.jsonc` `assets`, with `run_worker_first: ["/agents/*"]`).

**Two DOs, two lifetimes.** `ChatAgent` is **per workspace** — its instance name comes from the URL: `/` → `default`, `/w/:name` → `:name` (`src/app.tsx` `getWorkspaceFromUrl`); switching workspace is a full navigation. `ArtifactStore` is a **single shared instance** addressed by the fixed name `"shared"`, so files are common across all workspaces/sessions. Client-side, `useAgent({ agent: "ChatAgent" })` uses the `chat-agent` path segment and `useAgent({ agent: "ArtifactStore" })` / raw file URLs use `artifact-store`.

**ChatAgent → ArtifactStore RPC:** `ChatAgent` owns no filesystem. Its tools go through an async `AsyncFS` adapter (`agent.ts` `artifactFs()`) that calls the shared store over DO-to-DO RPC via `getAgentByName(this.env.ArtifactStore, "shared")`. `ArtifactStore` exposes plain public methods (`listFiles`/`readFile`/`writeFile`/`deleteFile`) — deliberately **not** `@callable`, since `@callable` would also expose them to browser WebSocket RPC and let the client bypass the `write_file`/`delete_file` approval flow. `ArtifactStore.validateStateChange` rejects client-originated state mutations for the same reason.

**`ArtifactStore.onRequest` fall-through (`src/server/artifact.ts` + `routes.ts`):** the store first runs its own Hono router (serves `GET /agents/:agent/:name/file?path=` for raw file content, used by the file panel and in-chat screenshots). If no route matches, the router returns a 404 carrying the `UNMATCHED_HEADER`; `onRequest` detects that header and falls through to `super.onRequest` (the base WebSocket/state handler). Don't remove the header check — it's how custom routes coexist with the SDK's built-in handling.

**Virtual filesystem (`src/server/fs.ts`):** `WorkspaceFS` is a flat `files` table in the `ArtifactStore` DO's embedded SQLite (`this.ctx.storage.sql`). Every mutation calls an `onChange` callback wired to `ArtifactStore`'s `this.setState({ files })`, so file-list metadata syncs live to the UI — the client subscribes with a second `useAgent({ agent: "ArtifactStore", name: "shared" })` connection (`onStateUpdate` in `app.tsx`), separate from the chat connection. All tool paths go through `normalizePath`, which rejects absolute paths and `..` traversal — keep using it for any new path input. Tools depend on the `AsyncFS` interface (also in `fs.ts`), not `WorkspaceFS` directly.

**Tools (`src/server/tools.ts`):** built with the Vercel AI SDK `tool()` helper, wired up once in the `ChatAgent` constructor against an `AsyncFS` (RPC-backed) adapter. `write_file` and `delete_file` set `needsApproval: true` (human-in-the-loop) — the UI renders Approve/Reject buttons and calls `addToolApprovalResponse`; approval is enforced in `ChatAgent`'s tool loop before the RPC to `ArtifactStore` runs. `fetch_page`/`screenshot` use `BrowserClient` (`browser.ts`), a thin Puppeteer wrapper that launches and closes a fresh browser per call.

**LLM (`onChatMessage`):** streams from Google Gemini via `@ai-sdk/google`. Model is `env.MODEL` (default `gemini-2.5-flash`, set in `wrangler.jsonc` `vars`). `stopWhen: stepCountIs(10)` caps the agentic tool loop; `pruneMessages` trims old tool calls from context. System prompt is in `src/server/prompt.ts`.

**Client (`src/app.tsx`):** single file. React 19 + Vite + Tailwind v4 + `@cloudflare/kumo` components. Uses `useAgent` + `useAgentChat`. Two-pane layout (chat left, file panel right). Supports image attachments (sent as data-URI file parts) and renders tool/reasoning/image/text message parts distinctly.

## Conventions

- Formatting/linting is **oxfmt + oxlint** (not prettier/eslint despite a `.prettierignore`). Run `npm run check` before considering work done.
- Server code is split by concern under `src/server/` (`agent`, `artifact`, `routes`, `tools`, `fs`, `browser`, `prompt`, `index`); keep new server logic in the matching module rather than growing `agent.ts`.
- After changing `wrangler.jsonc` bindings or vars, run `npm run types` so `Env` in `env.d.ts` stays accurate.
