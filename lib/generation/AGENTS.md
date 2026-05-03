# lib/generation

Two-stage lesson generation pipeline: outline → scenes. Main entry for all content creation.

## WHERE TO LOOK

| Task | File |
|------|------|
| Pipeline entry point | `pipeline-runner.ts` |
| Stage 1: outline generation | `outline-generator.ts` |
| Stage 2: scene content | `scene-generator.ts` |
| Interactive post-processing | `interactive-post-processor.ts` |
| Action parsing from LLM output | `action-parser.ts` |
| Scene assembly from outline | `scene-builder.ts` |
| JSON repair for malformed LLM output | `json-repair.ts` |
| Prompt variable formatting | `prompt-formatters.ts` |
| Pipeline types | `pipeline-types.ts` |

## CONVENTIONS

- Two prompt branches: `requirements-to-outlines` (standard) and `interactive-outlines` (Deep Interactive Mode). Selected by `interactiveMode` flag on Stage.
- Always use `nanoid` for action IDs to prevent audio ID collisions (`scene-generator.ts:1365`).
- `interactive-post-processor.ts` runs after scene generation to validate/fix widget configs.
- Classroom generation is **async** — submitted via `/api/generate-classroom/`, polled via `/api/generate-classroom/[jobId]`.

## ANTI-PATTERNS

- `interactiveConfig` in outlines is **deprecated** — use `widgetType` + `widgetOutline` instead.
- Do NOT use `interactiveConfig` in new outline prompts or scene builders.
- Interactive scenes without `widgetType` + `widgetOutline` are invalid in interactive mode.
- Do NOT call generation pipeline directly from client — always go through API routes.
