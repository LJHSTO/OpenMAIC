# lib/server

Server-only services. **Never import these in client components or `'use client'` files.**

## WHERE TO LOOK

| Task | File |
|------|------|
| Async classroom job store | `classroom-job-store.ts` |
| Classroom generation runner | `classroom-job-runner.ts` |
| Classroom storage (read/write JSON) | `classroom-storage.ts` |
| Media generation orchestration | `classroom-media-generation.ts` |
| Provider config loading (env + YAML) | `provider-config.ts` |
| SSRF guard (blocks localhost URLs) | `ssrf-guard.ts` |
| Proxy fetch (for media) | `proxy-fetch.ts` |
| Model resolution | `resolve-model.ts` |
| API response helpers | `api-response.ts` |
| Web search query builder | `search-query-builder.ts` |

## CONVENTIONS

- `provider-config.ts` loads from `.env.local` OR `server-providers.yml` — not both simultaneously.
- `ssrf-guard.ts` blocks localhost/private IPs unless `ALLOW_LOCAL_NETWORKS=true` (required for Ollama).
- `resolve-model.ts` resolves model from server config only — never from client headers (auth bypass prevention, `resolve-model.ts:87`).
- Classroom jobs are async: submit → poll pattern via `/api/generate-classroom/` + `/api/generate-classroom/[jobId]`.
- `classroom-storage.ts` reads/writes to `/data/` directory (gitignored, runtime-generated).

## ANTI-PATTERNS

- Do NOT import anything from `lib/server/` in `'use client'` files or `lib/store/`.
- Do NOT pass model selection from client request headers to `resolve-model.ts`.
- `server-providers.yml` is gitignored — never commit it.
