import { promises as fs } from 'fs';
import { z } from 'zod';
import { buildVisionUserContent } from '@/lib/generation/prompt-formatters';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import type { Scene } from '@/lib/types/stage';

const visionReviewSchema = z.object({
  issues: z
    .array(
      z.object({
        severity: z.enum(['critical', 'warning']),
        category: z.enum([
          'overlap',
          'clipping',
          'overflow',
          'contrast',
          'legibility',
          'broken_math',
          'broken_media',
          'duplicate_content',
          'visual_hierarchy',
          'semantic_confusion',
          'empty_content',
          'other',
        ]),
        message: z.string().trim().min(1).max(600),
        elementIds: z.array(z.string().trim().min(1)).max(8).optional(),
      }),
    )
    .max(20),
});

export type CoursewareVisionFinding = z.infer<typeof visionReviewSchema>['issues'][number];
export type CoursewareVisionUserContent = ReturnType<typeof buildVisionUserContent>;

export interface ReviewCoursewareScreenshotOptions {
  scene: Scene;
  screenshotPath: string;
  callVisionModel: (
    systemPrompt: string,
    userContent: CoursewareVisionUserContent,
  ) => Promise<string>;
}

function elementSummary(scene: Scene): string {
  if (scene.content.type !== 'slide') return '[]';
  return JSON.stringify(
    scene.content.canvas.elements.map((element) => {
      const record = element as unknown as Record<string, unknown>;
      const rawText = record.content ?? record.text ?? record.latex ?? record.code;
      const text =
        typeof rawText === 'string' ? rawText.replace(/<[^>]+>/g, ' ').slice(0, 180) : '';
      return {
        id: element.id,
        type: element.type,
        left: record.left,
        top: record.top,
        width: record.width,
        height: record.height,
        ...(text ? { text } : {}),
      };
    }),
  );
}

export async function reviewCoursewareScreenshot(
  options: ReviewCoursewareScreenshotOptions,
): Promise<CoursewareVisionFinding[]> {
  if (options.scene.content.type !== 'slide') return [];
  const screenshot = await fs.readFile(options.screenshotPath);
  const systemPrompt = `You are a strict visual QA reviewer for educational slides. Inspect the rendered screenshot as a real learner would. Report only defects visible in the screenshot or strongly supported by the supplied element metadata. Do not invent hidden problems and do not flag intentional decorative overlap.

Critical means the learner cannot reliably read, understand, or use important content. Warning means visibly poor quality that remains usable. Check especially: clipped or hidden content, overlapping text/content, tiny or unreadable text, low contrast, broken formulas/charts/images, duplicated or empty content, confusing hierarchy, and obvious semantic presentation errors. Semantic-confusion findings are always warnings for human confirmation; never mark them critical.

Return only JSON in this exact shape:
{"issues":[{"severity":"critical|warning","category":"overlap|clipping|overflow|contrast|legibility|broken_math|broken_media|duplicate_content|visual_hierarchy|semantic_confusion|empty_content|other","message":"specific visible defect and where it occurs","elementIds":["id-if-certain"]}]}

Every message must distinguish the affected content and location from other findings. Return {"issues":[]} when no visible defect exists.`;
  const userPrompt = `Review this rendered slide.

Scene ID: ${options.scene.id}
Title: ${options.scene.title}
Canvas element metadata: ${elementSummary(options.scene)}`;
  const raw = await options.callVisionModel(
    systemPrompt,
    buildVisionUserContent(userPrompt, [
      {
        id: `rendered-slide-${options.scene.id}`,
        src: `data:image/png;base64,${screenshot.toString('base64')}`,
        width: 1600,
        height: 900,
      },
    ]),
  );
  const parsed = parseJsonResponse<unknown>(raw);
  const validated = visionReviewSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Vision model returned an invalid audit response: ${validated.error.message}`);
  }
  return validated.data.issues.map((issue) =>
    issue.category === 'semantic_confusion' && issue.severity === 'critical'
      ? { ...issue, severity: 'warning' as const }
      : issue,
  );
}
