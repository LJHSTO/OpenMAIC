type JsonObject = Record<string, unknown>;

export interface SlideElementIdRepair {
  sceneOrder: number;
  elementIndex: number;
  type: string;
  before: string;
  after: string;
  strategy:
    | 'exact-content'
    | 'stable-index-and-type'
    | 'action-target-media'
    | 'action-target-text'
    | 'action-target-geometry'
    | 'action-target-fallback';
}

interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is JsonObject => item !== null)
    : [];
}

function sceneElements(scene: unknown): JsonObject[] {
  const sceneRecord = asRecord(scene);
  const content = asRecord(sceneRecord?.content);
  if (content?.type !== 'slide') return [];
  return records(asRecord(content.canvas)?.elements);
}

function sceneActions(scene: unknown): JsonObject[] {
  return records(asRecord(scene)?.actions);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function elementSignature(element: JsonObject): string {
  const comparable = { ...element };
  delete comparable.id;
  return JSON.stringify(stableValue(comparable));
}

function elementId(element: JsonObject): string {
  return typeof element.id === 'string' ? element.id : '';
}

function elementType(element: JsonObject): string {
  return typeof element.type === 'string' ? element.type : '';
}

function plainText(element: JsonObject): string {
  const shapeText = asRecord(element.text);
  const raw =
    elementType(element) === 'shape' && typeof shapeText?.content === 'string'
      ? shapeText.content
      : typeof element.content === 'string'
        ? element.content
        : '';
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|ensp|emsp);/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function mediaKey(element: JsonObject): string {
  const raw =
    typeof element.mediaRef === 'string'
      ? element.mediaRef
      : typeof element.src === 'string'
        ? element.src
        : '';
  if (!raw) return '';
  let pathname = raw;
  try {
    pathname = new URL(raw, 'http://openmaic.local').pathname;
  } catch {
    pathname = raw.split(/[?#]/, 1)[0];
  }
  const filename = decodeURIComponent(pathname.replace(/\\/g, '/').split('/').pop() ?? pathname);
  return filename.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
}

function geometry(element: JsonObject): Geometry | null {
  const values = [element.left, element.top, element.width, element.height];
  if (!values.every(Number.isFinite)) return null;
  return {
    left: element.left as number,
    top: element.top as number,
    width: element.width as number,
    height: element.height as number,
  };
}

function overlapRatio(left: Geometry, right: Geometry): number {
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

function geometryScore(left: Geometry | null, right: Geometry | null): number {
  if (!left || !right) return 0;
  const overlap = overlapRatio(left, right);
  const centerDistance = Math.hypot(
    left.left + left.width / 2 - (right.left + right.width / 2),
    left.top + left.height / 2 - (right.top + right.height / 2),
  );
  const proximity = 1 - Math.min(1, centerDistance / 800);
  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;
  const areaSimilarity =
    leftArea > 0 && rightArea > 0
      ? Math.min(leftArea, rightArea) / Math.max(leftArea, rightArea)
      : 0;
  return overlap * 240 + proximity * 80 + areaSimilarity * 80;
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

function textSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  const rightCounts = new Map<string, number>();
  for (const item of rightBigrams) rightCounts.set(item, (rightCounts.get(item) ?? 0) + 1);
  let intersection = 0;
  for (const item of leftBigrams) {
    const count = rightCounts.get(item) ?? 0;
    if (count <= 0) continue;
    intersection += 1;
    rightCounts.set(item, count - 1);
  }
  return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
}

function actionTargetIds(scene: unknown): string[] {
  return Array.from(
    new Set(
      sceneActions(scene)
        .map((action) => (typeof action.elementId === 'string' ? action.elementId : ''))
        .filter(Boolean),
    ),
  );
}

function actionTargetMatch(
  original: JsonObject,
  candidates: JsonObject[],
): { element: JsonObject; strategy: SlideElementIdRepair['strategy'] } | null {
  const originalMedia = mediaKey(original);
  if (originalMedia) {
    const mediaMatch = candidates.find((candidate) => mediaKey(candidate) === originalMedia);
    if (mediaMatch) return { element: mediaMatch, strategy: 'action-target-media' };
  }

  const originalText = plainText(original);
  if (originalText) {
    const scored = candidates
      .map((candidate) => {
        const similarity = textSimilarity(originalText, plainText(candidate));
        return {
          element: candidate,
          similarity,
          score:
            similarity * 1000 +
            geometryScore(geometry(original), geometry(candidate)) +
            (elementType(candidate) === elementType(original) ? 120 : 0),
        };
      })
      .filter((candidate) => candidate.similarity >= 0.28)
      .sort((left, right) => right.score - left.score);
    if (scored[0]) return { element: scored[0].element, strategy: 'action-target-text' };
  }

  const originalGeometry = geometry(original);
  if (!originalGeometry) return null;
  const originalType = elementType(original);
  const scored = candidates
    .filter((candidate) => {
      const candidateType = elementType(candidate);
      if (candidateType === originalType) return true;
      return (originalType === 'image' || originalType === 'video') && candidateType === 'shape';
    })
    .map((candidate) => ({
      element: candidate,
      score: geometryScore(originalGeometry, geometry(candidate)),
    }))
    .filter((candidate) => candidate.score >= 180)
    .sort((left, right) => right.score - left.score);
  return scored[0] ? { element: scored[0].element, strategy: 'action-target-geometry' } : null;
}

function actionTargetFallback(original: JsonObject, candidates: JsonObject[]): JsonObject | null {
  const originalType = elementType(original);
  const scored = candidates
    .map((candidate, index) => {
      const candidateType = elementType(candidate);
      const typeRank =
        candidateType === originalType
          ? 2
          : (originalType === 'image' || originalType === 'video') && candidateType === 'shape'
            ? 1
            : 0;
      return {
        element: candidate,
        index,
        typeRank,
        geometry: geometryScore(geometry(original), geometry(candidate)),
      };
    })
    .filter((candidate) => candidate.typeRank > 0)
    .sort(
      (left, right) =>
        right.typeRank - left.typeRank ||
        right.geometry - left.geometry ||
        left.index - right.index,
    );
  return scored[0]?.element ?? null;
}

function assignOriginalId(
  input: {
    finalElement: JsonObject;
    originalId: string;
    sceneOrder: number;
    elementIndex: number;
    strategy: SlideElementIdRepair['strategy'];
  },
  usedOriginalIds: Set<string>,
  repairs: SlideElementIdRepair[],
): void {
  const before = elementId(input.finalElement);
  if (!input.originalId || input.originalId === before) {
    if (input.originalId) usedOriginalIds.add(input.originalId);
    return;
  }
  usedOriginalIds.delete(before);
  input.finalElement.id = input.originalId;
  usedOriginalIds.add(input.originalId);
  repairs.push({
    sceneOrder: input.sceneOrder,
    elementIndex: input.elementIndex,
    type: elementType(input.finalElement),
    before,
    after: input.originalId,
    strategy: input.strategy,
  });
}

export function restoreStableSlideElementIdsInScene(
  originalScene: unknown,
  finalScene: unknown,
): SlideElementIdRepair[] {
  const originalElements = sceneElements(originalScene);
  const finalElements = sceneElements(finalScene);
  if (originalElements.length === 0 || finalElements.length === 0) return [];

  const repairs: SlideElementIdRepair[] = [];
  const sceneOrder = Number(asRecord(finalScene)?.order ?? 0);
  const originalIds = new Set(originalElements.map(elementId).filter(Boolean));
  const usedOriginalIds = new Set<string>();
  for (const finalElement of finalElements) {
    const finalId = elementId(finalElement);
    if (originalIds.has(finalId)) usedOriginalIds.add(finalId);
  }

  const signatureQueues = new Map<string, JsonObject[]>();
  for (const originalElement of originalElements) {
    const originalId = elementId(originalElement);
    if (!originalId || usedOriginalIds.has(originalId)) continue;
    const signature = elementSignature(originalElement);
    const queue = signatureQueues.get(signature) ?? [];
    queue.push(originalElement);
    signatureQueues.set(signature, queue);
  }
  for (const [index, finalElement] of finalElements.entries()) {
    const finalId = elementId(finalElement);
    if (usedOriginalIds.has(finalId)) continue;
    const queue = signatureQueues.get(elementSignature(finalElement)) ?? [];
    const matched = queue.find((element) => !usedOriginalIds.has(elementId(element)));
    if (!matched) continue;
    assignOriginalId(
      {
        finalElement,
        originalId: elementId(matched),
        sceneOrder,
        elementIndex: index,
        strategy: 'exact-content',
      },
      usedOriginalIds,
      repairs,
    );
  }

  const originalById = new Map(originalElements.map((element) => [elementId(element), element]));
  const targetIds = actionTargetIds(originalScene);
  const protectedActionTargetIds = new Set(targetIds);
  for (const targetId of targetIds) {
    if (usedOriginalIds.has(targetId)) continue;
    const originalTarget = originalById.get(targetId);
    if (!originalTarget) continue;
    const candidates = finalElements.filter(
      (element) => !protectedActionTargetIds.has(elementId(element)),
    );
    const matched =
      actionTargetMatch(originalTarget, candidates) ??
      (() => {
        const fallback = actionTargetFallback(originalTarget, candidates);
        return fallback
          ? {
              element: fallback,
              strategy: 'action-target-fallback' as const,
            }
          : null;
      })();
    if (!matched) continue;
    assignOriginalId(
      {
        finalElement: matched.element,
        originalId: targetId,
        sceneOrder,
        elementIndex: finalElements.indexOf(matched.element),
        strategy: matched.strategy,
      },
      usedOriginalIds,
      repairs,
    );
  }

  if (originalElements.length === finalElements.length) {
    for (const [index, finalElement] of finalElements.entries()) {
      const originalElement = originalElements[index];
      const originalId = elementId(originalElement);
      const finalId = elementId(finalElement);
      if (
        !originalId ||
        originalId === finalId ||
        usedOriginalIds.has(originalId) ||
        elementType(originalElement) !== elementType(finalElement) ||
        originalIds.has(finalId)
      ) {
        continue;
      }
      assignOriginalId(
        {
          finalElement,
          originalId,
          sceneOrder,
          elementIndex: index,
          strategy: 'stable-index-and-type',
        },
        usedOriginalIds,
        repairs,
      );
    }
  }

  return repairs;
}

export function restoreStableSlideElementIds(
  originalManifest: unknown,
  finalManifest: unknown,
): SlideElementIdRepair[] {
  const originalScenes = records(asRecord(originalManifest)?.scenes);
  const finalScenes = records(asRecord(finalManifest)?.scenes);
  const originalByOrder = new Map(
    originalScenes.map((scene) => [Number(scene.order ?? 0), scene] as const),
  );
  return finalScenes.flatMap((finalScene) => {
    const originalScene = originalByOrder.get(Number(finalScene.order ?? 0));
    return originalScene ? restoreStableSlideElementIdsInScene(originalScene, finalScene) : [];
  });
}
