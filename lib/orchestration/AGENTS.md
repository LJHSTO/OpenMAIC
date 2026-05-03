# lib/orchestration

LangGraph multi-agent director graph — controls agent turns, discussions, whiteboard, and tool calls during live classroom playback.

## WHERE TO LOOK

| Task | File |
|------|------|
| Agent turn logic / state machine | `director-graph.ts` |
| System prompt assembly | `prompt-builder.ts` (role-conditional TS, NOT markdown) |
| One-shot LLM calls outside graph | `stateless-generate.ts` |
| Agent registry (default + generated) | `registry/store.ts` |
| Whiteboard conflict detection | `summarizers/whiteboard-conflicts.ts` |
| Conversation summarization | `summarizers/conversation-summary.ts` |
| State context for LLM | `summarizers/state-context.ts` |

## CONVENTIONS

- `prompt-builder.ts` has `ROLE_GUIDELINES` (teacher/assistant/student blocks) and `buildLengthGuidelines` as **TypeScript template literals** — not in markdown templates. Edit TS directly.
- Length targets: teacher=100 chars/turn, assistant=80, student=50.
- Default agents always available on both server and client (`registry/store.ts:45`).
- Generated agent configs are embedded in Stage JSON (`generatedAgentConfigs`) so clients hydrate without IndexedDB.
- `stateless-generate.ts` is for generation pipeline calls; `director-graph.ts` is for live classroom.

## ANTI-PATTERNS

- **`wb_close` must NOT be called at end of a drawing turn** — only when explicitly closing the board.
- **`discussion` must be the last action** in a quiz scene's action array.
- Whiteboard and canvas are **mutually exclusive per turn** — see `prompt-builder.ts:74`.
- Do NOT import `lib/ai/thinking-context.ts` here — it uses `node:async_hooks` (server-only).
- Do NOT add role-conditional content to markdown templates — keep it in `prompt-builder.ts`.
