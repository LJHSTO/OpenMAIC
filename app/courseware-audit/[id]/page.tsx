import { notFound } from 'next/navigation';
import { CoursewareAuditSlide } from '@/components/courseware/courseware-audit-slide';
import { readClassroom } from '@/lib/server/classroom-storage';

export const dynamic = 'force-dynamic';

export default async function CoursewareAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sceneId?: string }>;
}) {
  const [{ id }, { sceneId }] = await Promise.all([params, searchParams]);
  const classroom = await readClassroom(id);
  if (!classroom) notFound();
  const scene = classroom.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene || scene.content.type !== 'slide') notFound();
  return <CoursewareAuditSlide slide={scene.content.canvas} />;
}
