import { promises as fs } from 'fs';
import path from 'path';
import { createHmac } from 'crypto';
import type { Scene } from '@/lib/types/stage';

export type VisualAuditSeverity = 'critical' | 'warning';

export interface VisualAuditIssue {
  id: string;
  code:
    | 'render_failed'
    | 'console_error'
    | 'resource_failed'
    | 'image_failed'
    | 'video_failed'
    | 'font_failed'
    | 'rendered_mojibake'
    | 'text_overflow'
    | 'element_out_of_bounds'
    | 'content_overlap'
    | 'vision_issue'
    | 'vision_review_failed';
  severity: VisualAuditSeverity;
  sceneId: string;
  elementIds?: string[];
  category?: string;
  message: string;
}

export interface VisualAuditSlideResult {
  sceneId: string;
  title: string;
  screenshot: string;
  issues: VisualAuditIssue[];
}

export interface CoursewareVisualAuditReport {
  schemaVersion: 'openmaic-courseware-visual-audit-v1';
  generatedAt: string;
  classroomId: string;
  viewport: { width: number; height: number };
  publishable: boolean;
  counts: Record<VisualAuditSeverity, number>;
  slides: VisualAuditSlideResult[];
  issues: VisualAuditIssue[];
}

export interface RunVisualAuditOptions {
  baseUrl: string;
  classroomId: string;
  scenes: Scene[];
  screenshotsDir: string;
  timeoutMs?: number;
  visionReviewConcurrency?: number;
  sceneIds?: Iterable<string>;
  reviewScreenshot?: (input: { scene: Scene; screenshotPath: string }) => Promise<
    Array<{
      severity: VisualAuditSeverity;
      category: string;
      message: string;
      elementIds?: string[];
    }>
  >;
}

const VIEWPORT = { width: 1600, height: 900 } as const;

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'scene';
}

