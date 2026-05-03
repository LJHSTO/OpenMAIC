# lib/media

Image and video generation provider layer.

## WHERE TO LOOK

| Task | File |
|------|------|
| Image provider registry | `image-providers.ts` |
| Video provider registry | `video-providers.ts` |
| Media orchestration (image + video) | `media-orchestrator.ts` |
| Provider adapters | `adapters/` |
| Shared types | `types.ts` |

## CONVENTIONS

- `adapters/` contains per-provider adapters (e.g., `minimax-video-adapter.ts` uses submit + poll pattern).
- MiniMax video: POST `/v1/video_generation` (submit) → GET `/v1/query/video_generation?task_id=xxx` (poll).
- `media-orchestrator.ts` coordinates image and video generation during scene building.
- Image and video providers are configured separately from LLM providers (separate env vars: `IMAGE_*`, `VIDEO_*`).

## ANTI-PATTERNS

- Do NOT call media providers directly from client — always go through API routes (`/api/generate/image`, `/api/generate/video`).
- Do NOT mix image and video provider configs.
