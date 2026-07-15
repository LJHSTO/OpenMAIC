import type { Scene, Stage } from '@/lib/types/stage';

export type CoursewareGuardMode = 'inspect' | 'safe-fix';
export type CoursewareIssueSeverity = 'critical' | 'warning' | 'info';

export interface CoursewareBundle {
  stage: Stage;
  scenes: Scene[];
}

export interface CoursewareIssue {
  id: string;
  code: string;
  severity: CoursewareIssueSeverity;
  path: string;
  sceneId?: string;
  repairable: boolean;
}

export interface CoursewareRepair {
  code: string;
  path: string;
  sceneId?: string;
}

export interface CoursewareGuardReport {
  schemaVersion: 'openmaic-courseware-guard-v1';
  mode: CoursewareGuardMode;
  beforeFingerprint: string;
  afterFingerprint: string;
  changed: boolean;
  publishable: boolean;
  counts: Record<CoursewareIssueSeverity, number>;
  issues: CoursewareIssue[];
  repairs: CoursewareRepair[];
}

export interface CoursewareGuardResult {
  bundle: CoursewareBundle;
  report: CoursewareGuardReport;
}

const SCENE_TYPES = new Set(['slide', 'quiz', 'interactive', 'pbl']);
const OVERLAP_SENSITIVE_ELEMENT_TYPES = new Set(['text', 'table', 'chart', 'latex', 'code']);
const SIGNIFICANT_OVERLAP_RATIO = 0.15;

interface ElementGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

function readElementGeometry(element: Record<string, unknown>): ElementGeometry | null {
  const { left, top, width, height } = element;
  if (![left, top, width, height].every(Number.isFinite)) return null;
  return {
    left: left as number,
    top: top as number,
    width: width as number,
    height: height as number,
  };
}

function overlapRatio(left: ElementGeometry, right: ElementGeometry): number {
  if (left.width <= 0 || left.height <= 0 || right.width <= 0 || right.height <= 0) return 0;
  const overlapWidth = Math.max(
    0,
    Math.min(left.left + left.width, right.left + right.width) - Math.max(left.left, right.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top),
  );
  const overlapArea = overlapWidth * overlapHeight;
  return overlapArea / Math.min(left.width * left.height, right.width * right.height);
}
const MOJIBAKE_PATTERN = /(?:\uFFFD|Ã.|Â.|â€|ðŸ|鈥|锟斤拷)/;

