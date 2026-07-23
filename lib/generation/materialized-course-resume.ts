interface CompleteMaterializedCourseOptions {
  generationComplete: boolean;
  resumeMedia: () => Promise<void>;
  finalize: () => Promise<void>;
}

export async function completeMaterializedCourse(
  options: CompleteMaterializedCourseOptions,
): Promise<boolean> {
  await options.resumeMedia();
  if (options.generationComplete) return false;
  await options.finalize();
  return true;
}
