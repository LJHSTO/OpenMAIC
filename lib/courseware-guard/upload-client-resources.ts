'use client';

import { collectAudioFiles, collectMediaFiles } from '@/lib/export/classroom-zip-utils';
import type { Scene } from '@/lib/types/stage';

interface UploadedResource {
  path: string;
  url: string;
}

function cloneScenes(scenes: Scene[]): Scene[] {
  return JSON.parse(JSON.stringify(scenes)) as Scene[];
}

export async function uploadClientCoursewareResources(
  classroomId: string,
  scenes: Scene[],
): Promise<Scene[]> {
  const [audioFiles, mediaFiles] = await Promise.all([
    collectAudioFiles(scenes),
    collectMediaFiles(classroomId),
  ]);
  const form = new FormData();
  const manifest: Array<{ field: string; path: string }> = [];
  const mediaPathByElementId = new Map<string, string>();
  const audioPathById = new Map<string, string>();
  let fileIndex = 0;
  const append = (resourcePath: string, blob: Blob) => {
    const field = `file-${fileIndex}`;
    fileIndex += 1;
    manifest.push({ field, path: resourcePath });
    form.append(field, blob, resourcePath.split('/').pop() ?? field);
  };

  for (const audio of audioFiles) {
    append(audio.zipPath, audio.record.blob);
    audioPathById.set(audio.record.id, audio.zipPath);
  }
  for (const media of mediaFiles) {
    append(media.zipPath, media.record.blob);
    mediaPathByElementId.set(media.elementId, media.zipPath);
    if (media.record.poster) {
      append(media.zipPath.replace(/\.\w+$/, '.poster.jpg'), media.record.poster);
    }
  }

  const nextScenes = cloneScenes(scenes);
  if (manifest.length === 0) return nextScenes;
  form.set('classroomId', classroomId);
  form.set('manifest', JSON.stringify(manifest));
  const response = await fetch('/api/courseware-guard/resources', { method: 'POST', body: form });
  const result = (await response.json()) as {
    success?: boolean;
    error?: string;
    resources?: UploadedResource[];
  };
  if (!response.ok || !result.success || !result.resources) {
    throw new Error(result.error || 'Failed to upload generated courseware resources');
  }
  const urlByPath = new Map(result.resources.map((resource) => [resource.path, resource.url]));

  for (const scene of nextScenes) {
    if (scene.content.type === 'slide') {
      for (const element of scene.content.canvas.elements) {
        if (element.type !== 'image' && element.type !== 'video') continue;
        const mediaRef = element.type === 'video' ? element.mediaRef : undefined;
        const candidates = [element.id, element.src, mediaRef].filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        );
        const resourcePath = candidates
          .map((candidate) => mediaPathByElementId.get(candidate))
          .find(Boolean);
        const resourceUrl = resourcePath ? urlByPath.get(resourcePath) : undefined;
        if (resourceUrl) element.src = resourceUrl;
        if (element.type === 'video' && resourcePath) {
          const posterUrl = urlByPath.get(resourcePath.replace(/\.\w+$/, '.poster.jpg'));
          if (posterUrl) element.poster = posterUrl;
        }
      }
    }
    for (const action of scene.actions ?? []) {
      if (action.type !== 'speech' || !action.audioId) continue;
      const resourcePath = audioPathById.get(action.audioId);
      const resourceUrl = resourcePath ? urlByPath.get(resourcePath) : undefined;
      if (resourceUrl) action.audioUrl = resourceUrl;
    }
  }
  return nextScenes;
}
