# lib/types

Centralized TypeScript type definitions. All cross-cutting types live here — do not scatter types in feature files.

## WHERE TO LOOK

| Domain | File |
|--------|------|
| Scene, Stage, SceneContent, SceneType | `stage.ts` |
| Widget types (simulation/diagram/code/game/3d) | `widgets.ts` |
| All 28+ action types | `action.ts` |
| Modification sessions, operations, plans | `modification.ts` |
| Slide/PPT element types | `slides.ts` |
| Generation pipeline types | `generation.ts` |
| Settings, provider config | `settings.ts` |
| LLM provider types | `provider.ts` |
| Export types | `export.ts` |
| Quiz grading | `roundtable.ts`, `web-search.ts`, `pdf.ts`, `chat.ts`, `edit.ts` |

## CONVENTIONS

- `SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl'`
- `WidgetType = 'simulation' | 'diagram' | 'code' | 'game' | 'visualization3d'`
- `Action` union covers all 28+ action types; `ActionType` is the discriminant.
- `FIRE_AND_FORGET_ACTIONS`, `SYNC_ACTIONS`, `SLIDE_ONLY_ACTIONS` constants in `action.ts`.
- `InteractiveContent` has optional `html`, `widgetType`, `widgetConfig`, `teacherActions` fields.
- `ModificationSessionsBySceneId = Record<string, ModificationSession>` — per-page isolation.

## DEPRECATIONS (do not use)

- `SlideData` in `slides.ts` → use `Slide`
- `ParsedAction` in `chat.ts` → use `Action`
- `interactiveConfig` in `generation.ts` → use `widgetType` + `widgetOutline`
