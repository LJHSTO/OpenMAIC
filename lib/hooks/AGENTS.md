# lib/hooks

React custom hooks (13 files). All are client-side only.

## WHERE TO LOOK

| Hook | Purpose |
|------|---------|
| `use-scene-generator.ts` | Drives generation pipeline from UI |
| `use-streaming-text.ts` | Streaming text display (animation driver) |
| `use-discussion-tts.ts` | TTS for multi-agent discussion |
| `use-browser-tts.ts` | Browser Web Speech API TTS |
| `use-browser-asr.ts` | Browser Web Speech API ASR |
| `use-audio-recorder.ts` | Microphone recording |
| `use-canvas-operations.ts` | Slide canvas element operations |
| `use-order-element.ts` | Element z-order management |
| `use-history-snapshot.ts` | Undo/redo via snapshot store |
| `use-draft-cache.ts` | Draft caching for generation input |
| `use-slide-background-style.ts` | Slide background CSS |
| `use-i18n.tsx` | i18n translation hook |
| `use-theme.tsx` | Dark/light mode |

## CONVENTIONS

- `use-streaming-text.ts` uses `eslint-disable react-hooks/set-state-in-effect` — intentional for animation driver.
- `use-theme.tsx` and `use-i18n.tsx` use `set-state-in-effect` for localStorage hydration — expected pattern.
- Web Speech API hooks (`use-audio-recorder.ts`, `use-browser-asr.ts`) use `@typescript-eslint/no-explicit-any` — vendor-prefixed API not typed in lib.dom.

## ANTI-PATTERNS

- Do NOT import hooks in server components or API routes.
- Do NOT add hooks that duplicate store logic — prefer store selectors.
