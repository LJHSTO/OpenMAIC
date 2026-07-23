import { createHash } from 'crypto';
import sanitizeHtml from 'sanitize-html';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';

export type KnowledgeAuditSeverity = 'critical' | 'warning';

export interface KnowledgeAuditIssue {
  id: string;
  code:
    | 'outline_scene_missing'
    | 'outline_scene_duplicate'
    | 'outline_type_mismatch'
    | 'key_point_not_evidenced';
  severity: KnowledgeAuditSeverity;
  message: string;
  outlineId: string;
  sceneId?: string;
  keyPoint?: string;
}

export interface KnowledgeAuditMapping {
  outlineId: string;
  outlineTitle: string;
  expectedType: SceneOutline['type'];
  sceneId?: string;
  sceneTitle?: string;
  evidencedKeyPoints: string[];
  missingKeyPoints: string[];
}

export interface CoursewareKnowledgeAuditReport {
  schemaVersion: 'openmaic-courseware-knowledge-audit-v1';
  generatedAt: string;
  classroomId: string;
  contractAvailable: boolean;
  contractSha256?: string;
  expectedOutlines: number;
  matchedOutlines: number;
  publishable: boolean;
  counts: Record<KnowledgeAuditSeverity, number>;
  mappings: KnowledgeAuditMapping[];
  issues: KnowledgeAuditIssue[];
}

function collectStrings(value: unknown, output: string[], key = ''): void {
  if (typeof value === 'string') {
    if (/^(?:data|blob):/i.test(value) || key === 'src' || key === 'poster' || key === 'url') {
      return;
    }
    const text =
      key === 'content' || key === 'html'
        ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
        : value;
    if (text.trim()) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child) => collectStrings(child, output, key));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    collectStrings(child, output, childKey);
  }
}

function searchableSceneText(scene: Scene): string {
  const strings: string[] = [scene.title];
  collectStrings(scene.content, strings);
  return strings.join(' ');
}

function normalizeKnowledgeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function ngrams(value: string, size: number): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= value.length - size; index += 1) {
    result.add(value.slice(index, index + size));
  }
  return result;
}

function hasKeyPointEvidence(keyPoint: string, sceneText: string): boolean {
  const expected = normalizeKnowledgeText(keyPoint);
  const actual = normalizeKnowledgeText(sceneText);
  if (!expected) return true;
  if (actual.includes(expected)) return true;
  if (expected.length < 5) return false;
  const expectedGrams = ngrams(expected, 2);
  const actualGrams = ngrams(actual, 2);
  let matched = 0;
  for (const gram of expectedGrams) {
    if (actualGrams.has(gram)) matched += 1;
  }
  return matched / Math.max(1, expectedGrams.size) >= 0.6;
}

function contractHash(outlines: SceneOutline[]): string {
  const stable = outlines.map((outline) => ({
    id: outline.id,
    type: outline.type,
    title: outline.title,
    keyPoints: outline.keyPoints,
    teachingObjective: outline.teachingObjective,
    order: outline.order,
  }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function auditCoursewareKnowledgeContract(
  stage: Stage,
  scenes: Scene[],
  outlines?: SceneOutline[],
): CoursewareKnowledgeAuditReport {
  if (!outlines?.length) {
    return {
      schemaVersion: 'openmaic-courseware-knowledge-audit-v1',
      generatedAt: new Date().toISOString(),
      classroomId: stage.id,
      contractAvailable: false,
      expectedOutlines: 0,
      matchedOutlines: 0,
      publishable: true,
      counts: { critical: 0, warning: 0 },
      mappings: [],
      issues: [],
    };
  }

  const issues: KnowledgeAuditIssue[] = [];
  const mappings: KnowledgeAuditMapping[] = [];
  let issueIndex = 0;
  const addIssue = (issue: Omit<KnowledgeAuditIssue, 'id'>) => {
    issueIndex += 1;
    issues.push({ id: `knowledge-${String(issueIndex).padStart(4, '0')}`, ...issue });
  };

  for (const outline of outlines) {
    const identityMatches = scenes.filter((scene) => scene.outlineId === outline.id);
    const fallbackMatches =
      identityMatches.length === 0
        ? scenes.filter(
            (scene) =>
              !scene.outlineId &&
              scene.order === outline.order &&
              scene.content.type === outline.type,
          )
        : [];
    const matches = identityMatches.length > 0 ? identityMatches : fallbackMatches;
    if (matches.length === 0) {
      addIssue({
        code: 'outline_scene_missing',
        severity: 'critical',
        outlineId: outline.id,
        message: `知识契约中的场景《${outline.title}》没有对应的已生成课件。`,
      });
      mappings.push({
        outlineId: outline.id,
        outlineTitle: outline.title,
        expectedType: outline.type,
        evidencedKeyPoints: [],
        missingKeyPoints: [...outline.keyPoints],
      });
      continue;
    }
    if (matches.length > 1) {
      addIssue({
        code: 'outline_scene_duplicate',
        severity: 'critical',
        outlineId: outline.id,
        sceneId: matches[0].id,
        message: `知识契约《${outline.title}》映射到了多个场景，无法确定唯一课件。`,
      });
    }

    const scene = matches[0];
    if (scene.content.type !== outline.type) {
      addIssue({
        code: 'outline_type_mismatch',
        severity: 'critical',
        outlineId: outline.id,
        sceneId: scene.id,
        message: `场景《${scene.title}》类型为 ${scene.content.type}，与知识契约要求的 ${outline.type} 不一致。`,
      });
    }
    const sceneText = searchableSceneText(scene);
    const evidencedKeyPoints: string[] = [];
    const missingKeyPoints: string[] = [];
    for (const keyPoint of outline.keyPoints) {
      if (hasKeyPointEvidence(keyPoint, sceneText)) {
        evidencedKeyPoints.push(keyPoint);
      } else {
        missingKeyPoints.push(keyPoint);
        addIssue({
          code: 'key_point_not_evidenced',
          severity: 'warning',
          outlineId: outline.id,
          sceneId: scene.id,
          keyPoint,
          message: `场景《${scene.title}》中没有找到知识点“${keyPoint}”的明确文本或公式证据。`,
        });
      }
    }
    mappings.push({
      outlineId: outline.id,
      outlineTitle: outline.title,
      expectedType: outline.type,
      sceneId: scene.id,
      sceneTitle: scene.title,
      evidencedKeyPoints,
      missingKeyPoints,
    });
  }

  const counts = issues.reduce(
    (result, issue) => {
      result[issue.severity] += 1;
      return result;
    },
    { critical: 0, warning: 0 },
  );
  return {
    schemaVersion: 'openmaic-courseware-knowledge-audit-v1',
    generatedAt: new Date().toISOString(),
    classroomId: stage.id,
    contractAvailable: true,
    contractSha256: contractHash(outlines),
    expectedOutlines: outlines.length,
    matchedOutlines: mappings.filter((mapping) => !!mapping.sceneId).length,
    publishable: counts.critical === 0,
    counts,
    mappings,
    issues,
  };
}
