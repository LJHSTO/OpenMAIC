# components/slide-renderer

Canvas-based slide editor and renderer. Largest component subtree (78 TS/TSX files).

## STRUCTURE

```
slide-renderer/
├── Editor/
│   ├── Canvas/           # Interactive editing canvas
│   │   ├── Operate/      # Element operation handles (resize, rotate, etc.)
│   │   └── hooks/        # Canvas-specific hooks
│   └── ...               # Screen elements, spotlight overlay
├── components/
│   ├── element/          # Per-element-type renderers (text, image, shape, table, chart, code, video, latex, line, audio)
│   └── ThumbnailSlide/   # Thumbnail rendering
└── ...                   # Shared utilities
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Element type renderers | `components/element/{TypeName}/` |
| Canvas editing logic | `Editor/Canvas/index.tsx` |
| Element selection/operate | `Editor/Canvas/Operate/index.tsx` |
| Spotlight overlay | `Editor/SpotlightOverlay.tsx` |
| Thumbnail rendering | `components/ThumbnailSlide/` |

## CONVENTIONS

- Element components have **varying prop signatures** — dynamic dispatch uses `as any` with `eslint-disable @typescript-eslint/no-explicit-any` (expected, not a bug).
- DOM measurement effects use `eslint-disable react-hooks/set-state-in-effect` — expected pattern for canvas layout.
- `useMouseSelection` and `useSelectElement` intentionally exclude some deps from exhaustive-deps — see inline comments.
- ECharts chart: `max` in indicator triggers console warnings but is required for display — no workaround, waiting for ECharts fix (`chartOption.ts:278`).

## ANTI-PATTERNS

- Do NOT add `next/image` for slide images — dynamic AI-generated URLs are incompatible (`@next/next/no-img-element` is off).
- Do NOT co-locate business logic in element renderers — keep rendering pure.
- Videos in slides **never autoplay** — wait for explicit `play_video` action.
