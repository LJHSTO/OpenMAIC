import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { patchHtmlForIframe } from '@/lib/utils/iframe';
import type { Scene } from '@/lib/types/stage';
import type { Frame, Page } from '@playwright/test';

export type InteractiveAuditSeverity = 'critical' | 'warning';

export interface InteractiveAuditIssue {
  id: string;
  code:
    | 'load_failed'
    | 'runtime_error'
    | 'console_error'
    | 'resource_failed'
    | 'http_error'
    | 'external_dependency'
    | 'image_failed'
    | 'rendered_mojibake'
    | 'empty_document'
    | 'blank_render'
    | 'viewport_overflow'
    | 'interaction_failed'
    | 'no_obvious_interaction';
  severity: InteractiveAuditSeverity;
  sceneId: string;
  message: string;
  resource?: string;
}

export interface InteractiveAuditMetrics {
  bodyChildren: number;
  textLength: number;
  visibleElements: number;
  controls: number;
  canvases: number;
  svgs: number;
  scrollWidth: number;
  scrollHeight: number;
  failedImages: number;
  averagePixelStdev: number;
}

export interface InteractiveAuditSceneResult {
  sceneId: string;
  title: string;
  screenshot: string;
  metrics?: InteractiveAuditMetrics;
  interaction?: {
    attempted: boolean;
    selector?: string;
    succeeded?: boolean;
    error?: string;
  };
  issues: InteractiveAuditIssue[];
}

export interface CoursewareInteractiveAuditReport {
  schemaVersion: 'openmaic-courseware-interactive-audit-v1';
  generatedAt: string;
  classroomId: string;
  viewport: { width: number; height: number };
  publishable: boolean;
  counts: Record<InteractiveAuditSeverity, number>;
  scenes: InteractiveAuditSceneResult[];
  issues: InteractiveAuditIssue[];
}

export interface RunInteractiveAuditOptions {
  baseUrl: string;
  classroomId: string;
  scenes: Scene[];
  screenshotsDir: string;
  timeoutMs?: number;
  concurrency?: number;
  exercise?: boolean;
  blockExternalMedia?: boolean;
  sceneIds?: Iterable<string>;
}