export async function runCoursewareVisualAudit(
  options: RunVisualAuditOptions,
): Promise<CoursewareVisualAuditReport> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const selectedSceneIds = options.sceneIds ? new Set(options.sceneIds) : null;
  const allSlideScenes = options.scenes.filter(
    (scene): scene is Scene & { content: Extract<Scene['content'], { type: 'slide' }> } =>
      scene.content.type === 'slide',
  );
  const slideScenes = allSlideScenes
    .map((scene, screenshotIndex) => ({ scene, screenshotIndex }))
    .filter(({ scene }) => !selectedSceneIds || selectedSceneIds.has(scene.id));
  await fs.mkdir(options.screenshotsDir, { recursive: true });
  if (slideScenes.length === 0) {
    return {
      schemaVersion: 'openmaic-courseware-visual-audit-v1',
      generatedAt: new Date().toISOString(),
      classroomId: options.classroomId,
      viewport: VIEWPORT,
      publishable: true,
      counts: { critical: 0, warning: 0 },
      slides: [],
      issues: [],
    };
  }

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  if (process.env.ACCESS_CODE) {
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', process.env.ACCESS_CODE).update(timestamp).digest('hex');
    await context.addCookies([
      {
        name: 'openmaic_access',
        value: `${timestamp}.${signature}`,
        url: options.baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  const slides: VisualAuditSlideResult[] = [];
  const reviewTasks: Array<{
    scene: Scene;
    screenshotPath: string;
    addIssue: (
      code: VisualAuditIssue['code'],
      severity: VisualAuditSeverity,
      message: string,
      elementIds?: string[],
      category?: string,
    ) => void;
  }> = [];
  let nextIssueId = 1;

  try {
    for (const { scene, screenshotIndex } of slideScenes) {
      const page = await context.newPage();
      const runtimeErrors: Array<{ code: 'console_error' | 'resource_failed'; message: string }> =
        [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          runtimeErrors.push({ code: 'console_error', message: message.text() });
        }
      });
      page.on('requestfailed', (request) => {
        runtimeErrors.push({
          code: 'resource_failed',
          message: `${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`,
        });
      });

      const filename = `${String(screenshotIndex + 1).padStart(3, '0')}-${safeSegment(scene.id)}.png`;
      const screenshotPath = path.join(options.screenshotsDir, filename);
      const relativeScreenshot = `screenshots/${filename}`;
      const issues: VisualAuditIssue[] = [];
      const addIssue = (
        code: VisualAuditIssue['code'],
        severity: VisualAuditSeverity,
        message: string,
        elementIds?: string[],
        category?: string,
      ) => {
        issues.push({
          id: `visual-${String(nextIssueId).padStart(4, '0')}`,
          code,
          severity,
          sceneId: scene.id,
          ...(elementIds?.length ? { elementIds } : {}),
          ...(category ? { category } : {}),
          message,
        });
        nextIssueId += 1;
      };

      try {
        const auditUrl = new URL(`/courseware-audit/${options.classroomId}`, options.baseUrl);
        auditUrl.searchParams.set('sceneId', scene.id);
        await page.goto(auditUrl.toString(), { waitUntil: 'networkidle', timeout: timeoutMs });
        const surface = page.locator('[data-courseware-audit-slide]');
        await surface.waitFor({ state: 'visible', timeout: timeoutMs });
        await page
          .locator('[data-courseware-audit-ready="true"]')
          .waitFor({ state: 'attached', timeout: timeoutMs });
        await page.evaluate(async () => {
          await document.fonts.ready;
          const images = Array.from(document.images);
          await Promise.all(
            images.map((image) => {
              if (image.complete) return Promise.resolve();
              return new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
              });
            }),
          );
        });

        const measurements = await page.evaluate(() => {
          type Box = {
            id: string;
            type: string;
            groupId: string;
            left: number;
            top: number;
            right: number;
            bottom: number;
            width: number;
            height: number;
          };
          const viewport = document.querySelector<HTMLElement>('[data-slide-canvas-viewport]');
          if (!viewport) throw new Error('Rendered slide viewport not found');
          const viewportRect = viewport.getBoundingClientRect();
          const elements = Array.from(
            document.querySelectorAll<HTMLElement>('[data-slide-element-id]'),
          ).flatMap((root): Box[] => {
            const rendered = root.querySelector<HTMLElement>('.slide-element-hit-target > *');
            if (!rendered) return [];
            const rect = rendered.getBoundingClientRect();
            return [
              {
                id: root.dataset.slideElementId ?? '',
                type: root.dataset.slideElementType ?? '',
                groupId: root.dataset.slideElementGroupId ?? '',
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              },
            ];
          });

          const outOfBounds = elements
            .filter(
              (box) =>
                box.left < viewportRect.left - 1 ||
                box.top < viewportRect.top - 1 ||
                box.right > viewportRect.right + 1 ||
                box.bottom > viewportRect.bottom + 1,
            )
            .map((box) => box.id);

          const textOverflow = Array.from(
            document.querySelectorAll<HTMLElement>('[data-slide-element-type="text"]'),
          ).flatMap((root): string[] => {
            const box = root.querySelector<HTMLElement>('.base-element-text');
            const content = root.querySelector<HTMLElement>('.element-content');
            if (!box || !content) return [];
            const boxRect = box.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const overflowed =
              contentRect.right > boxRect.right + 1 || contentRect.bottom > boxRect.bottom + 1;
            return overflowed ? [root.dataset.slideElementId ?? ''] : [];
          });

          const failedImages = Array.from(document.images)
            .filter((image) => image.complete && image.naturalWidth === 0)
            .map(
              (image) =>
                image.closest<HTMLElement>('[data-slide-element-id]')?.dataset.slideElementId ?? '',
            )
            .filter(Boolean);

          const overlapSensitive = new Set(['text', 'table', 'chart', 'latex', 'code']);
          const overlaps: Array<[string, string]> = [];
          for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
            const left = elements[leftIndex];
            if (!overlapSensitive.has(left.type) || left.width <= 0 || left.height <= 0) continue;
            for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
              const right = elements[rightIndex];
              if (!overlapSensitive.has(right.type) || right.width <= 0 || right.height <= 0)
                continue;
              if (left.groupId && left.groupId === right.groupId) continue;
              const overlapWidth = Math.max(
                0,
                Math.min(left.right, right.right) - Math.max(left.left, right.left),
              );
              const overlapHeight = Math.max(
                0,
                Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
              );
              const ratio =
                (overlapWidth * overlapHeight) /
                Math.min(left.width * left.height, right.width * right.height);
              if (ratio >= 0.15) overlaps.push([left.id, right.id]);
            }
          }

          const failedVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
            .filter(
              (video) => !!video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE,
            )
            .map(
              (video) =>
                video.closest<HTMLElement>('[data-slide-element-id]')?.dataset.slideElementId ?? '',
            )
            .filter(Boolean);

          const renderedMojibake = Array.from(
            document.querySelectorAll<HTMLElement>('[data-slide-element-id]'),
          )
            .filter((root) => /(?:\uFFFD|Ã.|Â.|â€|ðŸ|鈥|锟斤拷)/u.test(root.textContent ?? ''))
            .map((root) => root.dataset.slideElementId ?? '')
            .filter(Boolean);

          const fontFailures = Array.from(
            document.querySelectorAll<HTMLElement>('[data-slide-element-type="text"]'),
          )
            .filter((root) => {
              const content = root.querySelector<HTMLElement>('.element-content');
              if (!content) return false;
              const style = getComputedStyle(content);
              const sample = (content.textContent ?? '').trim().slice(0, 64);
              return (
                !!sample && !document.fonts.check(`${style.fontSize} ${style.fontFamily}`, sample)
              );
            })
            .map((root) => root.dataset.slideElementId ?? '')
            .filter(Boolean);

          return {
            outOfBounds,
            textOverflow,
            failedImages,
            failedVideos,
            renderedMojibake,
            fontFailures,
            overlaps,
          };
        });

        for (const id of measurements.outOfBounds) {
          addIssue('element_out_of_bounds', 'warning', `Element ${id} crosses the slide boundary`, [
            id,
          ]);
        }
        for (const id of measurements.textOverflow) {
          addIssue('text_overflow', 'critical', `Text content overflows element ${id}`, [id]);
        }
        for (const id of measurements.failedImages) {
          addIssue('image_failed', 'critical', `Image failed to render in element ${id}`, [id]);
        }
        for (const id of measurements.failedVideos) {
          addIssue('video_failed', 'critical', `Video failed to load in element ${id}`, [id]);
        }
        for (const id of measurements.renderedMojibake) {
          addIssue(
            'rendered_mojibake',
            'critical',
            `Rendered text contains replacement characters or mojibake in element ${id}`,
            [id],
          );
        }
        for (const id of measurements.fontFailures) {
          addIssue('font_failed', 'warning', `Configured font did not load for element ${id}`, [
            id,
          ]);
        }
        for (const [leftId, rightId] of measurements.overlaps) {
          addIssue(
            'content_overlap',
            'critical',
            `Content elements ${leftId} and ${rightId} significantly overlap`,
            [leftId, rightId],
          );
        }
        for (const runtimeError of runtimeErrors) {
          addIssue(runtimeError.code, 'critical', runtimeError.message);
        }

        await surface.screenshot({ path: screenshotPath, animations: 'disabled' });
        if (options.reviewScreenshot) {
          reviewTasks.push({ scene, screenshotPath, addIssue });
        }
      } catch (error) {
        addIssue(
          'render_failed',
          'critical',
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        await page.close();
      }

      slides.push({
        sceneId: scene.id,
        title: scene.title,
        screenshot: relativeScreenshot,
        issues,
      });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (options.reviewScreenshot && reviewTasks.length > 0) {
    let cursor = 0;
    const workerCount = Math.max(
      1,
      Math.min(options.visionReviewConcurrency ?? 2, reviewTasks.length),
    );
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < reviewTasks.length) {
          const task = reviewTasks[cursor];
          cursor += 1;
          try {
            const findings = await options.reviewScreenshot!({
              scene: task.scene,
              screenshotPath: task.screenshotPath,
            });
            for (const finding of findings) {
              task.addIssue(
                'vision_issue',
                finding.severity,
                finding.message,
                finding.elementIds,
                finding.category,
              );
            }
          } catch (error) {
            task.addIssue(
              'vision_review_failed',
              'critical',
              `Multimodal review failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }),
    );
  }

  const issues = slides.flatMap((slide) => slide.issues);
  const counts = issues.reduce(
    (result, issue) => {
      result[issue.severity] += 1;
      return result;
    },
    { critical: 0, warning: 0 },
  );
  return {
    schemaVersion: 'openmaic-courseware-visual-audit-v1',
    generatedAt: new Date().toISOString(),
    classroomId: options.classroomId,
    viewport: VIEWPORT,
    publishable: counts.critical === 0,
    counts,
    slides,
    issues,
  };
}

export function mergeCoursewareVisualAuditReports(
  base: CoursewareVisualAuditReport,
  replacement: CoursewareVisualAuditReport,
  scenes: Scene[],
): CoursewareVisualAuditReport {
  const replacementBySceneId = new Map(replacement.slides.map((slide) => [slide.sceneId, slide]));
  const baseBySceneId = new Map(base.slides.map((slide) => [slide.sceneId, slide]));
  const slides = scenes
    .filter((scene) => scene.content.type === 'slide')
    .map((scene) => replacementBySceneId.get(scene.id) ?? baseBySceneId.get(scene.id))
    .filter((slide): slide is VisualAuditSlideResult => !!slide);
  let issueIndex = 0;
  const normalizedSlides = slides.map((slide) => ({
    ...slide,
    issues: slide.issues.map((issue) => {
      issueIndex += 1;
      return { ...issue, id: `visual-${String(issueIndex).padStart(4, '0')}` };
    }),
  }));
  const issues = normalizedSlides.flatMap((slide) => slide.issues);
  const counts = issues.reduce(
    (result, issue) => {
      result[issue.severity] += 1;
      return result;
    },
    { critical: 0, warning: 0 },
  );
  return {
    ...base,
    generatedAt: replacement.generatedAt,
    publishable: counts.critical === 0,
    counts,
    slides: normalizedSlides,
    issues,
  };
}
