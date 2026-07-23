import { createHash } from 'crypto';
import sharp from 'sharp';
import {
  fileSystemCoursewareAuditStorage,
  type CoursewareAuditStorage,
} from '@/lib/server/courseware-audit-storage';
import type { Scene, Stage } from '@/lib/types/stage';

export type CoursewareResourceSeverity = 'critical' | 'warning';

export interface CoursewareResourceIssue {
  id: string;
  code:
    | 'resource_missing'
    | 'resource_empty'
    | 'resource_path_invalid'
    | 'resource_external'
    | 'resource_blob_url'
    | 'image_decode_failed'
    | 'image_dimensions_invalid'
    | 'media_source_missing';
  severity: CoursewareResourceSeverity;
  path: string;
  message: string;
  sceneId?: string;
  resource?: string;
}

export interface CoursewareResourceEntry {
  path: string;
  kind: 'image' | 'video' | 'poster' | 'audio';
  size: number;
  sha256: string;
  width?: number;
  height?: number;
  format?: string;
}

export interface CoursewareResourceAuditReport {
  schemaVersion: 'openmaic-courseware-resource-audit-v1';
  generatedAt: string;
  classroomId: string;
  publishable: boolean;
  counts: Record<CoursewareResourceSeverity, number>;
  checked: number;
  resources: CoursewareResourceEntry[];
  issues: CoursewareResourceIssue[];
}