function cloneBundle(bundle: CoursewareBundle): CoursewareBundle {
  return JSON.parse(JSON.stringify(bundle)) as CoursewareBundle;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function fingerprint(value: unknown): string {
  const input = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function uniqueId(preferred: unknown, prefix: string, used: Set<string>): string {
  const base =
    typeof preferred === 'string' && preferred.trim()
      ? preferred.trim()
      : `${prefix}-${used.size + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function applySafeFixes(bundle: CoursewareBundle): CoursewareRepair[] {
  const repairs: CoursewareRepair[] = [];
  const stage = bundle.stage as Stage & Record<string, unknown>;
  const originalStageId = typeof stage.id === 'string' ? stage.id.trim() : '';
  if (!originalStageId) {
    stage.id = `stage-${fingerprint(bundle).slice(-8)}`;
    repairs.push({ code: 'stage_id_generated', path: 'stage.id' });
  }
  if (typeof stage.name !== 'string' || !stage.name.trim()) {
    stage.name = 'Untitled course';
    repairs.push({ code: 'stage_name_defaulted', path: 'stage.name' });
  }

  const usedSceneIds = new Set<string>();
  let normalizeOrder = false;
  const usedOrders = new Set<number>();
  for (const scene of bundle.scenes) {
    if (!Number.isFinite(scene.order) || usedOrders.has(scene.order)) normalizeOrder = true;
    else usedOrders.add(scene.order);
  }

  bundle.scenes.forEach((scene, sceneIndex) => {
    const record = scene as Scene & Record<string, unknown>;
    const originalId = record.id;
    const nextId = uniqueId(originalId, 'scene', usedSceneIds);
    if (nextId !== originalId) {
      record.id = nextId;
      repairs.push({
        code: 'scene_id_normalized',
        path: `scenes[${sceneIndex}].id`,
        sceneId: nextId,
      });
    }
    if (record.stageId !== stage.id) {
      record.stageId = stage.id;
      repairs.push({
        code: 'scene_stage_link_repaired',
        path: `scenes[${sceneIndex}].stageId`,
        sceneId: nextId,
      });
    }
    if (typeof record.title !== 'string' || !record.title.trim()) {
      record.title = `Untitled scene ${sceneIndex + 1}`;
      repairs.push({
        code: 'scene_title_defaulted',
        path: `scenes[${sceneIndex}].title`,
        sceneId: nextId,
      });
    }
    if (normalizeOrder && record.order !== sceneIndex) {
      record.order = sceneIndex;
      repairs.push({
        code: 'scene_order_normalized',
        path: `scenes[${sceneIndex}].order`,
        sceneId: nextId,
      });
    }

    const content = record.content as unknown as Record<string, unknown> | undefined;
    if (content && SCENE_TYPES.has(String(content.type)) && record.type !== content.type) {
      record.type = content.type as Scene['type'];
      repairs.push({
        code: 'scene_type_aligned',
        path: `scenes[${sceneIndex}].type`,
        sceneId: nextId,
      });
    }

    if (content?.type === 'slide') {
      const canvas = content.canvas as Record<string, unknown> | undefined;
      if (canvas && (typeof canvas.id !== 'string' || !canvas.id.trim())) {
        canvas.id = `slide-${nextId}`;
        repairs.push({
          code: 'slide_id_generated',
          path: `scenes[${sceneIndex}].content.canvas.id`,
          sceneId: nextId,
        });
      }
      if (canvas && Array.isArray(canvas.elements)) {
        const usedElementIds = new Set<string>();
        canvas.elements.forEach((element, elementIndex) => {
          if (!element || typeof element !== 'object') return;
          const elementRecord = element as Record<string, unknown>;
          const originalElementId = elementRecord.id;
          const nextElementId = uniqueId(
            originalElementId,
            `element-${sceneIndex + 1}`,
            usedElementIds,
          );
          if (nextElementId !== originalElementId) {
            elementRecord.id = nextElementId;
            repairs.push({
              code: 'slide_element_id_normalized',
              path: `scenes[${sceneIndex}].content.canvas.elements[${elementIndex}].id`,
              sceneId: nextId,
            });
          }
        });
      }
    }

    if (content?.type === 'quiz' && Array.isArray(content.questions)) {
      const usedQuestionIds = new Set<string>();
      content.questions.forEach((question, questionIndex) => {
        if (!question || typeof question !== 'object') return;
        const questionRecord = question as Record<string, unknown>;
        const originalQuestionId = questionRecord.id;
        const nextQuestionId = uniqueId(
          originalQuestionId,
          `question-${sceneIndex + 1}`,
          usedQuestionIds,
        );
        if (nextQuestionId !== originalQuestionId) {
          questionRecord.id = nextQuestionId;
          repairs.push({
            code: 'quiz_question_id_normalized',
            path: `scenes[${sceneIndex}].content.questions[${questionIndex}].id`,
            sceneId: nextId,
          });
        }
      });
    }

    if (content?.type === 'interactive' && typeof content.html === 'string') {
      const html = content.html.trim();
      if (html && !/^<!doctype\s+html/i.test(html)) {
        content.html = `<!doctype html>\n${html}`;
        repairs.push({
          code: 'interactive_doctype_added',
          path: `scenes[${sceneIndex}].content.html`,
          sceneId: nextId,
        });
      }
    }
  });

  return repairs;
}

function inspectBundle(bundle: CoursewareBundle): CoursewareIssue[] {
  const issues: CoursewareIssue[] = [];
  let issueIndex = 0;
  const add = (
    code: string,
    severity: CoursewareIssueSeverity,
    path: string,
    repairable: boolean,
    sceneId?: string,
  ) => {
    issueIndex += 1;
    issues.push({
      id: `guard-${String(issueIndex).padStart(4, '0')}`,
      code,
      severity,
      path,
      repairable,
      sceneId,
    });
  };

  const stage = bundle.stage as Stage & Record<string, unknown>;
  if (typeof stage?.id !== 'string' || !stage.id.trim())
    add('stage_id_missing', 'critical', 'stage.id', true);
  if (typeof stage?.name !== 'string' || !stage.name.trim())
    add('stage_name_missing', 'warning', 'stage.name', true);
  if (!Array.isArray(bundle.scenes) || bundle.scenes.length === 0) {
    add('course_has_no_scenes', 'critical', 'scenes', false);
    return issues;
  }

  const sceneIds = new Set<string>();
  const orders = new Set<number>();
  bundle.scenes.forEach((scene, sceneIndex) => {
    const record = scene as Scene & Record<string, unknown>;
    const path = `scenes[${sceneIndex}]`;
    const sceneId = typeof record.id === 'string' && record.id.trim() ? record.id : undefined;
    if (!sceneId) add('scene_id_missing', 'critical', `${path}.id`, true);
    else if (sceneIds.has(sceneId))
      add('scene_id_duplicate', 'critical', `${path}.id`, true, sceneId);
    else sceneIds.add(sceneId);
    if (record.stageId !== stage.id)
      add('scene_stage_link_invalid', 'warning', `${path}.stageId`, true, sceneId);
    if (typeof record.title !== 'string' || !record.title.trim())
      add('scene_title_missing', 'warning', `${path}.title`, true, sceneId);
    if (!Number.isFinite(record.order) || orders.has(record.order as number)) {
      add('scene_order_invalid', 'warning', `${path}.order`, true, sceneId);
    } else orders.add(record.order as number);

    const content = record.content as unknown as Record<string, unknown> | undefined;
    if (!content || typeof content !== 'object') {
      add('scene_content_missing', 'critical', `${path}.content`, false, sceneId);
      return;
    }
    if (!SCENE_TYPES.has(String(content.type)) || record.type !== content.type) {
      add(
        'scene_type_mismatch',
        'critical',
        `${path}.type`,
        SCENE_TYPES.has(String(content.type)),
        sceneId,
      );
    }
    if (MOJIBAKE_PATTERN.test(JSON.stringify(content))) {
      add('content_mojibake_detected', 'critical', `${path}.content`, false, sceneId);
    }

    if (content.type === 'slide') {
      const canvas = content.canvas as Record<string, unknown> | undefined;
      if (!canvas || !Array.isArray(canvas.elements)) {
        add('slide_canvas_invalid', 'critical', `${path}.content.canvas`, false, sceneId);
        return;
      }
      const elements = canvas.elements;
      const viewportSize = canvas.viewportSize;
      const viewportRatio = canvas.viewportRatio;
      const hasValidViewport =
        Number.isFinite(viewportSize) &&
        (viewportSize as number) > 0 &&
        Number.isFinite(viewportRatio) &&
        (viewportRatio as number) > 0;
      if (!hasValidViewport) {
        add('slide_viewport_invalid', 'critical', `${path}.content.canvas`, false, sceneId);
      }
      const canvasWidth = hasValidViewport ? (viewportSize as number) : 0;
      const canvasHeight = hasValidViewport
        ? (viewportSize as number) * (viewportRatio as number)
        : 0;
      const elementIds = new Set<string>();
      elements.forEach((element, elementIndex) => {
        const elementPath = `${path}.content.canvas.elements[${elementIndex}]`;
        if (!element || typeof element !== 'object') {
          add('slide_element_invalid', 'critical', elementPath, false, sceneId);
          return;
        }
        const elementRecord = element as Record<string, unknown>;
        const elementId = typeof elementRecord.id === 'string' ? elementRecord.id.trim() : '';
        if (!elementId || elementIds.has(elementId))
          add('slide_element_id_invalid', 'warning', `${elementPath}.id`, true, sceneId);
        else elementIds.add(elementId);
        const geometryFields =
          elementRecord.type === 'line'
            ? (['left', 'top', 'width'] as const)
            : (['left', 'top', 'width', 'height'] as const);
        for (const field of geometryFields) {
          if (!Number.isFinite(elementRecord[field]))
            add(
              'slide_element_geometry_invalid',
              'critical',
              `${elementPath}.${field}`,
              false,
              sceneId,
            );
        }
        const geometry = readElementGeometry(elementRecord);
        if (!geometry) return;
        if (elementRecord.type !== 'line' && (geometry.width <= 0 || geometry.height <= 0)) {
          add('slide_element_size_invalid', 'critical', elementPath, false, sceneId);
          return;
        }
        if (
          hasValidViewport &&
          (geometry.left < 0 ||
            geometry.top < 0 ||
            geometry.left + geometry.width > canvasWidth ||
            geometry.top + geometry.height > canvasHeight)
        ) {
          add('slide_element_out_of_bounds', 'warning', elementPath, false, sceneId);
        }
      });

      elements.forEach((leftElement, leftIndex) => {
        if (!leftElement || typeof leftElement !== 'object') return;
        const leftRecord = leftElement as Record<string, unknown>;
        if (!OVERLAP_SENSITIVE_ELEMENT_TYPES.has(String(leftRecord.type))) return;
        const leftGeometry = readElementGeometry(leftRecord);
        if (!leftGeometry) return;
        elements.slice(leftIndex + 1).forEach((rightElement, offset) => {
          if (!rightElement || typeof rightElement !== 'object') return;
          const rightRecord = rightElement as Record<string, unknown>;
          if (!OVERLAP_SENSITIVE_ELEMENT_TYPES.has(String(rightRecord.type))) return;
          if (
            typeof leftRecord.groupId === 'string' &&
            leftRecord.groupId &&
            leftRecord.groupId === rightRecord.groupId
          )
            return;
          const rightGeometry = readElementGeometry(rightRecord);
          if (!rightGeometry) return;
          if (overlapRatio(leftGeometry, rightGeometry) < SIGNIFICANT_OVERLAP_RATIO) return;
          const rightIndex = leftIndex + offset + 1;
          add(
            'slide_content_overlap',
            'warning',
            `${path}.content.canvas.elements[${leftIndex}]<->${path}.content.canvas.elements[${rightIndex}]`,
            false,
            sceneId,
          );
        });
      });
    } else if (content.type === 'quiz') {
      if (!Array.isArray(content.questions) || content.questions.length === 0) {
        add('quiz_questions_missing', 'critical', `${path}.content.questions`, false, sceneId);
        return;
      }
      const questionIds = new Set<string>();
      content.questions.forEach((question, questionIndex) => {
        const questionPath = `${path}.content.questions[${questionIndex}]`;
        if (!question || typeof question !== 'object') {
          add('quiz_question_invalid', 'critical', questionPath, false, sceneId);
          return;
        }
        const questionRecord = question as Record<string, unknown>;
        const questionId = typeof questionRecord.id === 'string' ? questionRecord.id.trim() : '';
        if (!questionId || questionIds.has(questionId))
          add('quiz_question_id_invalid', 'warning', `${questionPath}.id`, true, sceneId);
        else questionIds.add(questionId);
        if (typeof questionRecord.question !== 'string' || !questionRecord.question.trim()) {
          add('quiz_question_text_missing', 'critical', `${questionPath}.question`, false, sceneId);
        }
        if (questionRecord.type === 'single' || questionRecord.type === 'multiple') {
          const options = Array.isArray(questionRecord.options) ? questionRecord.options : [];
          if (options.length < 2)
            add('quiz_options_invalid', 'critical', `${questionPath}.options`, false, sceneId);
          const optionValues = new Set(
            options
              .filter(
                (option): option is Record<string, unknown> =>
                  Boolean(option) && typeof option === 'object',
              )
              .map((option) => String(option.value ?? '')),
          );
          const answers = Array.isArray(questionRecord.answer) ? questionRecord.answer : [];
          if (answers.some((answer) => !optionValues.has(String(answer)))) {
            add('quiz_answer_not_in_options', 'critical', `${questionPath}.answer`, false, sceneId);
          }
        }
      });
    } else if (content.type === 'interactive') {
      const html = typeof content.html === 'string' ? content.html.trim() : '';
      const url = typeof content.url === 'string' ? content.url.trim() : '';
      if (!html && !url)
        add('interactive_source_missing', 'critical', `${path}.content`, false, sceneId);
      if (html && !/^<!doctype\s+html/i.test(html))
        add('interactive_doctype_missing', 'info', `${path}.content.html`, true, sceneId);
      if (/javascript\s*:/i.test(html))
        add('interactive_unsafe_url', 'critical', `${path}.content.html`, false, sceneId);
    } else if (content.type === 'pbl' && !content.projectConfig && !content.projectV2) {
      add('pbl_project_missing', 'critical', `${path}.content`, false, sceneId);
    }
  });

  return issues;
}

function countIssues(issues: CoursewareIssue[]): Record<CoursewareIssueSeverity, number> {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { critical: 0, warning: 0, info: 0 },
  );
}

export function guardCourseware(
  input: CoursewareBundle,
  options: { mode?: CoursewareGuardMode } = {},
): CoursewareGuardResult {
  const mode = options.mode ?? 'inspect';
  const beforeFingerprint = fingerprint(input);
  const bundle = cloneBundle(input);
  const repairs = mode === 'safe-fix' ? applySafeFixes(bundle) : [];
  const issues = inspectBundle(bundle);
  const counts = countIssues(issues);
  const afterFingerprint = fingerprint(bundle);
  return {
    bundle,
    report: {
      schemaVersion: 'openmaic-courseware-guard-v1',
      mode,
      beforeFingerprint,
      afterFingerprint,
      changed: beforeFingerprint !== afterFingerprint,
      publishable: counts.critical === 0,
      counts,
      issues,
      repairs,
    },
  };
}

export interface GeneratedSceneGuardResult extends CoursewareGuardResult {
  scene: Scene;
}

/**
 * Guard a generated scene at the insertion boundary shared by client and
 * server generation. Existing scenes stay first, so duplicate-ID repair only
 * changes the newly generated scene.
 */
export function guardGeneratedScene(
  stage: Stage,
  existingScenes: Scene[],
  generatedScene: Scene,
): GeneratedSceneGuardResult {
  const result = guardCourseware(
    { stage, scenes: [...existingScenes, generatedScene] },
    { mode: 'safe-fix' },
  );
  const scene = result.bundle.scenes.at(-1);
  if (!scene) throw new Error('Generated scene guard returned no scene');
  return { ...result, scene };
}
