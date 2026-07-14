import { promises as fs } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import type { CoursewareGuardReport } from '@/lib/courseware-guard';
import type { CoursewareVisualAuditReport } from '@/lib/courseware-guard/visual-audit';
import {
  CLASSROOM_ZIP_EXTENSION,
  CLASSROOM_ZIP_FORMAT_VERSION,
  type ClassroomManifest,
  type ManifestAgent,
  type ManifestScene,
  type MediaIndexEntry,
} from '@/lib/export/classroom-zip-types';
import { actionsToManifest } from '@/lib/export/classroom-zip-utils';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import type { Scene, Stage } from '@/lib/types/stage';

export interface CoursewareArchiveOptions {
  stage: Stage;
  scenes: Scene[];
  model: string;
  guardReport: CoursewareGuardReport;
  visualReport: CoursewareVisualAuditReport;
  screenshotsDir: string;
  outputDir?: string;
}

export interface CoursewareArchiveResult {
  path: string;
  filename: string;
  outputDir: string;
  size: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

export function sanitizeArtifactSegment(value: string, fallback: string): string {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^\.+|[. ]+$/g, '')
      .slice(0, 80) || fallback
  );
}

export function buildCoursewareArtifactFilename(
  courseTitle: string,
  model: string,
  createdAt = new Date(),
): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${sanitizeArtifactSegment(courseTitle, 'course')}__${sanitizeArtifactSegment(model, 'model')}__${timestamp}${CLASSROOM_ZIP_EXTENSION}`;
}

export function resolveCoursewareOutputDir(override?: string): string {
  const configured = override?.trim() || process.env.OPENMAIC_COURSEWARE_OUTPUT_DIR?.trim();
  if (!configured) return path.join(process.cwd(), 'data', 'courseware-output');
  return path.resolve(configured);
}

async function listFilesRecursive(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const children = await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(root, entry.name);
        if (entry.isDirectory()) return listFilesRecursive(absolute);
        return entry.isFile() ? [absolute] : [];
      }),
    );
    return children.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function agentManifest(stage: Stage): { agents: ManifestAgent[]; ids: Map<string, number> } {
  const agents = (stage.generatedAgentConfigs ?? []).map((agent) => ({
    name: agent.name,
    role: agent.role,
    persona: agent.persona,
    avatar: agent.avatar,
    color: agent.color,
    priority: agent.priority,
  }));
  const ids = new Map<string, number>();
  stage.generatedAgentConfigs?.forEach((agent, index) => ids.set(agent.id, index));
  return { agents, ids };
}

function portableSceneContent(scene: Scene, mediaIndex: Record<string, MediaIndexEntry>) {
  const content = JSON.parse(JSON.stringify(scene.content)) as Scene['content'];
  if (content.type !== 'slide') return content;
  for (const element of content.canvas.elements) {
    if (element.type !== 'image' && element.type !== 'video') continue;
    if (typeof element.src !== 'string') continue;
    let pathname: string;
    try {
      pathname = new URL(element.src).pathname;
    } catch {
      continue;
    }
    const marker = `/api/classroom-media/${scene.stageId}/media/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) continue;
    const filename = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    const resourcePath = `media/${filename}`;
    if (!mediaIndex[resourcePath]) continue;
    const mediaRef = filename.replace(/\.[^.]+$/, '');
    element.src = mediaRef;
  }
  return content;
}

export async function createCoursewareArchive(
  options: CoursewareArchiveOptions,
): Promise<CoursewareArchiveResult> {
  if (!options.guardReport.publishable || !options.visualReport.publishable) {
    throw new Error('Courseware archive blocked because validation has critical issues');
  }

  const outputDir = resolveCoursewareOutputDir(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  const filename = buildCoursewareArtifactFilename(options.stage.name, options.model);
  const outputPath = path.join(outputDir, filename);
  const zip = new JSZip();
  const classroomResourceDir = path.join(CLASSROOMS_DIR, options.stage.id);
  const resourceFiles = await listFilesRecursive(classroomResourceDir);
  const mediaIndex: Record<string, MediaIndexEntry> = {};
  const audioIdToPath = new Map<string, string>();

  for (const absolutePath of resourceFiles) {
    const relativePath = path
      .relative(classroomResourceDir, absolutePath)
      .split(path.sep)
      .join('/');
    const data = await fs.readFile(absolutePath);
    zip.file(relativePath, data);
    const extension = path.extname(relativePath).toLowerCase();
    if (relativePath.startsWith('audio/')) {
      mediaIndex[relativePath] = {
        type: 'audio',
        format: extension.replace(/^\./, '') || undefined,
        size: data.byteLength,
      };
      audioIdToPath.set(path.basename(relativePath, extension), relativePath);
    } else if (relativePath.startsWith('media/')) {
      if (/\.poster\.jpg$/i.test(relativePath)) continue;
      mediaIndex[relativePath] = {
        type: 'generated',
        mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
        size: data.byteLength,
      };
    }
  }

  const { agents, ids: agentIdToIndex } = agentManifest(options.stage);
  const scenes: ManifestScene[] = options.scenes.map((scene) => {
    const actions = scene.actions
      ? actionsToManifest(scene.actions, audioIdToPath, agentIdToIndex).map((action) => {
          if (action.type !== 'speech' || !action.audioRef) return action;
          const { audioUrl: _audioUrl, ...portableAction } = action as typeof action & {
            audioUrl?: string;
          };
          return portableAction as typeof action;
        })
      : undefined;
    return {
      type: scene.type,
      title: scene.title,
      order: scene.order,
      content: portableSceneContent(scene, mediaIndex),
      actions,
      whiteboards: scene.whiteboards,
      ...(scene.multiAgent?.enabled
        ? {
            multiAgent: {
              enabled: true,
              agentIndices: (scene.multiAgent.agentIds ?? [])
                .map((id) => agentIdToIndex.get(id))
                .filter((index): index is number => index !== undefined),
              directorPrompt: scene.multiAgent.directorPrompt,
            },
          }
        : {}),
    };
  });
  const manifest: ClassroomManifest = {
    formatVersion: CLASSROOM_ZIP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: process.env.npm_package_version || '0.0.0',
    stage: {
      name: options.stage.name,
      description: options.stage.description,
      language: options.stage.languageDirective,
      style: options.stage.style,
      createdAt: options.stage.createdAt,
      updatedAt: options.stage.updatedAt,
    },
    agents,
    scenes,
    mediaIndex,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file(
    'classroom.json',
    JSON.stringify({ id: options.stage.id, stage: options.stage, scenes: options.scenes }, null, 2),
  );
  zip.file('courseware-guard-report.json', JSON.stringify(options.guardReport, null, 2));
  zip.file('courseware-visual-report.json', JSON.stringify(options.visualReport, null, 2));

  const screenshotFiles = await listFilesRecursive(options.screenshotsDir);
  for (const screenshotPath of screenshotFiles) {
    const relative = path
      .relative(options.screenshotsDir, screenshotPath)
      .split(path.sep)
      .join('/');
    zip.file(`screenshots/${relative}`, await fs.readFile(screenshotPath));
  }

  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, archive);
  await fs.rename(temporaryPath, outputPath);
  return { path: outputPath, filename, outputDir, size: archive.byteLength };
}
