import type { Scene, SceneType, QuizQuestion } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';
import type { TeacherAction, WidgetConfig } from '@/lib/types/widgets';

export type ModificationMode = 'spot' | 'scene' | 'conversation';

export type ModificationStatus =
  | 'idle'
  | 'planning'
  | 'waiting_plan_approval'
  | 'executing_preview'
  | 'previewing'
  | 'committing'
  | 'rejected'
  | 'error';

export interface ClarificationQuestion {
  question: string;
  options?: string[];
}

export interface ModificationConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface EditPlan {
  id: string;
  summary: string;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  mode?: ModificationMode;
  targetElementIds?: string[];
  operations: EditOperation[];
  clarificationQuestions?: ClarificationQuestion[];
}

export type EditOperation = SlideEditOperation | QuizEditOperation | InteractiveEditOperation;

export type SlideEditOperation =
  | {
      id?: string;
      type: 'slide.update_element';
      elementId: string;
      patch: Partial<PPTElement> & Record<string, unknown>;
      reason: string;
    }
  | {
      id?: string;
      type: 'slide.add_element';
      element: PPTElement;
      reason: string;
    }
  | {
      id?: string;
      type: 'slide.delete_element';
      elementId: string;
      reason: string;
    }
  | {
      id?: string;
      type: 'slide.move_element';
      elementId: string;
      dx: number;
      dy: number;
      reason: string;
    };

export type QuizEditOperation =
  | {
      id?: string;
      type: 'quiz.update_question';
      questionId: string;
      patch: Partial<QuizQuestion> & Record<string, unknown>;
      reason: string;
    }
  | {
      id?: string;
      type: 'quiz.add_question';
      question: QuizQuestion;
      reason: string;
    }
  | {
      id?: string;
      type: 'quiz.delete_question';
      questionId: string;
      reason: string;
    };

export type InteractiveEditOperation =
  | {
      id?: string;
      type: 'interactive.update_widget_config';
      patch: Partial<WidgetConfig> & Record<string, unknown>;
      reason: string;
    }
  | {
      id?: string;
      type: 'interactive.replace_widget_config';
      widgetConfig: WidgetConfig;
      reason: string;
    }
  | {
      id?: string;
      type: 'interactive.update_teacher_actions';
      teacherActions: TeacherAction[];
      reason: string;
    };

export interface DiffSummary {
  summary: string;
  changedItems: string[];
  changedItemIds: string[];
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedHint?: string;
  riskWarnings: string[];
}

export interface ModificationSession {
  id: string;
  stageId: string;
  sceneId: string;
  sceneType: SceneType;
  mode: ModificationMode;
  status: ModificationStatus;
  userInstruction: string;
  originalScene: Scene;
  commitBaseScene?: Scene;
  conversationHistory?: ModificationConversationTurn[];
  previewBaseScene?: Scene;
  previewScene?: Scene;
  editPlan?: EditPlan;
  diffSummary?: DiffSummary;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModificationHistoryEntry {
  id: string;
  sessionId: string;
  stageId: string;
  sceneId: string;
  instruction: string;
  planSummary: string;
  diffSummary?: DiffSummary;
  conversationHistory?: ModificationConversationTurn[];
  accepted: boolean;
  createdAt: number;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ExecuteEditPlanResult {
  success: boolean;
  previewScene?: Scene;
  diffSummary?: DiffSummary;
  appliedOperationIds: string[];
  errors: string[];
  warnings: string[];
}

export interface ModifyScenePlanRequest {
  stageId?: string;
  sceneId?: string;
  scene: Scene;
  instruction: string;
  mode?: ModificationMode;
  selectedElementIds?: string[];
  conversationHistory?: ModificationConversationTurn[];
  languageDirective?: string;
}

export interface ModifyScenePreviewRequest {
  scene: Scene;
  plan: EditPlan;
}
