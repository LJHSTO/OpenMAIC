# lib/store

Zustand stores. Central index at `index.ts` re-exports all main stores.

## WHERE TO LOOK

| Store | File | Purpose |
|-------|------|---------|
| Stage / scenes | `stage.ts` | Course structure, scene list, `updateScene()` |
| Canvas | `canvas.ts` | Slide element selection, highlight, active IDs |
| Modification | `modification.ts` | Per-page scene editing sessions |
| Settings | `settings.ts` | Provider config, TTS/ASR, model selection |
| Snapshot | `snapshot.ts` | Undo history (`addSnapshot()`) |
| Keyboard | `keyboard.ts` | Global hotkey state |
| Widget iframe | `widget-iframe.ts` | Iframe messaging for interactive scenes |

## CONVENTIONS

- All stores use `createSelectors` wrapper → access via `useStore.use.field()` pattern.
- `useModificationStore` uses **`sessionsBySceneId: Record<string, ModificationSession>`** — each page has its own isolated session. Access via `getActiveSession()` or `getSessionForScene(sceneId)`.
- `setActiveScene(sceneId)` must be called when switching pages in the modification panel.
- `useSnapshotStore.addSnapshot()` must be called before committing any modification (undo support).
- `useSettingsStore` has custom rehydration: built-in providers always sync on rehydrate (`settings.ts:1586`).
- Import from `@/lib/store` (barrel), not individual files, unless you need a store not in the barrel.

## ANTI-PATTERNS

- Do NOT use a global single `activeSession` — the store is per-`sceneId`.
- Do NOT call `clearActiveSession()` when switching pages — it destroys the session. Use `setActiveScene()` instead.
- `widget-iframe.ts` is client-only — never import in server components or API routes.
