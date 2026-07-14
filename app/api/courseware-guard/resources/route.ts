import { promises as fs } from 'fs';
import path from 'path';
import { type NextRequest, NextResponse } from 'next/server';
import {
  buildRequestOrigin,
  CLASSROOMS_DIR,
  isValidClassroomId,
} from '@/lib/server/classroom-storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ResourceEntry {
  field: string;
  path: string;
}

function safeResourcePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/');
  if (!/^(?:audio|media)\/[a-zA-Z0-9._-]+$/.test(normalized)) return null;
  return normalized;
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const classroomId = String(form.get('classroomId') ?? '');
    if (!isValidClassroomId(classroomId)) {
      return NextResponse.json({ success: false, error: 'Invalid classroom id' }, { status: 400 });
    }
    const entries = JSON.parse(String(form.get('manifest') ?? '[]')) as ResourceEntry[];
    if (!Array.isArray(entries)) {
      return NextResponse.json(
        { success: false, error: 'Invalid resource manifest' },
        { status: 400 },
      );
    }

    const classroomDir = path.resolve(CLASSROOMS_DIR, classroomId);
    const resources: Array<{ path: string; url: string }> = [];
    for (const entry of entries) {
      const resourcePath = safeResourcePath(entry.path);
      const file = form.get(entry.field);
      if (!resourcePath || !(file instanceof File)) {
        return NextResponse.json(
          { success: false, error: `Invalid resource entry: ${entry.path}` },
          { status: 400 },
        );
      }
      const target = path.resolve(classroomDir, ...resourcePath.split('/'));
      if (!target.startsWith(`${classroomDir}${path.sep}`)) {
        return NextResponse.json(
          { success: false, error: 'Invalid resource path' },
          { status: 400 },
        );
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(await file.arrayBuffer()));
      resources.push({
        path: resourcePath,
        url: `${buildRequestOrigin(request)}/api/classroom-media/${classroomId}/${resourcePath}`,
      });
    }
    return NextResponse.json({ success: true, resources });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
