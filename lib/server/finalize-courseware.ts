import { promises as fs, type Dirent } from 'fs';
import path from 'path';
import { guardCourseware, type CoursewareGuardReport } from '@/lib/courseware-guard';
import {
  resolveCoursewareAuditPolicy,
  type CoursewareAuditPolicy,
} from '@/lib/courseware-guard/audit-policy';
import {
  createCoursewareArchive,
  type CoursewareArchiveResult,
} from '@/lib/courseware-guard/archive';
import {
  auditCoursewareResources,
  type CoursewareResourceAuditReport,
} from '@/lib/courseware-guard/resource-audit';
import {
  auditCoursewareKnowledgeContract,
  type CoursewareKnowledgeAuditReport,
} from '@/lib/courseware-guard/knowledge-audit';
import {
  mergeCoursewareInteractiveAuditReports,
  runCoursewareInteractiveAudit,
  type CoursewareInteractiveAuditReport,
  type InteractiveAuditIssue,
} from '@/lib/courseware-guard/interactive-audit';
import {
  mergeCoursewareVisualAuditReports,
  runCoursewareVisualAudit,
  type RunVisualAuditOptions,
  type CoursewareVisualAuditReport,
  type VisualAuditIssue,
} from '@/lib/courseware-guard/visual-audit';
import {
  fileSystemCoursewareAuditStorage,
  type CoursewareAuditStorage,
} from '@/lib/server/courseware-audit-storage';
import type { Scene, Stage } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';

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
  'video_failed',
  'rendered_mojibake',
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

const AI_REPAIRABLE_INTERACTIVE_CODES = new Set<InteractiveAuditIssue['code']>([
  'load_failed',
  'runtime_error',
  'console_error',
  'resource_failed',
  'http_error',
  'external_dependency',
  'image_failed',
  'rendered_mojibake',
  'empty_document',
  'blank_render',
]);

const DETERMINISTIC_VISUAL_CRITICAL_CODES = new Set([
  'content_overlap',
  'text_overflow',
  'element_out_of_bounds',
]);

function isStrictBlockingWarning(issue: VisualAuditIssue): boolean {
  return (
    issue.severity === 'warning' &&
    (issue.code === 'element_out_of_bounds' ||
      (issue.code === 'vision_issue' &&
        !!issue.category &&
        (AI_REPAIRABLE_VISUAL_WARNING_CATEGORIES.has(issue.category) ||
          issue.category === 'semantic_confusion')))
  );
}

function repairScore(
  guardReport: CoursewareGuardReport,
  visualReport: CoursewareVisualAuditReport,
  interactiveReport: CoursewareInteractiveAuditReport,
  strictVisualSemantics: boolean,
): number {
  const critical =
    guardReport.counts.critical + visualReport.counts.critical + interactiveReport.counts.critical;
  const blockingWarnings = strictVisualSemantics
    ? visualReport.issues.filter(isStrictBlockingWarning).length
    : 0;
  return (
    critical * 1_000_000 +
    blockingWarnings * 10_000 +
    (visualReport.counts.warning + interactiveReport.counts.warning) * 100 +
    guardReport.counts.warning
  );
}

function hasOnlyDeterministicVisualCriticalIssues(
  guardReport: CoursewareGuardReport,
  visualReport: CoursewareVisualAuditReport,
  interactiveReport: CoursewareInteractiveAuditReport,
): boolean {
  if (guardReport.counts.critical > 0 || interactiveReport.counts.critical > 0) return false;
  const criticalIssues = visualReport.issues.filter((issue) => issue.severity === 'critical');
  return (
    criticalIssues.length > 0 &&
    criticalIssues.every((issue) => DETERMINISTIC_VISUAL_CRITICAL_CODES.has(issue.code))
  );
}

export type CoursewareFinalizationPhase =
  | 'validating'
  | 'persisting'
  | 'visual_auditing'
  | 'repairing'
  | 'archiving';

export interface FinalizeCoursewareOptions {
  stage: Stage;
  scenes: Scene[];
  outlines?: SceneOutline[];
  model: string;
  baseUrl: string;
  repairScene?: (
    scene: Scene,
    instruction: string,
    context: {
      visualIssues: VisualAuditIssue[];
      interactiveIssues: InteractiveAuditIssue[];
      hasStructuralIssues: boolean;
    },
  ) => Promise<Scene | null>;
  reviewScreenshot?: RunVisualAuditOptions['reviewScreenshot'];
  regenerateNarrationAudio?: (scenes: Scene[]) => Promise<void>;
  onPhase?: (phase: CoursewareFinalizationPhase, message: string) => void | Promise<void>;
  strictVisualSemantics?: boolean;
  auditPolicy?: CoursewareAuditPolicy;
  storage?: CoursewareAuditStorage;
}