interface AuditOptions {
  blockExternalMedia?: boolean;
  storage?: Pick<CoursewareAuditStorage, 'readResource'>;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function localResourceReference(classroomId: string, source: string): string | null {
  let relative: string;
  try {
    const pathname = new URL(source, 'http://openmaic.local').pathname;
    const marker = `/api/classroom-media/${classroomId}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    relative = decodeURIComponent(pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
  if (!/^(?:audio|media)\/[a-zA-Z0-9._-]+$/.test(relative)) return null;
  return relative;
}

function isExternalSource(source: string): boolean {
  return /^https?:\/\//i.test(source) && !source.includes('/api/classroom-media/');
}

function dataUrlBuffer(source: string): Buffer | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(source);
  if (!match) return null;
  try {
    return match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  } catch {
    return null;
  }
}

async function inspectImage(data: Buffer): Promise<{
  width?: number;
  height?: number;
  format?: string;
}> {
  const pipeline = sharp(data, { failOn: 'error' });
  const metadata = await pipeline.metadata();
  await sharp(data, { failOn: 'error' }).stats();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
  };
}

export async function auditCoursewareResources(
  stage: Stage,
  scenes: Scene[],
  options: AuditOptions = {},
): Promise<CoursewareResourceAuditReport> {
  const issues: CoursewareResourceIssue[] = [];
  const resources: CoursewareResourceEntry[] = [];
  const seenFiles = new Set<string>();
  const storage = options.storage ?? fileSystemCoursewareAuditStorage;
  let issueIndex = 0;
  const addIssue = (issue: Omit<CoursewareResourceIssue, 'id'>): void => {
    issueIndex += 1;
    issues.push({ id: `resource-${String(issueIndex).padStart(4, '0')}`, ...issue });
  };

  const inspectSource = async (
    source: string | undefined,
    input: {
      kind: CoursewareResourceEntry['kind'];
      path: string;
      sceneId: string;
      required: boolean;
    },
  ) => {
    const normalized = source?.trim() ?? '';
    if (!normalized) {
      if (input.required) {
        addIssue({
          code: 'media_source_missing',
          severity: 'critical',
          path: input.path,
          sceneId: input.sceneId,
          message: '媒体元素缺少资源地址。',
        });
      }
      return;
    }
    if (/^blob:/i.test(normalized)) {
      addIssue({
        code: 'resource_blob_url',
        severity: 'critical',
        path: input.path,
        sceneId: input.sceneId,
        resource: normalized,
        message: 'Blob URL 只在当前浏览器会话有效，不能用于归档或跨设备加载。',
      });
      return;
    }
    if (isExternalSource(normalized)) {
      addIssue({
        code: 'resource_external',
        severity: options.blockExternalMedia ? 'critical' : 'warning',
        path: input.path,
        sceneId: input.sceneId,
        resource: normalized,
        message: '资源仍依赖外部网络，离线归档和后续部署无法保证可用。',
      });
      return;
    }

    const inline = dataUrlBuffer(normalized);
    let localPath: string | null = null;
    let data: Buffer;
    if (inline) {
      data = inline;
    } else {
      localPath = localResourceReference(stage.id, normalized);
      if (!localPath) {
        addIssue({
          code: 'resource_path_invalid',
          severity: 'critical',
          path: input.path,
          sceneId: input.sceneId,
          resource: normalized,
          message: '资源地址无法映射到当前课堂的本地资源目录。',
        });
        return;
      }
      if (seenFiles.has(localPath)) return;
      seenFiles.add(localPath);
      try {
        const stored = await storage.readResource(stage.id, localPath);
        if (!stored) {
          addIssue({
            code: 'resource_missing',
            severity: 'critical',
            path: input.path,
            sceneId: input.sceneId,
            resource: normalized,
            message: '本地资源不存在。',
          });
          return;
        }
        data = stored;
      } catch (error) {
        addIssue({
          code: 'resource_missing',
          severity: 'critical',
          path: input.path,
          sceneId: input.sceneId,
          resource: normalized,
          message: `本地资源不存在：${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
    }
    if (data.byteLength === 0) {
      addIssue({
        code: 'resource_empty',
        severity: 'critical',
        path: input.path,
        sceneId: input.sceneId,
        resource: normalized,
        message: '资源文件大小为 0。',
      });
      return;
    }

    const entry: CoursewareResourceEntry = {
      path: localPath ?? `${input.sceneId}:${input.path}`,
      kind: input.kind,
      size: data.byteLength,
      sha256: sha256(data),
    };
    if (input.kind === 'image' || input.kind === 'poster') {
      try {
        const image = await inspectImage(data);
        Object.assign(entry, image);
        if (!image.width || !image.height || image.width < 1 || image.height < 1) {
          addIssue({
            code: 'image_dimensions_invalid',
            severity: 'critical',
            path: input.path,
            sceneId: input.sceneId,
            resource: normalized,
            message: '图片没有有效宽高。',
          });
        }
      } catch (error) {
        addIssue({
          code: 'image_decode_failed',
          severity: 'critical',
          path: input.path,
          sceneId: input.sceneId,
          resource: normalized,
          message: `图片无法完整解码：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    resources.push(entry);
  };

  for (const [sceneIndex, scene] of scenes.entries()) {
    if (scene.content.type === 'slide') {
      for (const [elementIndex, element] of scene.content.canvas.elements.entries()) {
        if (element.type !== 'image' && element.type !== 'video') continue;
        const elementPath = `scenes[${sceneIndex}].content.canvas.elements[${elementIndex}]`;
        await inspectSource(element.src, {
          kind: element.type,
          path: `${elementPath}.src`,
          sceneId: scene.id,
          required: true,
        });
        if (element.type === 'video' && element.poster) {
          await inspectSource(element.poster, {
            kind: 'poster',
            path: `${elementPath}.poster`,
            sceneId: scene.id,
            required: false,
          });
        }
      }
    }
    for (const [actionIndex, action] of (scene.actions ?? []).entries()) {
      if (action.type !== 'speech' || !action.audioUrl) continue;
      await inspectSource(action.audioUrl, {
        kind: 'audio',
        path: `scenes[${sceneIndex}].actions[${actionIndex}].audioUrl`,
        sceneId: scene.id,
        required: false,
      });
    }
  }

  const counts = issues.reduce(
    (result, issue) => {
      result[issue.severity] += 1;
      return result;
    },
    { critical: 0, warning: 0 },
  );
  return {
    schemaVersion: 'openmaic-courseware-resource-audit-v1',
    generatedAt: new Date().toISOString(),
    classroomId: stage.id,
    publishable: counts.critical === 0,
    counts,
    checked: resources.length,
    resources,
    issues,
  };
}
