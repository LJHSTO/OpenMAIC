import { promises as fs, type Dirent } from 'fs';
import path from 'path';
import { CLASSROOMS_DIR, persistClassroom } from '@/lib/server/classroom-storage';
import type { Scene, Stage } from '@/lib/types/stage';

export interface CoursewareStoredResource {
  path: string;
  data: Buffer;
}

export interface CoursewareAuditStorage {
  saveDraft(
    input: { id: string; stage: Stage; scenes: Scene[] },
    baseUrl: string,
  ): Promise<{ id: string; url: string; createdAt: string }>;
  readResource(classroomId: string, relativePath: string): Promise<Buffer | null>;
  listResources(classroomId: string): Promise<CoursewareStoredResource[]>;
}

function classroomRoot(classroomId: string): string {
  return path.resolve(CLASSROOMS_DIR, classroomId);
}

function resolveResourcePath(classroomId: string, relativePath: string): string | null {
  if (!/^(?:audio|media)\/[a-zA-Z0-9._-]+$/.test(relativePath)) return null;
  const root = classroomRoot(classroomId);
  const absolute = path.resolve(root, ...relativePath.split('/'));
  return absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}

async function listFiles(root: string, relative = ''): Promise<CoursewareStoredResource[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const children = await Promise.all(
    entries.map(async (entry) => {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) return listFiles(root, childRelative);
      if (!entry.isFile()) return [];
      return [
        {
          path: childRelative.split(path.sep).join('/'),
          data: await fs.readFile(path.join(root, childRelative)),
        },
      ];
    }),
  );
  return children.flat();
}

export const fileSystemCoursewareAuditStorage: CoursewareAuditStorage = {
  saveDraft: persistClassroom,
  async readResource(classroomId, relativePath) {
    const absolute = resolveResourcePath(classroomId, relativePath);
    if (!absolute) return null;
    try {
      return await fs.readFile(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  listResources(classroomId) {
    return listFiles(classroomRoot(classroomId));
  },
};
