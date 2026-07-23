'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Loader2,
  Pencil,
  ScanSearch,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { guardCourseware, type CoursewareIssue } from '@/lib/courseware-guard';
import type { CoursewareAuditProfile } from '@/lib/courseware-guard/audit-policy';
import {
  CoursewareFinalizationClientError,
  finalizeCurrentCourseware,
} from '@/lib/courseware-guard/finalize-client';
import type {
  CoursewareResourceAuditReport,
  CoursewareResourceIssue,
} from '@/lib/courseware-guard/resource-audit';
import type {
  CoursewareInteractiveAuditReport,
  InteractiveAuditIssue,
} from '@/lib/courseware-guard/interactive-audit';
import type {
  CoursewareKnowledgeAuditReport,
  KnowledgeAuditIssue,
} from '@/lib/courseware-guard/knowledge-audit';
import type {
  CoursewareVisualAuditReport,
  VisualAuditIssue,
} from '@/lib/courseware-guard/visual-audit';
import type { StageMode } from '@/lib/types/stage';
import { cn } from '@/lib/utils';

interface CoursewareGuardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: StageMode;
  onToggleEditMode?: () => void;
  onExportCourseware: () => void;
  exporting: boolean;
}

const ISSUE_LABELS: Record<string, string> = {
  stage_id_missing: 'stageIdMissing',
  stage_name_missing: 'stageNameMissing',
  course_has_no_scenes: 'courseHasNoScenes',
  scene_id_missing: 'sceneIdMissing',
  scene_id_duplicate: 'sceneIdDuplicate',
  scene_stage_link_invalid: 'sceneStageLinkInvalid',
  scene_title_missing: 'sceneTitleMissing',
  scene_order_invalid: 'sceneOrderInvalid',
  scene_content_missing: 'sceneContentMissing',
  scene_type_mismatch: 'sceneTypeMismatch',
  content_mojibake_detected: 'contentMojibakeDetected',
  slide_canvas_invalid: 'slideCanvasInvalid',
  slide_element_invalid: 'slideElementInvalid',
  slide_element_id_invalid: 'slideElementIdInvalid',
  slide_element_geometry_invalid: 'slideElementGeometryInvalid',
  slide_viewport_invalid: 'slideViewportInvalid',
  slide_element_size_invalid: 'slideElementSizeInvalid',
  slide_element_out_of_bounds: 'slideElementOutOfBounds',
  slide_content_overlap: 'slideContentOverlap',
  quiz_questions_missing: 'quizQuestionsMissing',
  quiz_question_invalid: 'quizQuestionInvalid',
  quiz_question_id_invalid: 'quizQuestionIdInvalid',
  quiz_question_text_missing: 'quizQuestionTextMissing',
  quiz_options_invalid: 'quizOptionsInvalid',
  quiz_answer_not_in_options: 'quizAnswerNotInOptions',
  interactive_source_missing: 'interactiveSourceMissing',
  interactive_doctype_missing: 'interactiveDoctypeMissing',
  interactive_unsafe_url: 'interactiveUnsafeUrl',
  pbl_project_missing: 'pblProjectMissing',
};

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'courseware';
}

function issueLocation(
  issue: CoursewareIssue,
  scenes: ReturnType<typeof useStageStore.getState>['scenes'],
) {
  const sceneIndex = issue.sceneId ? scenes.findIndex((scene) => scene.id === issue.sceneId) : -1;
  const scene = sceneIndex >= 0 ? scenes[sceneIndex] : undefined;
  const elementMatch = issue.path.match(/\.elements\[(\d+)\](?:\.([^.]+))?$/);
  let elementId: string | undefined;
  if (scene?.content.type === 'slide' && elementMatch) {
    const element = scene.content.canvas.elements[Number(elementMatch[1])];
    elementId = element?.id;
  }
  return [
    sceneIndex >= 0 ? String(sceneIndex + 1).padStart(2, '0') : undefined,
    scene?.title,
    elementId,
    elementMatch?.[2],
  ]
    .filter(Boolean)
    .join(' · ');
}

