import type { EditPlan, DiffSummary } from '@/lib/types/modification';
import type { QuizContent, QuizQuestion, Scene, SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';

function toComparable(value: unknown): string {
  return JSON.stringify(value);
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeElement(element: PPTElement): string {
  const name = element.name ? `${element.name} ` : '';
  if (element.type === 'text') {
    const text = stripHtml(element.content).slice(0, 40);
    return `${name}text:${element.id}${text ? ` (${text})` : ''}`;
  }
  return `${name}${element.type}:${element.id}`;
}

function summarizeQuestion(question: QuizQuestion): string {
  return `question:${question.id} (${question.question.slice(0, 50)})`;
}

function diffById<T extends { id: string }>(before: T[], after: T[]) {
  const beforeMap = new Map(before.map((item) => [item.id, item]));
  const afterMap = new Map(after.map((item) => [item.id, item]));

  const added = after.filter((item) => !beforeMap.has(item.id));
  const deleted = before.filter((item) => !afterMap.has(item.id));
  const updated = after.filter((item) => {
    const previous = beforeMap.get(item.id);
    return previous ? toComparable(previous) !== toComparable(item) : false;
  });
  const unchanged = after.filter((item) => {
    const previous = beforeMap.get(item.id);
    return previous ? toComparable(previous) === toComparable(item) : false;
  });

  return { added, deleted, updated, unchanged };
}

export function createDiffSummary(
  before: Scene,
  after: Scene,
  plan: EditPlan,
  riskWarnings: string[] = [],
): DiffSummary {
  if (before.type === 'slide' && after.type === 'slide') {
    const beforeContent = before.content as SlideContent;
    const afterContent = after.content as SlideContent;
    const diff = diffById(beforeContent.canvas.elements, afterContent.canvas.elements);

    const changedItems = [
      ...diff.added.map((item) => `新增 ${summarizeElement(item)}`),
      ...diff.updated.map((item) => `修改 ${summarizeElement(item)}`),
      ...diff.deleted.map((item) => `删除 ${summarizeElement(item)}`),
    ];

    return {
      summary: plan.summary,
      changedItems,
      changedItemIds: [...diff.added, ...diff.updated, ...diff.deleted].map((item) => item.id),
      addedCount: diff.added.length,
      updatedCount: diff.updated.length,
      deletedCount: diff.deleted.length,
      unchangedHint: `其余 ${diff.unchanged.length} 个元素未改动`,
      riskWarnings,
    };
  }

  if (before.type === 'quiz' && after.type === 'quiz') {
    const beforeContent = before.content as QuizContent;
    const afterContent = after.content as QuizContent;
    const diff = diffById(beforeContent.questions, afterContent.questions);

    const changedItems = [
      ...diff.added.map((item) => `新增 ${summarizeQuestion(item)}`),
      ...diff.updated.map((item) => `修改 ${summarizeQuestion(item)}`),
      ...diff.deleted.map((item) => `删除 ${summarizeQuestion(item)}`),
    ];

    return {
      summary: plan.summary,
      changedItems,
      changedItemIds: [...diff.added, ...diff.updated, ...diff.deleted].map((item) => item.id),
      addedCount: diff.added.length,
      updatedCount: diff.updated.length,
      deletedCount: diff.deleted.length,
      unchangedHint: `其余 ${diff.unchanged.length} 道题未改动`,
      riskWarnings,
    };
  }

  return {
    summary: plan.summary,
    changedItems: [`场景类型 ${after.type} 的详细 diff 尚未启用`],
    changedItemIds: [],
    addedCount: 0,
    updatedCount: before.content === after.content ? 0 : 1,
    deletedCount: 0,
    riskWarnings,
  };
}