export interface FinalizedCourseware {
  id: string;
  url: string;
  createdAt: string;
  stage: Stage;
  scenes: Scene[];
  guardReport: CoursewareGuardReport;
  knowledgeReport: CoursewareKnowledgeAuditReport;
  resourceReport: CoursewareResourceAuditReport;
  visualReport: CoursewareVisualAuditReport;
  interactiveReport: CoursewareInteractiveAuditReport;
  archive: CoursewareArchiveResult;
}

export class CoursewareValidationError extends Error {
  constructor(
    message: string,
    readonly guardReport: CoursewareGuardReport,
    readonly knowledgeReport: CoursewareKnowledgeAuditReport,
    readonly resourceReport: CoursewareResourceAuditReport,
    readonly visualReport: CoursewareVisualAuditReport,
    readonly interactiveReport: CoursewareInteractiveAuditReport,
    readonly evidenceDir: string,
    readonly stage: Stage,
    readonly scenes: Scene[],
  ) {
    super(message);
    this.name = 'CoursewareValidationError';
  }
}

function emptyResourceReport(classroomId: string): CoursewareResourceAuditReport {
  return {
    schemaVersion: 'openmaic-courseware-resource-audit-v1',
    generatedAt: new Date().toISOString(),
    classroomId,
    publishable: true,
    counts: { critical: 0, warning: 0 },
    checked: 0,
    resources: [],
    issues: [],
  };
}

function emptyInteractiveReport(classroomId: string): CoursewareInteractiveAuditReport {
  return {
    schemaVersion: 'openmaic-courseware-interactive-audit-v1',
    generatedAt: new Date().toISOString(),
    classroomId,
    viewport: { width: 1280, height: 720 },
    publishable: true,
    counts: { critical: 0, warning: 0 },
    scenes: [],
    issues: [],
  };
}

function emptyVisualReport(classroomId: string): CoursewareVisualAuditReport {
  return {
    schemaVersion: 'openmaic-courseware-visual-audit-v1',
    generatedAt: new Date().toISOString(),
    classroomId,
    viewport: { width: 1600, height: 900 },
    publishable: true,
    counts: { critical: 0, warning: 0 },
    slides: [],
    issues: [],
  };
}

async function copyMissingScreenshots(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  let entries: Dirent[];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const source = path.join(sourceDir, entry.name);
      const target = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await copyMissingScreenshots(source, target);
        return;
      }
      if (!entry.isFile()) return;
      try {
        await fs.access(target);
      } catch {
        await fs.copyFile(source, target);
      }
    }),
  );
}

function repairIssueSignature(
  issues: Array<{ code: string; category?: string; elementIds?: string[] }>,
): string {
  return issues
    .map((issue) =>
      [issue.code, issue.category ?? '', [...(issue.elementIds ?? [])].sort().join(',')].join(':'),
    )
    .sort()
    .join('|');
}

