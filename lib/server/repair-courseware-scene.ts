import { makeRegenerateSceneTool } from '@/lib/agent/tools/regenerate-scene';
import { planRegenerateApply } from '@/lib/agent/client/apply-regenerate';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import type { LlmStage } from '@/lib/server/model-routes';
import type { VisualAuditIssue } from '@/lib/courseware-guard/visual-audit';
import { applyDeterministicVisualRepairs } from '@/lib/server/courseware-layout-repair';

export interface RepairCoursewareSceneOptions {
  stage: Stage;
  scene: Scene;
  scenes: Scene[];
  outlines?: SceneOutline[];
  instruction: string;
  visualIssues?: VisualAuditIssue[];
  hasStructuralIssues?: boolean;
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
  const deterministic = applyDeterministicVisualRepairs(options.scene, options.visualIssues ?? []);
  const handledIssueIds = new Set(deterministic.handledIssueIds);
  const remainingVisualIssues = (options.visualIssues ?? []).filter(
    (issue) => !handledIssueIds.has(issue.id),
  );
  if (
    deterministic.scene !== options.scene &&
    remainingVisualIssues.length === 0 &&
    !options.hasStructuralIssues
  ) {
    return deterministic.scene;
  }

  const sourceScene = deterministic.scene;
  const sourceOutlines = options.outlines ?? [];
  const allOutlines = options.scenes.map((scene) => outlineForScene(scene, sourceOutlines));
  const outline = outlineForScene(sourceScene, sourceOutlines);
  const tool = makeRegenerateSceneTool({
    aiCall: options.aiCall,
    getSceneContext: (sceneId) =>
      sceneId === sourceScene.id
        ? {
            outline,
            allOutlines,
            content: sourceScene.content,
            stageId: options.stage.id,
            languageDirective: options.stage.languageDirective,
          }
        : undefined,
  });
  const result = await tool.execute(
    `courseware-guard-${sourceScene.id}`,
    { sceneId: sourceScene.id, instruction: options.instruction },
    new AbortController().signal,
  );
  const plan = planRegenerateApply(result.details, sourceScene, 'regenerate_scene');
  if (!plan.patch?.content) return sourceScene !== options.scene ? sourceScene : null;
  return { ...sourceScene, content: plan.patch.content } as Scene;
}
