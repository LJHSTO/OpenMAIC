import { makeRegenerateSceneTool } from '@/lib/agent/tools/regenerate-scene';
import { planRegenerateApply } from '@/lib/agent/client/apply-regenerate';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import type { LlmStage } from '@/lib/server/model-routes';

export interface RepairCoursewareSceneOptions {
  stage: Stage;
  scene: Scene;
  scenes: Scene[];
  outlines?: SceneOutline[];
  instruction: string;
  aiCall: (
    stage: LlmStage,
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

function outlineForScene(scene: Scene, outlines: SceneOutline[]): SceneOutline {
  return (
    (scene.outlineId ? outlines.find((outline) => outline.id === scene.outlineId) : undefined) ?? {
      id: scene.outlineId || scene.id,
      type: scene.type,
      title: scene.title,
      description: '',
      keyPoints: [],
      order: scene.order,
    }
  );
}

export async function repairCoursewareScene(
  options: RepairCoursewareSceneOptions,
): Promise<Scene | null> {
  if (options.scene.content.type !== 'slide') return null;
  const sourceOutlines = options.outlines ?? [];
  const allOutlines = options.scenes.map((scene) => outlineForScene(scene, sourceOutlines));
  const outline = outlineForScene(options.scene, sourceOutlines);
  const tool = makeRegenerateSceneTool({
    aiCall: options.aiCall,
    getSceneContext: (sceneId) =>
      sceneId === options.scene.id
        ? {
            outline,
            allOutlines,
            content: options.scene.content,
            stageId: options.stage.id,
            languageDirective: options.stage.languageDirective,
          }
        : undefined,
  });
  const result = await tool.execute(
    `courseware-guard-${options.scene.id}`,
    { sceneId: options.scene.id, instruction: options.instruction },
    new AbortController().signal,
  );
  const plan = planRegenerateApply(result.details, options.scene, 'regenerate_scene');
  if (!plan.patch?.content) return null;
  return { ...options.scene, ...plan.patch } as Scene;
}
