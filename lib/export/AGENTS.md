# lib/export

PPTX and HTML export pipeline. Also handles classroom ZIP import/export.

## WHERE TO LOOK

| Task | File |
|------|------|
| PPTX export hook | `use-export-pptx.ts` |
| Classroom ZIP export hook | `use-export-classroom.ts` |
| ZIP format types | `classroom-zip-types.ts` |
| ZIP utilities | `classroom-zip-utils.ts` |
| HTML parser for import | `html-parser/` |
| LaTeX → OMML conversion | `latex-to-omml.ts` |
| SVG utilities | `svg2base64.ts`, `svg-path-parser.ts`, `svg-arc-to-cubic-bezier.d.ts` |

## CONVENTIONS

- PPTX export uses vendored `pptxgenjs` workspace package — import as `import "pptxgenjs"`.
- MathML → OMML conversion uses vendored `mathml2omml` workspace package.
- Docker runtime requires `cairo`, `pango`, `jpeg`, `giflib`, `librsvg` for `sharp` and `@napi-rs/canvas`.
- Classroom ZIP format defined in `classroom-zip-types.ts` — follow schema when adding new scene types.

## ANTI-PATTERNS

- Do NOT import `pptxgenjs` or `mathml2omml` without `transpilePackages` in `next.config.ts` (already configured).
- Do NOT modify `packages/pptxgenjs/src` or `packages/mathml2omml/src` without running `pnpm install` to rebuild.
