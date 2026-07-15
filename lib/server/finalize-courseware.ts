import { promises as fs } from 'fs';
import path from 'path';
import { guardCourseware, type CoursewareGuardReport } from '@/lib/courseware-guard';
import {
  createCoursewareArchive,
  type CoursewareArchiveResult,
} from '@/lib/courseware-guard/archive';
import {
  runCoursewareVisualAudit,
  type RunVisualAuditOptions,
  type CoursewareVisualAuditReport,
  type VisualAuditIssue,
} from '@/lib/courseware-guard/visual-audit';
import { persistClassroom } from '@/lib/server/classroom-storage';
import type { Scene, Stage } from '@/lib/types/stage';

const AI_REPAIRABLE_SLIDE_STRUCTURE_CODES = new Set([
  'slide_canvas_invalid',
  'slide_element_invalid',
  'slide_element_geometry_invalid',
  'slide_viewport_invalid',
  'slide_element_size_invalid',
]);

const AI_REPAIRABLE_VISUAL_CODES = new Set([
  'render_failed',
  'console_error',
  'resource_failed',
  'image_failed',
  'text_overflow',
  'element_out_of_bounds',
  'content_overlap',
  'vision_issue',
]);

const AI_REPAIRABLE_VISUAL_WARNING_CATEGORIES = new Set([
  'overlap',
  'clipping',
  'overflow',
  'contrast',
  'legibility',
  'broken_math',
  'broken_media',
  'duplicate_content',
  'visual_hierarchy',
  'empty_content',
]);

const MAX_AUTOMATIC_REPAIR_PASSES = 5;

export type CoursewareFinalizationPhase =
  | 'validating'
  | 'persisting'
  | 'visual_auditing'
  | 'repairing'
  | 'archiving';

export interface FinalizeCoursewareOptions {
  stage: Stage;
  scenes: Scene[];
  model: string;
  baseUrl: string;
  repairScene?: (
    scene: Scene,
    instruction: string,
    context: { visualIssues: VisualAuditIssue[]; hasStructuralIssues: boolean },
  ) => Promise<Scene | null>;
  reviewScreenshot?: RunVisualAuditOptions['reviewScreenshot'];
  onPhase?: (phase: CoursewareFinalizationPhase, message: string) => void | Promise<void>;
}

export interface FinalizedCourseware {
  id: string;
  url: string;
  createdAt: string;
  stage: Stage;
  scenes: Scene[];
  guardReport: CoursewareGuardReport;
  visualReport: CoursewareVisualAuditReport;
  archive: CoursewareArchiveResult;
}

export class CoursewareValidationError extends Error {
  constructor(
    message: string,
    readonly guardReport: CoursewareGuardReport,
    readonly visualReport: CoursewareVisualAuditReport,
    readonly evidenceDir: string,
    readonly stage: Stage,
    readonly scenes: Scene[],
  ) {
    super(message);
    this.name = 'CoursewareValidationError';
  }
}

