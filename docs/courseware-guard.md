# Courseware Guard

Courseware Guard checks the current OpenMAIC course without introducing a second editor or a
second AI-editing workflow. It runs at four points:

1. After every generated scene, before it enters the client or server stage store.
2. After the full course is generated, before it is marked complete.
3. The course header, through the shield-check button beside Pro Mode and Download.
4. Manual `.maic.zip` export, immediately before the archive is assembled.

Finalization persists a renderable draft, opens every slide in a real Playwright browser at
1600x900, waits for fonts and images, captures a screenshot, and measures text overflow, canvas
boundary violations, significant content overlap, failed images, console errors, and failed
requests. A layout failure is sent once through the existing Pro Mode `regenerate_scene` backend
with a constrained repair instruction, then rendered and checked again. Remaining critical issues
block completion and archive creation.

## User workflow

1. Open a generated or imported course.
2. Select the shield-check button in the course header.
3. Apply safe fixes when the report offers them.
4. For remaining content issues, select **Edit in Pro Mode**. OpenMAIC navigates to the affected
   scene and uses the existing Pro Mode editor.
5. Reopen Courseware Guard. When critical issues reach zero, download the `.maic.zip` directly
   from the dialog.

After a successful final check, OpenMAIC automatically writes a `.maic.zip` whose filename contains
the course title, model, and UTC timestamp. Configure the destination with
`OPENMAIC_COURSEWARE_OUTPUT_DIR`; the default is `data/courseware-output`. Browser-generated media
is uploaded from IndexedDB before visual inspection so the screenshots and archive include the
actual images, videos, posters, and audio.

The archive includes `manifest.json`, `classroom.json`, `courseware-guard-report.json`,
`courseware-visual-report.json`, `screenshots/`, `media/`, and `audio/` when those resources exist.
Failed visual runs keep their reports and screenshots under `data/courseware-audits/<classroomId>`.

## Repair policy

Safe fixes are deterministic and idempotent:

- missing or duplicate scene, slide-element, and quiz-question IDs;
- incorrect scene-to-stage links;
- invalid or duplicate scene order values;
- missing course or scene titles;
- scene/content discriminator mismatches when the content discriminator is valid;
- missing HTML doctype declarations.

Deterministic safe fixes never rewrite:

- quiz answer semantics;
- mathematical or instructional content;
- slide prose or narration;
- invalid slide geometry whose intended value is unknown;
- unsafe or incomplete interactive logic;
- PBL project content.

Final visual repair may regenerate an affected slide once through the existing
`regenerate_scene` tool. It is instructed to preserve meaning, language, style, and media. This is
the same backend used by Pro Mode, not a parallel editor. If the repaired render still has a
critical issue, the course remains paused for explicit Pro Mode review.

## Module interface

```ts
guardCourseware(bundle, { mode: 'inspect' | 'safe-fix' })
```

The module returns a copied bundle and a report containing fingerprints, remaining issues,
applied repairs, severity counts, and the `publishable` decision. Callers do not need to know the
individual validators or repair ordering.

Source: `lib/courseware-guard/index.ts`
