import type { VisualAuditIssue } from '@/lib/courseware-guard/visual-audit';
import type { Scene } from '@/lib/types/stage';

type Box = {
  id: string;
  type: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

const CONTENT_SENSITIVE_TYPES = new Set(['text', 'table', 'chart', 'latex', 'code']);
const ELEMENT_GAP = 8;

function asBox(element: unknown): Box | null {
  if (!element || typeof element !== 'object') return null;
  const record = element as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.type !== 'string' ||
    !Number.isFinite(record.left) ||
    !Number.isFinite(record.top) ||
    !Number.isFinite(record.width) ||
    !Number.isFinite(record.height)
  ) {
    return null;
  }
  return {
    id: record.id,
    type: record.type,
    left: record.left as number,
    top: record.top as number,
    width: record.width as number,
    height: record.height as number,
  };
}

function overlapRatio(left: Box, right: Box): number {
  const overlapWidth = Math.max(
    0,
    Math.min(left.left + left.width, right.left + right.width) - Math.max(left.left, right.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top),
  );
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? (overlapWidth * overlapHeight) / smallerArea : 0;
}

function isInsideCanvas(box: Box, canvasWidth: number, canvasHeight: number): boolean {
  return (
    box.left >= 0 &&
    box.top >= 0 &&
    box.left + box.width <= canvasWidth &&
    box.top + box.height <= canvasHeight
  );
}

function separateElements(
  elements: unknown[],
  elementIds: string[],
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  if (elementIds.length < 2) return false;
  const records = elements as Array<Record<string, unknown>>;
  const firstRecord = records.find((element) => element.id === elementIds[0]);
  const secondRecord = records.find((element) => element.id === elementIds[1]);
  const first = asBox(firstRecord);
  const second = asBox(secondRecord);
  if (!firstRecord || !secondRecord || !first || !second) return false;

  const [movingRecord, moving, fixed] =
    first.width * first.height <= second.width * second.height
      ? [firstRecord, first, second]
      : [secondRecord, second, first];
  const candidates: Box[] = [
    { ...moving, left: fixed.left - moving.width - ELEMENT_GAP },
    { ...moving, left: fixed.left + fixed.width + ELEMENT_GAP },
    { ...moving, top: fixed.top - moving.height - ELEMENT_GAP },
    { ...moving, top: fixed.top + fixed.height + ELEMENT_GAP },
  ];
  for (let deltaX = -200; deltaX <= 200; deltaX += 8) {
    for (let deltaY = -200; deltaY <= 200; deltaY += 8) {
      if (deltaX === 0 && deltaY === 0) continue;
      candidates.push({ ...moving, left: moving.left + deltaX, top: moving.top + deltaY });
    }
  }
  const validCandidates = candidates.filter((candidate) =>
    isInsideCanvas(candidate, canvasWidth, canvasHeight),
  );
  if (validCandidates.length === 0) return false;

  const otherBoxes = records
    .map(asBox)
    .filter(
      (box): box is Box => !!box && box.id !== moving.id && CONTENT_SENSITIVE_TYPES.has(box.type),
    );
  const score = (candidate: Box) => {
    const collisionPenalty = otherBoxes.reduce(
      (total, other) => total + overlapRatio(candidate, other) * 100_000,
      0,
    );
    return collisionPenalty + Math.hypot(candidate.left - moving.left, candidate.top - moving.top);
  };
  const best = validCandidates.sort((left, right) => score(left) - score(right))[0];
  if (overlapRatio(best, fixed) > 0) return false;

  movingRecord.left = best.left;
  movingRecord.top = best.top;
  return true;
}

function expandOverflowingText(
  elements: unknown[],
  elementIds: string[],
  canvasHeight: number,
): boolean {
  let changed = false;
  const records = elements as Array<Record<string, unknown>>;
  for (const id of elementIds) {
    const element = records.find((candidate) => candidate.id === id);
    const box = asBox(element);
    if (!element || !box || box.type !== 'text') continue;
    const maxHeight = canvasHeight - box.top;
    const expandedHeight = Math.min(maxHeight, Math.ceil(box.height * 1.35));
    if (expandedHeight >= box.height + 2) {
      element.height = expandedHeight;
      changed = true;
    }
  }
  return changed;
}

function clampElementsToCanvas(
  elements: unknown[],
  elementIds: string[],
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  let changed = false;
  const records = elements as Array<Record<string, unknown>>;
  for (const id of elementIds) {
    const element = records.find((candidate) => candidate.id === id);
    const box = asBox(element);
    if (!element || !box || box.width > canvasWidth || box.height > canvasHeight) continue;
    const left = Math.min(Math.max(0, box.left), canvasWidth - box.width);
    const top = Math.min(Math.max(0, box.top), canvasHeight - box.height);
    if (left !== box.left || top !== box.top) {
      element.left = left;
      element.top = top;
      changed = true;
    }
  }
  return changed;
}

export function applyDeterministicVisualRepairs(
  scene: Scene,
  issues: VisualAuditIssue[],
): { scene: Scene; handledIssueIds: string[] } {
  if (scene.content.type !== 'slide' || issues.length === 0) {
    return { scene, handledIssueIds: [] };
  }

  const repaired = structuredClone(scene);
  if (repaired.content.type !== 'slide') return { scene, handledIssueIds: [] };
  const canvas = repaired.content.canvas;
  const canvasWidth = canvas.viewportSize;
  const canvasHeight = canvas.viewportSize * canvas.viewportRatio;
  const handledIssueIds: string[] = [];

  for (const issue of issues) {
    const elementIds = issue.elementIds ?? [];
    let handled = false;
    if (issue.code === 'content_overlap') {
      handled = separateElements(canvas.elements, elementIds, canvasWidth, canvasHeight);
    } else if (issue.code === 'text_overflow') {
      handled = expandOverflowingText(canvas.elements, elementIds, canvasHeight);
    } else if (issue.code === 'element_out_of_bounds') {
      handled = clampElementsToCanvas(canvas.elements, elementIds, canvasWidth, canvasHeight);
    }
    if (handled) handledIssueIds.push(issue.id);
  }

  return handledIssueIds.length > 0
    ? { scene: repaired, handledIssueIds }
    : { scene, handledIssueIds };
}