export async function finalizeCourseware(
  options: FinalizeCoursewareOptions,
): Promise<FinalizedCourseware> {
  const storage = options.storage ?? fileSystemCoursewareAuditStorage;
  const auditPolicy =
    options.auditPolicy ??
    resolveCoursewareAuditPolicy({
      enableVisionAudit: !!options.reviewScreenshot,
      strictVisualSemantics: options.strictVisualSemantics,
    });
  const strictVisualSemantics = options.strictVisualSemantics ?? auditPolicy.strictVisualSemantics;
  await options.onPhase?.('validating', 'Checking and safely repairing classroom data');
  let guarded = guardCourseware(
    { stage: options.stage, scenes: options.scenes },
    { mode: 'safe-fix', contentPolicy: auditPolicy.contentPolicy },
  );
  const narrationRepairSceneIds = new Set(
    guarded.report.repairs
      .filter((repair) => repair.code === 'speech_portability_repaired' && repair.sceneId)
      .map((repair) => repair.sceneId as string),
  );
  if (options.regenerateNarrationAudio && narrationRepairSceneIds.size > 0) {
    const initialReport = guarded.report;
    const changedScenes = guarded.bundle.scenes.filter((scene) =>
      narrationRepairSceneIds.has(scene.id),
    );
    await options.regenerateNarrationAudio(changedScenes);
    const rechecked = guardCourseware(guarded.bundle, {
      mode: 'safe-fix',
      contentPolicy: auditPolicy.contentPolicy,
    });
    guarded = {
      bundle: rechecked.bundle,
      report: {
        ...rechecked.report,
        beforeFingerprint: initialReport.beforeFingerprint,
        changed: true,
        repairs: [...initialReport.repairs, ...rechecked.report.repairs],
      },
    };
  }

  const evidenceDir = path.join(
    process.cwd(),
    'data',
    'courseware-audits',
    guarded.bundle.stage.id,
    Date.now().toString(),
  );
  await fs.mkdir(evidenceDir, { recursive: true });

  const knowledgeReport = auditCoursewareKnowledgeContract(
    guarded.bundle.stage,
    guarded.bundle.scenes,
    options.outlines,
  );
  await fs.writeFile(
    path.join(evidenceDir, 'courseware-knowledge-report.json'),
    JSON.stringify(knowledgeReport, null, 2),
    'utf8',
  );
  if (!knowledgeReport.publishable) {
    const resourceReport = emptyResourceReport(guarded.bundle.stage.id);
    const visualReport = emptyVisualReport(guarded.bundle.stage.id);
    const interactiveReport = emptyInteractiveReport(guarded.bundle.stage.id);
    throw new CoursewareValidationError(
      `Courseware knowledge contract validation failed: ${knowledgeReport.counts.critical} critical issue(s). Evidence: ${evidenceDir}`,
      guarded.report,
      knowledgeReport,
      resourceReport,
      visualReport,
      interactiveReport,
      evidenceDir,
      guarded.bundle.stage,
      guarded.bundle.scenes,
    );
  }

  await options.onPhase?.('persisting', 'Persisting classroom data');
  let persisted = await storage.saveDraft(
    {
      id: guarded.bundle.stage.id,
      stage: guarded.bundle.stage,
      scenes: guarded.bundle.scenes,
    },
    options.baseUrl,
  );

  let resourceReport = auditPolicy.validateResources
    ? await auditCoursewareResources(guarded.bundle.stage, guarded.bundle.scenes, {
        blockExternalMedia: auditPolicy.blockExternalMedia,
        storage,
      })
    : emptyResourceReport(guarded.bundle.stage.id);
  await fs.writeFile(
    path.join(evidenceDir, 'courseware-resource-report.json'),
    JSON.stringify(resourceReport, null, 2),
    'utf8',
  );
  if (!resourceReport.publishable) {
    const visualReport = emptyVisualReport(guarded.bundle.stage.id);
    const interactiveReport = emptyInteractiveReport(guarded.bundle.stage.id);
    throw new CoursewareValidationError(
      `Courseware resource validation failed: ${resourceReport.counts.critical} critical issue(s). Evidence: ${evidenceDir}`,
      guarded.report,
      knowledgeReport,
      resourceReport,
      visualReport,
      interactiveReport,
      evidenceDir,
      guarded.bundle.stage,
      guarded.bundle.scenes,
    );
  }

  await options.onPhase?.(
    'visual_auditing',
    'Rendering and checking interactive scenes before model-based slide review',
  );
  let interactiveScreenshotsDir = path.join(evidenceDir, 'interactive-screenshots');
  let interactiveReport = auditPolicy.enableInteractiveAudit
    ? await runCoursewareInteractiveAudit({
        baseUrl: options.baseUrl,
        classroomId: guarded.bundle.stage.id,
        scenes: guarded.bundle.scenes,
        screenshotsDir: interactiveScreenshotsDir,
        concurrency: auditPolicy.interactiveAuditConcurrency,
        exercise: auditPolicy.exerciseInteractives,
        blockExternalMedia: auditPolicy.blockExternalMedia,
      })
    : emptyInteractiveReport(guarded.bundle.stage.id);
  await fs.writeFile(
    path.join(evidenceDir, 'courseware-interactive-report-pass-1.json'),
    JSON.stringify(interactiveReport, null, 2),
    'utf8',
  );

  await options.onPhase?.('visual_auditing', 'Rendering and visually checking every slide');
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
  let bestGuarded = guarded;
  let bestVisualReport = visualReport;
  let bestInteractiveReport = interactiveReport;
  let bestScreenshotsDir = screenshotsDir;
  let bestInteractiveScreenshotsDir = interactiveScreenshotsDir;
  let bestScore = repairScore(
    guarded.report,
    visualReport,
    interactiveReport,
    strictVisualSemantics,
  );
  let restoredBestAfterRegression = false;
  const repairScores = [{ pass: 1, score: bestScore, selected: true }];

  const repairFailures: Array<{ pass: number; sceneId: string; error: string }> = [];
  let repairPass = 0;
  const maxAutomaticRepairPasses = auditPolicy.maxAutomaticRepairPasses;
  const attemptedSignaturesByScene = new Map<string, Set<string>>();
  while (options.repairScene && repairPass < maxAutomaticRepairPasses) {
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
            (AI_REPAIRABLE_VISUAL_WARNING_CATEGORIES.has(issue.category) ||
              (strictVisualSemantics && issue.category === 'semantic_confusion')))),
    );
    const interactiveRepairIssues = interactiveReport.issues.filter(
      (issue) => issue.severity === 'critical' && AI_REPAIRABLE_INTERACTIVE_CODES.has(issue.code),
    );
    const candidateSceneIds = new Set([
      ...structuralRepairIssues.map((issue) => issue.sceneId as string),
      ...visualRepairIssues.map((issue) => issue.sceneId),
      ...interactiveRepairIssues.map((issue) => issue.sceneId),
    ]);
    const repairableSceneIds = new Set(
      [...candidateSceneIds].filter((sceneId) => {
        const sceneIssues = visualRepairIssues.filter((issue) => issue.sceneId === sceneId);
        const interactiveSceneIssues = interactiveRepairIssues.filter(
          (issue) => issue.sceneId === sceneId,
        );
        const structuralSceneIssues = structuralRepairIssues.filter(
          (issue) => issue.sceneId === sceneId,
        );
        const signature = repairIssueSignature([
          ...sceneIssues,
          ...interactiveSceneIssues,
          ...structuralSceneIssues.map((issue) => ({
            code: 'render_failed' as const,
            category: `${issue.code}:${issue.path}`,
          })),
        ]);
        const attempts = attemptedSignaturesByScene.get(sceneId) ?? new Set<string>();
        return attempts.size < auditPolicy.maxRepairsPerScene && !attempts.has(signature);
      }),
    );
    if (repairableSceneIds.size === 0) break;

    repairPass += 1;
    await options.onPhase?.(
      'repairing',
      `Automatic repair pass ${repairPass}: repairing ${repairableSceneIds.size} scene(s)`,
    );
    const repairedScenes = [...guarded.bundle.scenes];
    let repairedCount = 0;
    for (const sceneId of repairableSceneIds) {
      const sceneIndex = repairedScenes.findIndex((scene) => scene.id === sceneId);
      if (sceneIndex < 0) continue;
      const sceneIssues = visualRepairIssues.filter((issue) => issue.sceneId === sceneId);
      const interactiveSceneIssues = interactiveRepairIssues.filter(
        (issue) => issue.sceneId === sceneId,
      );
      const structuralSceneIssues = structuralRepairIssues.filter(
        (issue) => issue.sceneId === sceneId,
      );
      const signature = repairIssueSignature([
        ...sceneIssues,
        ...interactiveSceneIssues,
        ...structuralSceneIssues.map((issue) => ({
          code: 'render_failed' as const,
          category: `${issue.code}:${issue.path}`,
        })),
      ]);
      const attempts = attemptedSignaturesByScene.get(sceneId) ?? new Set<string>();
      attempts.add(signature);
      attemptedSignaturesByScene.set(sceneId, attempts);
      const issueSummary = [
        ...structuralSceneIssues.map((issue) => `${issue.code}: ${issue.path}`),
        ...sceneIssues.map(
          (issue) =>
            `${issue.code}${issue.category ? ` [${issue.category}]` : ''}${issue.elementIds?.length ? ` (${issue.elementIds.join(', ')})` : ''}: ${issue.message}`,
        ),
        ...interactiveSceneIssues.map(
          (issue) =>
            `${issue.code}${issue.resource ? ` (${issue.resource})` : ''}: ${issue.message}`,
        ),
      ].join('\n');
      const isInteractive = repairedScenes[sceneIndex].content.type === 'interactive';
      const repairInstruction = (
        isInteractive
          ? [
              'Fix only the interactive runtime defects listed below.',
              'Preserve the knowledge point, language, learner controls, observable relationships, and scene title.',
              'Return one self-contained HTML document that runs inside a sandboxed iframe without same-origin access.',
              'Use native HTML, CSS, JavaScript, SVG, or Canvas. Remove broken or unnecessary external network dependencies and do not use Blob URLs.',
              'Keep all visible text readable in a 1280 by 720 viewport. Do not replace the interaction with a static explanation.',
            ]
          : [
              'Fix only the slide defects listed below.',
              'Preserve the teaching meaning, language, narration, usable media, and stable element IDs whenever possible.',
              'If an existing bitmap diagram is illegible, garbled, cluttered, contains embedded labels that are too small to read, or conflicts with native labels, remove it and rebuild the essential diagram with native shapes, lines, text, and formulas.',
              'A bitmap flagged by the visual audit may already be removed from the source canvas. Do not recreate it, retain it behind new elements, or add another raster image containing instructional text.',
              'Do not cover an unreadable diagram with opaque annotation boxes, decorative overlays, or duplicated labels.',
              'Keep the layout simple, readable, and free of overlap; do not add unrelated content.',
              'Use valid SVG path data only, preferring the canonical rectangle or circle paths for simple shapes.',
            ]
      )
        .concat(issueSummary)
        .join('\n\n');
      try {
        const repaired = await options.repairScene(repairedScenes[sceneIndex], repairInstruction, {
          visualIssues: sceneIssues,
          interactiveIssues: interactiveSceneIssues,
          hasStructuralIssues: structuralSceneIssues.length > 0,
        });
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
      { mode: 'safe-fix', contentPolicy: auditPolicy.contentPolicy },
    );
    persisted = await storage.saveDraft(
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
    const previousVisualReport = visualReport;
    const previousInteractiveReport = interactiveReport;
    const previousScreenshotsDir = screenshotsDir;
    const previousInteractiveScreenshotsDir = interactiveScreenshotsDir;
    screenshotsDir = path.join(
      evidenceDir,
      repairPass === 1 ? 'screenshots-repaired' : `screenshots-repaired-pass-${repairPass}`,
    );
    interactiveScreenshotsDir = path.join(
      evidenceDir,
      repairPass === 1
        ? 'interactive-screenshots-repaired'
        : `interactive-screenshots-repaired-pass-${repairPass}`,
    );
    const [partialVisualReport, partialInteractiveReport] = await Promise.all([
      runCoursewareVisualAudit({
        baseUrl: options.baseUrl,
        classroomId: guarded.bundle.stage.id,
        scenes: guarded.bundle.scenes,
        screenshotsDir,
        reviewScreenshot: options.reviewScreenshot,
        sceneIds: repairableSceneIds,
      }),
      auditPolicy.enableInteractiveAudit
        ? runCoursewareInteractiveAudit({
            baseUrl: options.baseUrl,
            classroomId: guarded.bundle.stage.id,
            scenes: guarded.bundle.scenes,
            screenshotsDir: interactiveScreenshotsDir,
            concurrency: auditPolicy.interactiveAuditConcurrency,
            exercise: auditPolicy.exerciseInteractives,
            blockExternalMedia: auditPolicy.blockExternalMedia,
            sceneIds: repairableSceneIds,
          })
        : Promise.resolve(emptyInteractiveReport(guarded.bundle.stage.id)),
    ]);
    await Promise.all([
      copyMissingScreenshots(previousScreenshotsDir, screenshotsDir),
      copyMissingScreenshots(previousInteractiveScreenshotsDir, interactiveScreenshotsDir),
    ]);
    visualReport = mergeCoursewareVisualAuditReports(
      previousVisualReport,
      partialVisualReport,
      guarded.bundle.scenes,
    );
    interactiveReport = mergeCoursewareInteractiveAuditReports(
      previousInteractiveReport,
      partialInteractiveReport,
      guarded.bundle.scenes,
    );
    await Promise.all([
      fs.writeFile(
        path.join(evidenceDir, `courseware-visual-report-pass-${repairPass + 1}.json`),
        JSON.stringify(visualReport, null, 2),
        'utf-8',
      ),
      fs.writeFile(
        path.join(evidenceDir, `courseware-interactive-report-pass-${repairPass + 1}.json`),
        JSON.stringify(interactiveReport, null, 2),
        'utf-8',
      ),
    ]);
    const currentScore = repairScore(
      guarded.report,
      visualReport,
      interactiveReport,
      strictVisualSemantics,
    );
    if (currentScore < bestScore) {
      bestGuarded = guarded;
      bestVisualReport = visualReport;
      bestInteractiveReport = interactiveReport;
      bestScreenshotsDir = screenshotsDir;
      bestInteractiveScreenshotsDir = interactiveScreenshotsDir;
      bestScore = currentScore;
      repairScores.push({ pass: repairPass + 1, score: currentScore, selected: true });
    } else if (currentScore > bestScore) {
      repairScores.push({ pass: repairPass + 1, score: currentScore, selected: false });
      if (
        hasOnlyDeterministicVisualCriticalIssues(guarded.report, visualReport, interactiveReport)
      ) {
        console.warn(
          `[courseware-finalize] repair pass ${repairPass} introduced deterministic layout defects (${currentScore} > ${bestScore}); stabilizing the current bundle before rollback`,
        );
      } else {
        guarded = bestGuarded;
        visualReport = bestVisualReport;
        interactiveReport = bestInteractiveReport;
        screenshotsDir = bestScreenshotsDir;
        interactiveScreenshotsDir = bestInteractiveScreenshotsDir;
        restoredBestAfterRegression = true;
        console.warn(
          `[courseware-finalize] repair pass ${repairPass} regressed (${currentScore} > ${bestScore}); retrying from the best prior bundle`,
        );
      }
    } else {
      repairScores.push({ pass: repairPass + 1, score: currentScore, selected: false });
    }
  }

  if (
    repairScore(guarded.report, visualReport, interactiveReport, strictVisualSemantics) > bestScore
  ) {
    guarded = bestGuarded;
    visualReport = bestVisualReport;
    interactiveReport = bestInteractiveReport;
    screenshotsDir = bestScreenshotsDir;
    interactiveScreenshotsDir = bestInteractiveScreenshotsDir;
    restoredBestAfterRegression = true;
  }

  await fs.writeFile(
    path.join(evidenceDir, 'courseware-repair-scores.json'),
    JSON.stringify(repairScores, null, 2),
    'utf-8',
  );

  if (repairFailures.length > 0) {
    await fs.writeFile(
      path.join(evidenceDir, 'courseware-repair-failures.json'),
      JSON.stringify(repairFailures, null, 2),
      'utf-8',
    );
  }

  if (restoredBestAfterRegression) {
    persisted = await storage.saveDraft(
      {
        id: guarded.bundle.stage.id,
        stage: guarded.bundle.stage,
        scenes: guarded.bundle.scenes,
      },
      options.baseUrl,
    );
  }

  if (auditPolicy.validateResources) {
    resourceReport = await auditCoursewareResources(guarded.bundle.stage, guarded.bundle.scenes, {
      blockExternalMedia: auditPolicy.blockExternalMedia,
      storage,
    });
  }

  if (strictVisualSemantics) {
    const blockingWarnings = visualReport.issues.filter(isStrictBlockingWarning);
    if (blockingWarnings.length > 0) {
      visualReport = { ...visualReport, publishable: false };
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
    fs.writeFile(
      path.join(evidenceDir, 'courseware-resource-report.json'),
      JSON.stringify(resourceReport, null, 2),
      'utf-8',
    ),
    fs.writeFile(
      path.join(evidenceDir, 'courseware-interactive-report.json'),
      JSON.stringify(interactiveReport, null, 2),
      'utf-8',
    ),
  ]);

  if (
    !guarded.report.publishable ||
    !resourceReport.publishable ||
    !visualReport.publishable ||
    !interactiveReport.publishable
  ) {
    throw new CoursewareValidationError(
      `Courseware validation failed: ${guarded.report.counts.critical} structural, ${resourceReport.counts.critical} resource, ${visualReport.counts.critical} slide visual, and ${interactiveReport.counts.critical} interactive critical issue(s). Evidence: ${evidenceDir}`,
      guarded.report,
      knowledgeReport,
      resourceReport,
      visualReport,
      interactiveReport,
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
    knowledgeReport,
    resourceReport,
    visualReport,
    interactiveReport,
    screenshotsDir,
    interactiveScreenshotsDir,
    storage,
  });

  return {
    id: persisted.id,
    url: persisted.url,
    createdAt: persisted.createdAt,
    stage: guarded.bundle.stage,
    scenes: guarded.bundle.scenes,
    guardReport: guarded.report,
    knowledgeReport,
    resourceReport,
    visualReport,
    interactiveReport,
    archive,
  };
}
