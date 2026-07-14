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
  repairScene?: (scene: Scene, instruction: string) => Promise<Scene | null>;
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

  const structuralRepairIssues = guarded.report.issues.filter(
    (issue) =>
      issue.severity === 'critical' &&
      !!issue.sceneId &&
      AI_REPAIRABLE_SLIDE_STRUCTURE_CODES.has(issue.code),
  );
  const repairableSceneIds = new Set([
    ...structuralRepairIssues.map((issue) => issue.sceneId as string),
    ...visualReport.issues
      .filter(
        (issue) =>
          issue.severity === 'critical' &&
          (issue.code === 'text_overflow' ||
            issue.code === 'content_overlap' ||
            issue.code === 'vision_issue'),
      )
      .map((issue) => issue.sceneId),
  ]);
  if (options.repairScene && repairableSceneIds.size > 0) {
    await options.onPhase?.(
      'repairing',
      `Repairing ${repairableSceneIds.size} slide(s) that failed visual inspection`,
    );
    const repairedScenes = [...guarded.bundle.scenes];
    let repairedCount = 0;
    const repairFailures: Array<{ sceneId: string; error: string }> = [];
    for (const sceneId of repairableSceneIds) {
      const sceneIndex = repairedScenes.findIndex((scene) => scene.id === sceneId);
      if (sceneIndex < 0) continue;
      const sceneIssues = visualReport.issues.filter((issue) => issue.sceneId === sceneId);
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
          `Fix only the slide layout defects listed below. Preserve the teaching meaning, language, visual style, and existing media. Ensure every text box fully contains its text and content elements do not overlap. Do not add unrelated content.\n\n${issueSummary}`,
        );
        if (repaired) {
          repairedScenes[sceneIndex] = repaired;
          repairedCount += 1;
        }
      } catch (error) {
        repairFailures.push({
          sceneId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (repairFailures.length > 0) {
      await fs.writeFile(
        path.join(evidenceDir, 'courseware-repair-failures.json'),
        JSON.stringify(repairFailures, null, 2),
        'utf-8',
      );
    }

    if (repairedCount > 0) {
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
        'Re-rendering repaired slides for visual verification',
      );
      screenshotsDir = path.join(evidenceDir, 'screenshots-repaired');
      visualReport = await runCoursewareVisualAudit({
        baseUrl: options.baseUrl,
        classroomId: guarded.bundle.stage.id,
        scenes: guarded.bundle.scenes,
        screenshotsDir,
        reviewScreenshot: options.reviewScreenshot,
      });
    }
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
