'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Loader2,
  Pencil,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { guardCourseware, type CoursewareIssue } from '@/lib/courseware-guard';
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

  const result = useMemo(
    () => (stage ? guardCourseware({ stage, scenes }, { mode: 'inspect' }) : null),
    [stage, scenes],
  );
  const report = result?.report;

  const applySafeFixes = () => {
    if (!stage) return;
    const currentSceneId = useStageStore.getState().currentSceneId;
    const fixed = guardCourseware({ stage, scenes }, { mode: 'safe-fix' });
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
    return key ? t(`coursewareGuard.issues.${key}`) : issue.code;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b px-6 py-5">
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
            <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
              <SummaryCell
                label={t('coursewareGuard.critical')}
                value={report.counts.critical}
                tone="critical"
              />
              <SummaryCell
                label={t('coursewareGuard.warning')}
                value={report.counts.warning}
                tone="warning"
              />
              <SummaryCell
                label={t('coursewareGuard.info')}
                value={report.counts.info}
                tone="info"
              />
              <SummaryCell
                label={t('coursewareGuard.status')}
                value={
                  report.publishable
                    ? t('coursewareGuard.publishable')
                    : t('coursewareGuard.blocked')
                }
                tone={report.publishable ? 'ok' : 'critical'}
              />
            </div>

            <ScrollArea className="min-h-0 flex-1">
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
                  report.issues.map((issue) => (
                    <div
                      key={issue.id}
                      className="flex items-start gap-3 rounded-md border bg-background p-3"
                    >
                      {issue.severity === 'critical' ? (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                      ) : issue.severity === 'warning' ? (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      ) : (
                        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-600" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{issueLabel(issue)}</p>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                          {issue.path}
                        </p>
                      </div>
                      {issue.sceneId && !issue.repairable && onToggleEditMode && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => openIssueInProMode(issue)}
                        >
                          <Pencil className="size-3.5" />
                          {t('coursewareGuard.editInProMode')}
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={applySafeFixes}
                  disabled={!report.issues.some((issue) => issue.repairable)}
                >
                  <Wrench className="size-4" />
                  {t('coursewareGuard.safeFix')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadJson(
                      `${safeFileName(stage?.name ?? 'courseware')}-guard-report.json`,
                      report,
                    )
                  }
                >
                  <FileJson className="size-4" />
                  {t('coursewareGuard.downloadReport')}
                </Button>
              </div>
              <Button
                onClick={onExportCourseware}
                disabled={!report.publishable || exporting}
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
