# lib/modification

Scene editing pipeline: plan-generator → operation-executor → diff-engine. Supports slide, quiz, and interactive scene types.

## WHERE TO LOOK

| Task | File |
|------|------|
| Generate edit plan from instruction | `plan-generator.ts` |
| Execute plan operations on scene | `operation-executor.ts` |
| Compute diff summary | `diff-engine.ts` |
| Validate plan operations | `validators.ts` |
| HTML sanitization for interactive | `sanitize.ts` |

## CONVENTIONS

- Three operation namespaces: `slide.*`, `quiz.*`, `interactive.*`
- `interactive.replace_html` — replaces entire interactive scene HTML. HTML must be a complete document, include `<script type="application/json" id="widget-config">` when widgetConfig is available.
- `interactive.update_widget_config` / `interactive.replace_widget_config` — update widget config without replacing HTML.
- Plans always set `requiresConfirmation: true`.
- `plan-generator.ts` sends first 2000 chars of HTML as context prefix for interactive scenes.
- `sanitize.ts` exports `replaceJsonScriptContent()` and `extractJsonScriptContent()` for widget-config script tag manipulation.

## ANTI-PATTERNS

- `interactive.replace_html` rejects: inline event handler attributes (`onclick=`, `onerror=`, etc.), `javascript:` URLs, non-complete HTML documents.
- Do NOT use `interactive.replace_html` for config-only changes — use `interactive.update_widget_config`.
- Do NOT call `clearActiveSession()` on page switch — use `setActiveScene()` (see `lib/store/AGENTS.md`).
- Risk level `high` required for: deleting many items, changing core learning objective, large rewrites.
