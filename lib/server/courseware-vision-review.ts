import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
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
        message: z.string().trim().min(1).max(2000),
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
  cacheNamespace?: string;
  cacheDir?: string;
  enableCache?: boolean;
  callVisionModel: (
    systemPrompt: string,
    userContent: CoursewareVisionUserContent,
  ) => Promise<string>;
}

const VISION_REVIEW_PROMPT_VERSION = 'courseware-vision-review-v2';

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
  const summary = elementSummary(options.scene);
  const cacheKey = createHash('sha256')
    .update(VISION_REVIEW_PROMPT_VERSION)
    .update('\0')
    .update(options.cacheNamespace ?? 'default')
    .update('\0')
    .update(summary)
    .update('\0')
    .update(screenshot)
    .digest('hex');
  const cacheRoot =
    options.cacheDir ?? path.join(process.cwd(), 'data', 'courseware-audits', 'vision-cache');
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  const cacheEnabled = options.enableCache === true && !!options.cacheNamespace;
  if (cacheEnabled) {
    try {
      const cached = visionReviewSchema.safeParse(
        JSON.parse(await fs.readFile(cachePath, 'utf8')) as unknown,
      );
      if (cached.success) return cached.data.issues;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Ignore an unreadable cache entry and refresh it from the model.
      }
    }
  }
  const systemPrompt = `You are a strict visual QA reviewer for educational slides. Inspect the rendered screenshot as a real learner would. Report only defects visible in the screenshot or strongly supported by the supplied element metadata. Do not invent hidden problems and do not flag intentional decorative overlap.

Critical means the learner cannot reliably read, understand, or use important content. Warning means visibly poor quality that remains usable. Check especially: clipped or hidden content, overlapping text/content, tiny or unreadable text, low contrast, broken formulas/charts/images, duplicated or empty content, confusing hierarchy, and obvious semantic presentation errors. Semantic-confusion findings are always warnings for human confirmation; never mark them critical.

For semantic_confusion, require an objective learner-relevant contradiction, such as a plotted point disagreeing with its coordinate label, a formula disagreeing with its worked result, or two visible definitions making incompatible claims. State the exact contradiction and the expected correction. Do not report standard Chinese punctuation such as "、，。；：" or merely awkward wording, broad title phrasing, stylistic preferences, or speculative concerns as semantic defects. If the concern is only that something "may be confusing", "looks awkward", or "should be human-checked" without a concrete contradiction, return no issue. If your own reasoning resolves an apparent contradiction, omit the finding entirely. Verify diagram labels against visible positions only when the origin and scale are clear enough to support the claim. Directly labeled, color-matched point/label pairs do not need a separate legend unless the same color encodes an additional unexplained meaning.

Return only JSON in this exact shape:
{"issues":[{"severity":"critical|warning","category":"overlap|clipping|overflow|contrast|legibility|broken_math|broken_media|duplicate_content|visual_hierarchy|semantic_confusion|empty_content|other","message":"specific visible defect and where it occurs","elementIds":["id-if-certain"]}]}

Every message must distinguish the affected content and location from other findings. Return {"issues":[]} when no visible defect exists.`;
  const userPrompt = `Review this rendered slide.

Scene ID: ${options.scene.id}
Title: ${options.scene.title}
Canvas element metadata: ${summary}`;
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
  const findings = validated.data.issues.map((issue) => {
    const normalized = { ...issue, message: issue.message.slice(0, 600) };
    return normalized.category === 'semantic_confusion' && normalized.severity === 'critical'
      ? { ...normalized, severity: 'warning' as const }
      : normalized;
  });
  if (cacheEnabled) {
    await fs.mkdir(cacheRoot, { recursive: true });
    const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ issues: findings }, null, 2), 'utf8');
    await fs.rename(temporary, cachePath);
  }
  return findings;
}
