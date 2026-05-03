# lib/audio

TTS (Text-to-Speech) and ASR (Automatic Speech Recognition) provider layer.

## WHERE TO LOOK

| Task | File |
|------|------|
| TTS provider registry | `tts-providers.ts` |
| ASR provider registry | `asr-providers.ts` |
| VoxCPM2 TTS adapter | `voxcpm.ts` |
| VoxCPM voice management | `voxcpm-voices.ts` |
| TTS utility functions | `tts-utils.ts` |
| Voice resolver (agent → voice) | `voice-resolver.ts` |
| Browser TTS preview | `browser-tts-preview.ts` |
| TTS preview hook | `use-tts-preview.ts` |
| Azure voice list | `azure.json` |
| Provider constants | `constants.ts` |
| Shared types | `types.ts` |

## CONVENTIONS

- Always validate API key if `requiresApiKey` is true (`tts-providers.ts:84`, `asr-providers.ts:135`).
- VoxCPM2 supports three backends: vLLM-Omni (`/v1/audio/speech`), Python API (`/tts/upload`), Nano-vLLM (`/generate`).
- Teacher always uses global lecture voice from settings — single source of truth (`lib/hooks/use-discussion-tts.ts:114`).
- Language uncertain or mixed → use `"auto"` for ASR, do not specify language parameter (`constants.ts`).
- Voice cloning clips stored in IndexedDB, sent to VoxCPM backend per synthesis.

## ANTI-PATTERNS

- Do NOT hardcode voice IDs — resolve via `voice-resolver.ts`.
- Do NOT use `browser-tts-preview.ts` in server components.