const VIEWPORT = { width: 1280, height: 720 } as const;
const MOJIBAKE_PATTERN = /(?:\uFFFD|Ã.|Â.|â€|ðŸ|鈥|锟斤拷|烫烫烫|屯屯屯)/u;

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'scene';
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function withBaseHref(html: string, baseUrl: string): string {
  if (/<base\b/i.test(html)) return html;
  const base = `<base href="${escapeAttribute(new URL('/', baseUrl).toString())}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n${base}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (root) => `${root}\n<head>${base}</head>`);
  }
  return `<!doctype html>\n<html><head>${base}</head><body>${html}</body></html>`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isBenignRuntimeMessage(message: string): boolean {
  return /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i.test(
    message,
  );
}

async function firstVisibleControl(frame: Frame): Promise<string | undefined> {
  for (const selector of [
    'input[type="range"]',
    'select',
    'button',
    '[role="button"]',
    'canvas',
    'svg',
  ]) {
    const locator = frame.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) return selector;
    } catch {
      // Detached elements are treated as unavailable.
    }
  }
  return undefined;
}

async function exerciseInteractive(
  frame: Frame,
): Promise<NonNullable<InteractiveAuditSceneResult['interaction']>> {
  const selector = await firstVisibleControl(frame);
  if (!selector) return { attempted: false };
  const locator = frame.locator(selector).first();
  try {
    if (selector === 'input[type="range"]') {
      await locator.evaluate((element: HTMLInputElement) => {
        const minimum = Number(element.min || 0);
        const maximum = Number(element.max || 100);
        const step = Number(element.step || 1);
        const current = Number(element.value || minimum);
        const next = current + step <= maximum ? current + step : Math.max(minimum, current - step);
        element.value = String(next);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } else if (selector === 'select') {
      const values = await locator
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      if (values.length > 1) await locator.selectOption(values[1]);
    } else if (selector === 'canvas' || selector === 'svg') {
      await locator.click({ position: { x: 20, y: 20 }, timeout: 3_000 });
    } else {
      await locator.click({ timeout: 3_000 });
    }
    return { attempted: true, selector, succeeded: true };
  } catch (error) {
    return {
      attempted: true,
      selector,
      succeeded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function screenshotStdev(buffer: Buffer): Promise<number> {
  const stats = await sharp(buffer).stats();
  const channels = stats.channels.slice(0, Math.min(3, stats.channels.length));
  return channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, channels.length);
}

async function waitForFrameAssets(frame: Frame): Promise<void> {
  await frame.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    await Promise.race([
      Promise.all(
        images.map((image) => {
          if (image.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          });
        }),
      ),
      new Promise<void>((resolve) => window.setTimeout(resolve, 5_000)),
    ]);
  });
}

async function auditScene(
  page: Page,
  scene: Scene & { content: Extract<Scene['content'], { type: 'interactive' }> },
  options: RunInteractiveAuditOptions,
  screenshotIndex: number,
): Promise<InteractiveAuditSceneResult> {
  const issues: Array<Omit<InteractiveAuditIssue, 'id'>> = [];
  const consoleErrors: string[] = [];
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];
  const externalResources: string[] = [];
  const baseOrigin = new URL(options.baseUrl).origin;
  const addIssue = (issue: Omit<InteractiveAuditIssue, 'id' | 'sceneId'>): void => {
    issues.push({ ...issue, sceneId: scene.id });
  };

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    try {
      const url = new URL(request.url());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== baseOrigin) {
        externalResources.push(url.toString());
      }
    } catch {
      // Non-URL browser-internal requests do not affect portability.
    }
  });

  const filename = `${String(screenshotIndex + 1).padStart(3, '0')}-${safeSegment(scene.id)}.png`;
  const screenshotPath = path.join(options.screenshotsDir, filename);
  const relativeScreenshot = `interactive-screenshots/${filename}`;
  let metrics: InteractiveAuditMetrics | undefined;
  let interaction: InteractiveAuditSceneResult['interaction'];

  try {
    await page.setViewportSize(VIEWPORT);
    await page.setContent(
      '<!doctype html><html><body style="margin:0;background:#fff"><iframe id="audit-frame" style="display:block;width:1280px;height:720px;border:0" sandbox=""></iframe><script>window.__openmaicAuditMessages=[];window.addEventListener("message",function(event){var data=event&&event.data;if(data&&data.__maicInteractive===true&&data.kind==="runtime-error")window.__openmaicAuditMessages.push("["+(data.errorKind||"error")+"] "+String(data.message||""));});var frame=document.getElementById("audit-frame");frame.addEventListener("load",function(){frame.dataset.loaded="true";});</script></body></html>',
      { waitUntil: 'domcontentloaded' },
    );
    const inlineHtml = scene.content.html?.trim();
    const sourceUrl = scene.content.url?.trim();
    await page.locator('#audit-frame').evaluate(
      (iframe: HTMLIFrameElement, source: { html?: string; url?: string }) => {
        iframe.dataset.loaded = 'false';
        iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
        if (source.html) iframe.srcdoc = source.html;
        else iframe.src = source.url ?? 'about:blank';
      },
      {
        html: inlineHtml
          ? withBaseHref(patchHtmlForIframe(inlineHtml), options.baseUrl)
          : undefined,
        url: sourceUrl ? new URL(sourceUrl, options.baseUrl).toString() : undefined,
      },
    );
    await page.waitForFunction(
      () => document.querySelector<HTMLIFrameElement>('#audit-frame')?.dataset.loaded === 'true',
      undefined,
      { timeout: options.timeoutMs ?? 30_000 },
    );
    await page.waitForTimeout(scene.content.widgetType === 'visualization3d' ? 2_500 : 1_000);
    const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
    if (!frame) throw new Error('互动 iframe 未创建可检查的子文档。');
    await waitForFrameAssets(frame);

    const measured = await frame.evaluate(() => {
      const body = document.body;
      if (!body) return null;
      const elements = Array.from(body.querySelectorAll<HTMLElement>('*'));
      const visible = elements.filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) > 0 &&
          rect.width > 1 &&
          rect.height > 1
        );
      });
      const controls = visible.filter((element) =>
        element.matches('button,input,select,textarea,[role="button"],[tabindex]'),
      );
      const text = (body.innerText || '').trim();
      return {
        bodyChildren: body.children.length,
        textLength: text.length,
        visibleElements: visible.length,
        controls: controls.length,
        canvases: visible.filter((element) => element.tagName === 'CANVAS').length,
        svgs: visible.filter((element) => element.tagName === 'SVG').length,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        failedImages: Array.from(document.images).filter(
          (image) => image.complete && image.naturalWidth === 0,
        ).length,
        renderedText: text,
      };
    });
    if (!measured) throw new Error('互动文档缺少 body。');

    if (options.exercise !== false) {
      interaction = await exerciseInteractive(frame);
      await page.waitForTimeout(300);
      if (interaction.attempted && interaction.succeeded === false) {
        addIssue({
          code: 'interaction_failed',
          severity: 'warning',
          message: `自动操作控件失败：${interaction.error ?? '未知错误'}`,
        });
      }
    }

    await fs.mkdir(options.screenshotsDir, { recursive: true });
    const screenshot = await page.locator('#audit-frame').screenshot({
      path: screenshotPath,
      animations: 'disabled',
    });
    const averagePixelStdev = await screenshotStdev(screenshot);
    metrics = {
      bodyChildren: measured.bodyChildren,
      textLength: measured.textLength,
      visibleElements: measured.visibleElements,
      controls: measured.controls,
      canvases: measured.canvases,
      svgs: measured.svgs,
      scrollWidth: measured.scrollWidth,
      scrollHeight: measured.scrollHeight,
      failedImages: measured.failedImages,
      averagePixelStdev,
    };

    const capturedMessages = (await page.evaluate(
      () =>
        (window as Window & { __openmaicAuditMessages?: string[] }).__openmaicAuditMessages ?? [],
    )) as string[];
    for (const message of dedupe([...runtimeErrors, ...capturedMessages]).filter(
      (message) => !isBenignRuntimeMessage(message),
    )) {
      addIssue({ code: 'runtime_error', severity: 'critical', message });
    }
    for (const message of dedupe(consoleErrors).filter(
      (message) => !isBenignRuntimeMessage(message),
    )) {
      addIssue({ code: 'console_error', severity: 'critical', message });
    }
    for (const message of dedupe(failedRequests)) {
      addIssue({ code: 'resource_failed', severity: 'critical', message });
    }
    for (const message of dedupe(failedResponses)) {
      addIssue({ code: 'http_error', severity: 'critical', message });
    }
    for (const resource of dedupe(externalResources)) {
      addIssue({
        code: 'external_dependency',
        severity: options.blockExternalMedia ? 'critical' : 'warning',
        resource,
        message: '互动课件依赖外部网络资源，离线归档和后续部署无法保证可用。',
      });
    }
    if (measured.failedImages > 0) {
      addIssue({
        code: 'image_failed',
        severity: 'critical',
        message: `互动课件中有 ${measured.failedImages} 张图片无法解码或显示。`,
      });
    }
    if (MOJIBAKE_PATTERN.test(measured.renderedText)) {
      addIssue({
        code: 'rendered_mojibake',
        severity: 'critical',
        message: '互动课件渲染后的可见文本包含乱码或替换字符。',
      });
    }
    if (measured.bodyChildren === 0 || measured.visibleElements === 0) {
      addIssue({
        code: 'empty_document',
        severity: 'critical',
        message: '互动课件没有可见的渲染内容。',
      });
    }
    if (
      averagePixelStdev < 0.8 &&
      measured.textLength < 12 &&
      measured.controls + measured.canvases + measured.svgs === 0
    ) {
      addIssue({
        code: 'blank_render',
        severity: 'critical',
        message: '互动课件截图接近空白，且没有足够文字或交互表面。',
      });
    }
    if (measured.scrollWidth > VIEWPORT.width + 4 || measured.scrollHeight > VIEWPORT.height + 4) {
      addIssue({
        code: 'viewport_overflow',
        severity: 'warning',
        message: `互动内容超出 ${VIEWPORT.width}×${VIEWPORT.height} 视口，学生可能需要滚动或遇到裁切。`,
      });
    }
    if (measured.controls + measured.canvases + measured.svgs === 0) {
      addIssue({
        code: 'no_obvious_interaction',
        severity: 'warning',
        message: '未检测到可见控件、Canvas 或 SVG 交互表面。',
      });
    }
  } catch (error) {
    addIssue({
      code: 'load_failed',
      severity: 'critical',
      message: error instanceof Error ? error.message : String(error),
    });
    try {
      await fs.mkdir(options.screenshotsDir, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      // The JSON report still contains the load failure when no screenshot is possible.
    }
  }

  return {
    sceneId: scene.id,
    title: scene.title,
    screenshot: relativeScreenshot,
    metrics,
    interaction,
    issues: issues as InteractiveAuditIssue[],
  };
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

function finalizeReport(
  classroomId: string,
  scenes: InteractiveAuditSceneResult[],
  generatedAt = new Date().toISOString(),
): CoursewareInteractiveAuditReport {
  let issueIndex = 0;
  const normalizedScenes = scenes.map((scene) => ({
    ...scene,
    issues: scene.issues.map((issue) => {
      issueIndex += 1;
      return { ...issue, id: `interactive-${String(issueIndex).padStart(4, '0')}` };
    }),
  }));
  const issues = normalizedScenes.flatMap((scene) => scene.issues);
  const counts = issues.reduce(
    (result, issue) => {
      result[issue.severity] += 1;
      return result;
    },
    { critical: 0, warning: 0 },
  );
  return {
    schemaVersion: 'openmaic-courseware-interactive-audit-v1',
    generatedAt,
    classroomId,
    viewport: VIEWPORT,
    publishable: counts.critical === 0,
    counts,
    scenes: normalizedScenes,
    issues,
  };
}

export async function runCoursewareInteractiveAudit(
  options: RunInteractiveAuditOptions,
): Promise<CoursewareInteractiveAuditReport> {
  const selectedSceneIds = options.sceneIds ? new Set(options.sceneIds) : null;
  const interactiveScenes = options.scenes.filter(
    (scene): scene is Scene & { content: Extract<Scene['content'], { type: 'interactive' }> } =>
      scene.content.type === 'interactive' && (!selectedSceneIds || selectedSceneIds.has(scene.id)),
  );
  await fs.mkdir(options.screenshotsDir, { recursive: true });
  if (interactiveScenes.length === 0) return finalizeReport(options.classroomId, []);

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  try {
    const results = await runPool(
      interactiveScenes,
      Math.max(1, Math.min(options.concurrency ?? 3, 8)),
      async (scene, index) => {
        const page = await context.newPage();
        try {
          return await auditScene(page, scene, options, index);
        } finally {
          await page.close();
        }
      },
    );
    return finalizeReport(options.classroomId, results);
  } finally {
    await context.close();
    await browser.close();
  }
}

export function mergeCoursewareInteractiveAuditReports(
  base: CoursewareInteractiveAuditReport,
  replacement: CoursewareInteractiveAuditReport,
  scenes: Scene[],
): CoursewareInteractiveAuditReport {
  const replacementBySceneId = new Map(replacement.scenes.map((scene) => [scene.sceneId, scene]));
  const baseBySceneId = new Map(base.scenes.map((scene) => [scene.sceneId, scene]));
  const mergedScenes = scenes
    .filter((scene) => scene.content.type === 'interactive')
    .map((scene) => replacementBySceneId.get(scene.id) ?? baseBySceneId.get(scene.id))
    .filter((scene): scene is InteractiveAuditSceneResult => !!scene);
  return finalizeReport(base.classroomId, mergedScenes, replacement.generatedAt);
}