export async function finalizeCourseware(
  options: FinalizeCoursewareOptions,
): Promise<FinalizedCourseware> {
  await options.onPhase?.('validating', 'Checking and safely repairing classroom data');
  let guarded = guardCourseware(
    { stage: options.stage, scenes: options.scenes },
    { mode: 'safe-fix' },
  );

  await options.onPhase?.('persisting', 'Persisting classroom data');
  let persisted = await persistClassroom(
    {
      id: guarded.bundle.stage.id,
      stage: guarded.bundle.stage,
      scenes: guarded.bundle.scenes,
    },
    options.baseUrl,
  );

  await options.onPhase?.('visual_auditing', 'Rendering and visually checking every slide');
  const evidenceDir = path.join(
    process.cwd(),
    'data',
    'courseware-audits',
    guarded.bundle.stage.id,
    Date.now().toString(),
  );
  let screenshotsDir = path.join(evidenceDir, 'screenshots');
  let visualReport = await runCoursewareVisualAudit({
    baseUrl: options.baseUrl,
    classroomId: guarded.bundle.stage.id,
    scenes: guarded.bundle.scenes,
    screenshotsDir,
    reviewScreenshot: options.reviewScreenshot,
  });
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'courseware-visual-report-pass-1.json'),
    JSON.stringify(visualReport, null, 2),
    'utf-8',
  );

  const repairFailures: Array<{ pass: number; sceneId: string; error: string }> = [];
  let repairPass = 0;
  while (options.repairScene && repairPass < MAX_AUTOMATIC_REPAIR_PASSES) {
    const structuralRepairIssues = guarded.report.issues.filter(
      (issue) =>
        issue.severity === 'critical' &&
        !!issue.sceneId &&
        AI_REPAIRABLE_SLIDE_STRUCTURE_CODES.has(issue.code),
    );
    const visualRepairIssues = visualReport.issues.filter(
      (issue) =>
        AI_REPAIRABLE_VISUAL_CODES.has(issue.code) &&
        (issue.severity === 'critical' ||
          issue.code === 'element_out_of_bounds' ||
          (issue.code === 'vision_issue' &&
            !!issue.category &&
            AI_REPAIRABLE_VISUAL_WARNING_CATEGORIES.has(issue.category))),
    );
    const repairableSceneIds = new Set([
      ...structuralRepairIssues.map((issue) => issue.sceneId as string),
      ...visualRepairIssues.map((issue) => issue.sceneId),
    ]);
    if (repairableSceneIds.size === 0) break;

    repairPass += 1;
    await options.onPhase?.(
      'repairing',
      `Automatic repair pass ${repairPass}: repairing ${repairableSceneIds.size} slide(s)`,
    );
    const repairedScenes = [...guarded.bundle.scenes];
    let repairedCount = 0;
    for (const sceneId of repairableSceneIds) {
      const sceneIndex = repairedScenes.findIndex((scene) => scene.id === sceneId);
      if (sceneIndex < 0) continue;
      const sceneIssues = visualRepairIssues.filter((issue) => issue.sceneId === sceneId);
      const structuralSceneIssues = structuralRepairIssues.filter(
        (issue) => issue.sceneId === sceneId,
      );
      const issueSummary = [
        ...structuralSceneIssues.map((issue) => `${issue.code}: ${issue.path}`),
        ...sceneIssues.map(
          (issue) =>
            `${issue.code}${issue.category ? ` [${issue.category}]` : ''}${issue.elementIds?.length ? ` (${issue.elementIds.join(', ')})` : ''}: ${issue.message}`,
        ),
      ].join('\n');
      try {
        const repaired = await options.repairScene(
          repairedScenes[sceneIndex],
          `Fix only the slide defects listed below. Preserve the teaching meaning, language, visual style, existing media, and narration. Ensure text is readable, content does not overlap, media renders, and all SVG path data is valid. Do not add unrelated content.\n\n${issueSummary}`,
          {
            visualIssues: sceneIssues,
            hasStructuralIssues: structuralSceneIssues.length > 0,
          },
        );
        if (repaired) {
          repairedScenes[sceneIndex] = repaired;
          repairedCount += 1;
        }
      } catch (error) {
        repairFailures.push({
          pass: repairPass,
          sceneId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (repairedCount === 0) break;

    guarded = guardCourseware(
      { stage: guarded.bundle.stage, scenes: repairedScenes },
      { mode: 'safe-fix' },
    );
    persisted = await persistClassroom(
      {
        id: guarded.bundle.stage.id,
        stage: guarded.bundle.stage,
        scenes: guarded.bundle.scenes,
      },
      options.baseUrl,
    );
    await options.onPhase?.(
      'visual_auditing',
      `Verification after automatic repair pass ${repairPass}`,
    );
    screenshotsDir = path.join(
      evidenceDir,
      repairPass === 1 ? 'screenshots-repaired' : `screenshots-repaired-pass-${repairPass}`,
    );
    visualReport = await runCoursewareVisualAudit({
      baseUrl: options.baseUrl,
      classroomId: guarded.bundle.stage.id,
      scenes: guarded.bundle.scenes,
      screenshotsDir,
      reviewScreenshot: options.reviewScreenshot,
    });
    await fs.writeFile(
      path.join(evidenceDir, `courseware-visual-report-pass-${repairPass + 1}.json`),
      JSON.stringify(visualReport, null, 2),
      'utf-8',
    );
  }

  if (repairFailures.length > 0) {
    await fs.writeFile(
      path.join(evidenceDir, 'courseware-repair-failures.json'),
      JSON.stringify(repairFailures, null, 2),
      'utf-8',
    );
  }

  await Promise.all([
    fs.writeFile(
      path.join(evidenceDir, 'courseware-guard-report.json'),
      JSON.stringify(guarded.report, null, 2),
      'utf-8',
    ),
    fs.writeFile(
      path.join(evidenceDir, 'courseware-visual-report.json'),
      JSON.stringify(visualReport, null, 2),
      'utf-8',
    ),
  ]);

  if (!guarded.report.publishable || !visualReport.publishable) {
    throw new CoursewareValidationError(
      `Courseware validation failed: ${guarded.report.counts.critical} structural and ${visualReport.counts.critical} visual critical issue(s). Evidence: ${evidenceDir}`,
      guarded.report,
      visualReport,
      evidenceDir,
      guarded.bundle.stage,
      guarded.bundle.scenes,
    );
  }

  await options.onPhase?.('archiving', 'Archiving classroom resources and validation evidence');
  const archive = await createCoursewareArchive({
    stage: guarded.bundle.stage,
    scenes: guarded.bundle.scenes,
    model: options.model,
    guardReport: guarded.report,
    visualReport,
    screenshotsDir,
  });

  return {
    id: persisted.id,
    url: persisted.url,
    createdAt: persisted.createdAt,
    stage: guarded.bundle.stage,
    scenes: guarded.bundle.scenes,
    guardReport: guarded.report,
    visualReport,
    archive,
  };
}
