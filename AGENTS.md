# AGENTS.md — OpenMAIC

## Quick commands

| Task | Command |
|------|---------|
| Dev server | `pnpm dev` (port 3000) |
| Production build | `pnpm build && pnpm start` |
| Format check | `pnpm check` (Prettier) |
| Format fix | `pnpm format` |
| Lint | `pnpm lint` (ESLint flat config) |
| Typecheck | `npx tsc --noEmit` (no separate script) |
| i18n key check | `pnpm check:i18n-keys` |
| Unit tests | `pnpm test` (vitest) |
| E2E tests | `pnpm test:e2e` (playwright, port 3002) |

**Check-local order** (same as CI): `pnpm check → pnpm lint → npx tsc --noEmit → pnpm check:i18n-keys → pnpm test`

## Monorepo

- Package manager: **pnpm 10** (lockfile: `pnpm-lock.yaml`, CI uses `--frozen-lockfile`)
- Workspace packages in `packages/`: `pptxgenjs`, `mathml2omml`
- `postinstall` auto-builds both workspace packages. If you modify them, run `pnpm install` again to rebuild.
- `packages/` is vendored code — excluded from ESLint, Prettier, and TypeScript (`tsconfig.json` excludes `packages/*/src`).

## Imports & aliases

- `@/*` maps to the **project root** (not `src/`). Example: `@/lib/store` → `./lib/store`.
- Monorepo workspace packages are imported by name: `import "pptxgenjs"`, `import "mathml2omml"`.
- `next.config.ts` has `transpilePackages: ['mathml2omml', 'pptxgenjs']` — required because they are local workspace packages.

## Env config (two mechanisms)

1. **`.env.local`** — traditional env vars (copy from `.env.example`). At least one LLM API key is needed.
2. **`server-providers.yml`** — alternative YAML config (gitignored). Use either this or env vars, not both.

Key env vars:
- Per-provider: `{PROVIDER}_API_KEY`, `{PROVIDER}_BASE_URL`, `{PROVIDER}_MODELS`
- `DEFAULT_MODEL` — server-side model default (e.g. `google:gemini-3-flash-preview`)
- `ALLOW_LOCAL_NETWORKS=true` — required for Ollama/self-hosted LLMs (blocks localhost URLs otherwise)
- `ACCESS_CODE` — optional site-wide password
- `ALLOWED_FRAME_ANCESTORS` — extra iframe embedders for CSP

## Styling

- **Tailwind CSS 4** with CSS-first config (NO `tailwind.config.ts`). Theme tokens in `app/globals.css` via `@theme inline`.
- Uses `shadcn/ui` + `tw-animate-css`. Dark mode via `.dark` class (`@custom-variant dark (&:is(.dark *))`).
- **Prettier**: `100` printWidth, `singleQuote`, `trailingComma: all`, `endOfLine: lf`.

## TypeScript

- `strict: true`, `noEmit: true` (tsc for checking only; Next.js does the actual build).
- `moduleResolution: "bundler"`, `isolatedModules: true`, `skipLibCheck: true`.
- Unused vars with `_` prefix are allowed (ESLint rule: `argsIgnorePattern: '^_'`, etc.).

## Testing

- **Vitest**: config in `vitest.config.ts`, tests in `tests/**/*.test.ts`, setup loads `.env.local` from `tests/setup-env.ts`.
- **Playwright**: config in `playwright.config.ts`, tests in `e2e/tests/`, baseURL `http://localhost:3002` (not 3000!), uses `PORT=3002`. CI builds before running e2e.
- Both e2e and unit tests require `.env.local` with API keys to pass.

## Build & deploy

- `next.config.ts`: `output: process.env.VERCEL ? undefined : 'standalone'`. On Vercel: standard output. Elsewhere (Docker, self-host): standalone Node.js server.
- Docker: multi-stage build. Requires `pnpm install` (builds workspace packages), then `pnpm build`. Runtime needs `cairo`, `pango`, `jpeg`, `giflib`, `librsvg` for `sharp` and `@napi-rs/canvas`.

## Architecture notes (non-obvious from filenames)

- `lib/generation/` — two-stage pipeline: outline → scenes. Main entry for content creation.
- `lib/orchestration/` — LangGraph-based multi-agent director graph. Controls agent turns, discussions, tool calls.
- `lib/playback/` — state machine: `idle → playing → live`. Drives classroom timeline.
- `lib/action/` — 28+ action types agents can execute (speech, whiteboard, slide effects, etc.).
- `lib/store/` — Zustand stores. Central index at `lib/store/index.ts` re-exports the main stores.
- `lib/modification/` — scene editing pipeline: plan-generator → operation-executor → diff-engine. Store uses `sessionsBySceneId` (per-page isolated sessions).
- `lib/types/` — centralized type definitions used across the entire codebase.
- `lib/ai/` — unified LLM provider abstraction wrapping `@ai-sdk/*` and LangChain.
- `lib/server/` — server-only services: job store, classroom storage, SSRF guard, provider config. Never import in client components.
- API routes under `app/api/` are server-side only. Classroom generation uses async job submission (`/api/generate-classroom/`).
- `app/eval/` — internal evaluation harness routes, not part of the product surface.

## Deprecations

- `interactiveConfig` in scene outlines — use `widgetType` + `widgetOutline` instead.
- `SlideData` type in `lib/types/slides.ts` — use `Slide`.
- `ParsedAction` in `lib/types/chat.ts` — use `Action`.
- Three methods in `lib/api/stage-api-element.ts` are `@deprecated` — check JSDoc before calling.

## Critical gotchas

- `lib/ai/thinking-context.ts` uses `node:async_hooks` — **server-only**. Never import in client components or `'use client'` files. (See comment in `lib/ai/providers.ts:40`.)
- `discussion` action must always be **last** in a quiz scene's action array.
- `wb_close` must **not** be called at the end of a whiteboard drawing turn — only call it when explicitly closing the board.
- Videos never autoplay; they wait for an explicit `play_video` action.
- Modification plans must always set `requiresConfirmation: true`.
- `@next/next/no-img-element` ESLint rule is **off** — dynamic AI image URLs are incompatible with `next/image`.

## ESLint quirks

- Flat config (`eslint.config.mjs`), based on `eslint-config-next`.
- `packages/**`, `e2e/**`, and CI/local tool directories are globally ignored.
- `@next/next/no-img-element` is **off** (dynamic AI-generated image URLs are incompatible with `next/image`).

## Gitignore

- `server-providers.yml` and `server-providers-*.yml` are gitignored (contain API keys).
- All `.env*` files except `.env.example` are ignored.
- `/data` and `/logs` are ignored (runtime generated).