function visualIssueLocation(
  issue: VisualAuditIssue,
  scenes: ReturnType<typeof useStageStore.getState>['scenes'],
) {
  const sceneIndex = scenes.findIndex((scene) => scene.id === issue.sceneId);
  const scene = sceneIndex >= 0 ? scenes[sceneIndex] : undefined;
  return [
    sceneIndex >= 0 ? String(sceneIndex + 1).padStart(2, '0') : undefined,
    scene?.title,
    issue.category,
    issue.elementIds?.join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
}

function sceneIssueLocation(
  issue: Pick<CoursewareResourceIssue | InteractiveAuditIssue | KnowledgeAuditIssue, 'sceneId'>,
  scenes: ReturnType<typeof useStageStore.getState>['scenes'],
) {
  const sceneIndex = issue.sceneId ? scenes.findIndex((scene) => scene.id === issue.sceneId) : -1;
  const scene = sceneIndex >= 0 ? scenes[sceneIndex] : undefined;
  return [sceneIndex >= 0 ? String(sceneIndex + 1).padStart(2, '0') : undefined, scene?.title]
    .filter(Boolean)
    .join(' · ');
}

export function CoursewareGuardDialog({
  open,
  onOpenChange,
  mode,
  onToggleEditMode,
  onExportCourseware,
  exporting,
}: CoursewareGuardDialogProps) {
  const { t } = useI18n();
  const stage = useStageStore((state) => state.stage);
  const scenes = useStageStore((state) => state.scenes);
  const setScenes = useStageStore((state) => state.setScenes);
  const setCurrentSceneId = useStageStore((state) => state.setCurrentSceneId);
  const [finalizing, setFinalizing] = useState(false);
  const [auditProfile, setAuditProfile] = useState<CoursewareAuditProfile>('balanced');
  const [lastVisualReport, setLastVisualReport] = useState<CoursewareVisualAuditReport | null>(
    null,
  );
  const [lastResourceReport, setLastResourceReport] =
    useState<CoursewareResourceAuditReport | null>(null);
  const [lastKnowledgeReport, setLastKnowledgeReport] =
    useState<CoursewareKnowledgeAuditReport | null>(null);
  const [lastInteractiveReport, setLastInteractiveReport] =
    useState<CoursewareInteractiveAuditReport | null>(null);

  const result = useMemo(
    () =>
      stage
        ? guardCourseware({ stage, scenes }, { mode: 'inspect', contentPolicy: 'strict' })
        : null,
    [stage, scenes],
  );
  const report = result?.report;
  const overallCritical =
    (report?.counts.critical ?? 0) +
    (lastKnowledgeReport?.counts.critical ?? 0) +
    (lastResourceReport?.counts.critical ?? 0) +
    (lastVisualReport?.counts.critical ?? 0) +
    (lastInteractiveReport?.counts.critical ?? 0);
  const overallWarning =
    (report?.counts.warning ?? 0) +
    (lastKnowledgeReport?.counts.warning ?? 0) +
    (lastResourceReport?.counts.warning ?? 0) +
    (lastVisualReport?.counts.warning ?? 0) +
    (lastInteractiveReport?.counts.warning ?? 0);
  const overallPublishable = Boolean(
    report?.publishable &&
    (!lastKnowledgeReport || lastKnowledgeReport.publishable) &&
    (!lastResourceReport || lastResourceReport.publishable) &&
    (!lastVisualReport || lastVisualReport.publishable) &&
    (!lastInteractiveReport || lastInteractiveReport.publishable),
  );

  const applySafeFixes = () => {
    if (!stage) return;
    const currentSceneId = useStageStore.getState().currentSceneId;
    const fixed = guardCourseware({ stage, scenes }, { mode: 'safe-fix', contentPolicy: 'strict' });
    if (!fixed.report.changed) return;
    if (JSON.stringify(stage) !== JSON.stringify(fixed.bundle.stage)) {
      useStageStore.setState({ stage: fixed.bundle.stage });
    }
    setScenes(fixed.bundle.scenes);
    const nextCurrent = fixed.bundle.scenes.some((scene) => scene.id === currentSceneId)
      ? currentSceneId
      : (fixed.bundle.scenes[0]?.id ?? null);
    setCurrentSceneId(nextCurrent);
  };

  const openIssueInProMode = (issue: CoursewareIssue) => {
    if (!issue.sceneId || !scenes.some((scene) => scene.id === issue.sceneId)) return;
    setCurrentSceneId(issue.sceneId);
    onOpenChange(false);
    if (mode !== 'edit' && onToggleEditMode) window.setTimeout(onToggleEditMode, 0);
  };

  const issueLabel = (issue: CoursewareIssue) => {
    const key = ISSUE_LABELS[issue.code];
    return key ? t(`coursewareGuard.issues.${key}`) : (issue.message ?? issue.code);
  };

  const runFullAuditAndRepair = async () => {
    setFinalizing(true);
    setLastVisualReport(null);
    setLastKnowledgeReport(null);
    setLastResourceReport(null);
    setLastInteractiveReport(null);
    const toastId = toast.loading(t('coursewareGuard.fullAuditRunning'));
    try {
      const finalized = await finalizeCurrentCourseware({ auditProfile });
      setLastKnowledgeReport(finalized.knowledgeReport);
      setLastResourceReport(finalized.resourceReport);
      setLastVisualReport(finalized.visualReport);
      setLastInteractiveReport(finalized.interactiveReport);
      toast.success(t('coursewareGuard.fullAuditSuccess'), {
        id: toastId,
        description: finalized.archive?.path,
        duration: 12_000,
      });
    } catch (error) {
      if (error instanceof CoursewareFinalizationClientError) {
        setLastKnowledgeReport(error.knowledgeReport ?? null);
        setLastResourceReport(error.resourceReport ?? null);
        setLastVisualReport(error.visualReport ?? null);
        setLastInteractiveReport(error.interactiveReport ?? null);
      }
      toast.error(t('coursewareGuard.fullAuditFailed'), {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
        duration: 15_000,
      });
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[800px] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:h-[calc(100dvh-2rem)]">
        <div className="shrink-0 border-b px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldCheck className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>{t('coursewareGuard.title')}</DialogTitle>
              <DialogDescription className="mt-1">
                {t('coursewareGuard.description')}
              </DialogDescription>
            </div>
          </div>
        </div>

        {report ? (
          <>
            <div className="grid shrink-0 grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
              <SummaryCell
                label={t('coursewareGuard.critical')}
                value={overallCritical}
                tone={overallCritical > 0 ? 'critical' : 'ok'}
              />
              <SummaryCell
                label={t('coursewareGuard.warning')}
                value={overallWarning}
                tone={overallWarning > 0 ? 'warning' : 'ok'}
              />
              <SummaryCell
                label={t('coursewareGuard.info')}
                value={report.counts.info}
                tone={report.counts.info > 0 ? 'info' : 'ok'}
              />
              <SummaryCell
                label={t('coursewareGuard.status')}
                value={
                  overallPublishable
                    ? t('coursewareGuard.publishable')
                    : t('coursewareGuard.blocked')
                }
                tone={overallPublishable ? 'ok' : 'critical'}
              />
            </div>

            <ScrollArea className="min-h-0 flex-1 basis-0 overscroll-contain">
              <div className="space-y-2 p-5">
                {report.issues.length === 0 ? (
                  <div className="flex min-h-40 flex-col items-center justify-center text-center">
                    <CheckCircle2 className="mb-3 size-9 text-emerald-600" />
                    <p className="font-medium">{t('coursewareGuard.noIssues')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('coursewareGuard.readyToDownload')}
                    </p>
                  </div>
                ) : (
                  report.issues.map((issue) => {
                    const location = issueLocation(issue, scenes);
                    return (
                      <div
                        key={issue.id}
                        className="flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-start"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          {issue.severity === 'critical' ? (
                            <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                          ) : issue.severity === 'warning' ? (
                            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                          ) : (
                            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-600" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{issueLabel(issue)}</p>
                            {location && (
                              <p className="mt-1 break-words text-xs font-medium text-muted-foreground">
                                {location}
                              </p>
                            )}
                            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                              {issue.path}
                            </p>
                          </div>
                        </div>
                        {issue.sceneId && !issue.repairable && onToggleEditMode && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full shrink-0 sm:w-auto"
                            aria-label={`${t('coursewareGuard.editInProMode')}: ${location}`}
                            onClick={() => openIssueInProMode(issue)}
                          >
                            <Pencil className="size-3.5" />
                            {t('coursewareGuard.editInProMode')}
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
                {lastKnowledgeReport && (
                  <div className="pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">
                        {t('coursewareGuard.knowledgeFindings')}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {lastKnowledgeReport.issues.length}
                      </span>
                    </div>
                    {!lastKnowledgeReport.contractAvailable ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        {t('coursewareGuard.knowledgeContractUnavailable')}
                      </div>
                    ) : lastKnowledgeReport.issues.length === 0 ? (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                        {t('coursewareGuard.noKnowledgeIssues')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {lastKnowledgeReport.issues.map((issue) => {
                          const location = sceneIssueLocation(issue, scenes);
                          return (
                            <div
                              key={issue.id}
                              className="flex items-start gap-3 rounded-md border bg-background p-3"
                            >
                              {issue.severity === 'critical' ? (
                                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                              ) : (
                                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{issue.message}</p>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  {location || issue.outlineId}
                                </p>
                                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                  {issue.code}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {lastResourceReport && (
                  <div className="pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">
                        {t('coursewareGuard.resourceFindings')}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {lastResourceReport.issues.length}
                      </span>
                    </div>
                    {lastResourceReport.issues.length === 0 ? (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                        {t('coursewareGuard.noResourceIssues')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {lastResourceReport.issues.map((issue) => {
                          const location = sceneIssueLocation(issue, scenes);
                          return (
                            <div
                              key={issue.id}
                              className="flex items-start gap-3 rounded-md border bg-background p-3"
                            >
                              {issue.severity === 'critical' ? (
                                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                              ) : (
                                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{issue.message}</p>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  {location || issue.path}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                                  {issue.code}
                                  {issue.resource ? ` · ${issue.resource}` : ''}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {lastVisualReport && (
                  <div className="pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">
                        {t('coursewareGuard.visualFindings')}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {lastVisualReport.issues.length}
                      </span>
                    </div>
                    {lastVisualReport.issues.length === 0 ? (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                        {t('coursewareGuard.noVisualIssues')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {lastVisualReport.issues.map((issue) => {
                          const location = visualIssueLocation(issue, scenes);
                          return (
                            <div
                              key={issue.id}
                              className="flex items-start gap-3 rounded-md border bg-background p-3"
                            >
                              {issue.severity === 'critical' ? (
                                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                              ) : (
                                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{issue.message}</p>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  {location || issue.sceneId}
                                </p>
                                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                  {issue.code}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {lastInteractiveReport && (
                  <div className="pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">
                        {t('coursewareGuard.interactiveFindings')}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {lastInteractiveReport.issues.length}
                      </span>
                    </div>
                    {lastInteractiveReport.issues.length === 0 ? (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                        {t('coursewareGuard.noInteractiveIssues')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {lastInteractiveReport.issues.map((issue) => {
                          const location = sceneIssueLocation(issue, scenes);
                          return (
                            <div
                              key={issue.id}
                              className="flex items-start gap-3 rounded-md border bg-background p-3"
                            >
                              {issue.severity === 'critical' ? (
                                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                              ) : (
                                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{issue.message}</p>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  {location || issue.sceneId}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                                  {issue.code}
                                  {issue.resource ? ` · ${issue.resource}` : ''}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex shrink-0 flex-col gap-3 border-t bg-muted/30 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                  value={auditProfile}
                  onValueChange={(value) => setAuditProfile(value as CoursewareAuditProfile)}
                >
                  <TabsList>
                    <TabsTrigger value="fast" disabled={finalizing}>
                      {t('coursewareGuard.auditProfileFast')}
                    </TabsTrigger>
                    <TabsTrigger value="balanced" disabled={finalizing}>
                      {t('coursewareGuard.auditProfileBalanced')}
                    </TabsTrigger>
                    <TabsTrigger value="strict" disabled={finalizing}>
                      {t('coursewareGuard.auditProfileStrict')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button
                  onClick={onExportCourseware}
                  disabled={finalizing || !overallPublishable || exporting}
                  className="bg-emerald-700 text-white hover:bg-emerald-800"
                >
                  {exporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {t('coursewareGuard.downloadCourseware')}
                </Button>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <Button
                  className="w-full sm:w-auto"
                  onClick={runFullAuditAndRepair}
                  disabled={finalizing || !stage}
                >
                  {finalizing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ScanSearch className="size-4" />
                  )}
                  {finalizing
                    ? t('coursewareGuard.fullAuditRunning')
                    : t('coursewareGuard.fullAuditRepair')}
                </Button>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={applySafeFixes}
                  disabled={finalizing || !report.issues.some((issue) => issue.repairable)}
                >
                  <Wrench className="size-4" />
                  {t('coursewareGuard.safeFix')}
                </Button>
                <Button
                  variant="outline"
                  className="col-span-2 w-full sm:w-auto"
                  disabled={finalizing}
                  onClick={() =>
                    downloadJson(`${safeFileName(stage?.name ?? 'courseware')}-guard-report.json`, {
                      structural: report,
                      knowledge: lastKnowledgeReport,
                      resources: lastResourceReport,
                      visual: lastVisualReport,
                      interactive: lastInteractiveReport,
                    })
                  }
                >
                  <FileJson className="size-4" />
                  {t('coursewareGuard.downloadReport')}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t('coursewareGuard.noCourse')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'critical' | 'warning' | 'info' | 'ok';
}) {
  return (
    <div className="bg-background px-4 py-3">
      <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold',
          tone === 'critical' && 'text-red-600 dark:text-red-400',
          tone === 'warning' && 'text-amber-700 dark:text-amber-400',
          tone === 'info' && 'text-sky-700 dark:text-sky-400',
          tone === 'ok' && 'text-emerald-700 dark:text-emerald-400',
        )}
      >
        {value}
      </p>
    </div>
  );
}
