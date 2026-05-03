import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { createSelectors } from '@/lib/utils/create-selectors';
import type {
  DiffSummary,
  EditPlan,
  ModificationConversationTurn,
  ModificationHistoryEntry,
  ModificationMode,
  ModificationSession,
  ModificationStatus,
} from '@/lib/types/modification';
import type { Scene } from '@/lib/types/stage';

interface StartSessionParams {
  stageId: string;
  scene: Scene;
  instruction: string;
  mode?: ModificationMode;
  commitBaseScene?: Scene;
  conversationHistory?: ModificationConversationTurn[];
}

interface ModificationState {
  activeSceneId: string | null;
  sessionsBySceneId: Record<string, ModificationSession>;
  history: ModificationHistoryEntry[];
  isPanelOpen: boolean;
  previewMode: 'split' | 'overlay';

  setActiveScene: (sceneId: string | null) => void;
  getActiveSession: () => ModificationSession | null;
  getSessionForScene: (sceneId: string | null | undefined) => ModificationSession | null;
  openPanel: (sceneId?: string | null) => void;
  closePanel: () => void;
  setPreviewMode: (mode: 'split' | 'overlay') => void;
  startSession: (params: StartSessionParams) => string;
  setStatus: (status: ModificationStatus) => void;
  setPlan: (plan: EditPlan) => void;
  setPreview: (previewScene: Scene, diffSummary: DiffSummary, previewBaseScene?: Scene) => void;
  setError: (error: string) => void;
  markAccepted: () => void;
  rejectActiveSession: () => void;
  clearActiveSession: () => void;
  clearHistory: () => void;
}

function cloneScene(scene: Scene): Scene {
  return JSON.parse(JSON.stringify(scene)) as Scene;
}

function now() {
  return Date.now();
}

function cloneConversationHistory(
  history: ModificationConversationTurn[] | undefined,
): ModificationConversationTurn[] | undefined {
  return history?.map((turn) => ({ ...turn }));
}

function appendConversationTurn(
  history: ModificationConversationTurn[] | undefined,
  turn: ModificationConversationTurn,
): ModificationConversationTurn[] {
  const previous = history ?? [];
  const last = previous.at(-1);
  if (last?.role === turn.role && last.content === turn.content) return previous;
  return [...previous, turn].slice(-20);
}

function summarizePreviewTurn(session: ModificationSession, diffSummary: DiffSummary): string {
  const changedItems = diffSummary.changedItems.length
    ? diffSummary.changedItems.map((item) => `- ${item}`).join('\n')
    : '- No detected changes';
  return `Plan: ${session.editPlan?.summary ?? 'No plan summary'}\nPreview diff:\n${changedItems}`;
}

function appendHistory(
  history: ModificationHistoryEntry[],
  session: ModificationSession,
  accepted: boolean,
): ModificationHistoryEntry[] {
  const entry: ModificationHistoryEntry = {
    id: nanoid(),
    sessionId: session.id,
    stageId: session.stageId,
    sceneId: session.sceneId,
    instruction: session.userInstruction,
    planSummary: session.editPlan?.summary ?? '',
    diffSummary: session.diffSummary,
    conversationHistory: cloneConversationHistory(session.conversationHistory),
    accepted,
    createdAt: now(),
  };

  return [entry, ...history].slice(0, 50);
}

function withoutSession(sessionsBySceneId: Record<string, ModificationSession>, sceneId: string) {
  const { [sceneId]: _removed, ...rest } = sessionsBySceneId;
  return rest;
}

const useModificationStoreBase = create<ModificationState>()((set, get) => ({
  activeSceneId: null,
  sessionsBySceneId: {},
  history: [],
  isPanelOpen: false,
  previewMode: 'split',

  setActiveScene: (activeSceneId) => set({ activeSceneId }),
  getActiveSession: () => {
    const sceneId = get().activeSceneId;
    return sceneId ? (get().sessionsBySceneId[sceneId] ?? null) : null;
  },
  getSessionForScene: (sceneId) => (sceneId ? (get().sessionsBySceneId[sceneId] ?? null) : null),
  openPanel: (sceneId) =>
    set((state) => ({ isPanelOpen: true, activeSceneId: sceneId ?? state.activeSceneId })),
  closePanel: () => set({ isPanelOpen: false }),
  setPreviewMode: (previewMode) => set({ previewMode }),

  startSession: ({
    stageId,
    scene,
    instruction,
    mode = 'scene',
    commitBaseScene,
    conversationHistory,
  }) => {
    const timestamp = now();
    const sessionId = nanoid();
    const session: ModificationSession = {
      id: sessionId,
      stageId,
      sceneId: scene.id,
      sceneType: scene.type,
      mode,
      status: 'planning',
      userInstruction: instruction,
      originalScene: cloneScene(scene),
      commitBaseScene: cloneScene(commitBaseScene ?? scene),
      conversationHistory: cloneConversationHistory(conversationHistory),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    set((state) => ({
      isPanelOpen: true,
      activeSceneId: scene.id,
      sessionsBySceneId: {
        ...state.sessionsBySceneId,
        [scene.id]: session,
      },
    }));
    return sessionId;
  },

  setStatus: (status) => {
    const session = get().getActiveSession();
    if (!session) return;
    set((state) => ({
      sessionsBySceneId: {
        ...state.sessionsBySceneId,
        [session.sceneId]: { ...session, status, updatedAt: now() },
      },
    }));
  },

  setPlan: (editPlan) => {
    const session = get().getActiveSession();
    if (!session) return;
    set((state) => ({
      sessionsBySceneId: {
        ...state.sessionsBySceneId,
        [session.sceneId]: {
          ...session,
          editPlan,
          status: 'waiting_plan_approval',
          updatedAt: now(),
        },
      },
    }));
  },

  setPreview: (previewScene, diffSummary, previewBaseScene) => {
    const session = get().getActiveSession();
    if (!session) return;
    const conversationHistory = appendConversationTurn(session.conversationHistory, {
      role: 'assistant',
      content: summarizePreviewTurn(session, diffSummary),
      createdAt: now(),
    });

    set((state) => ({
      sessionsBySceneId: {
        ...state.sessionsBySceneId,
        [session.sceneId]: {
          ...session,
          previewBaseScene: previewBaseScene ? cloneScene(previewBaseScene) : session.originalScene,
          previewScene: cloneScene(previewScene),
          diffSummary,
          conversationHistory,
          status: 'previewing',
          updatedAt: now(),
        },
      },
    }));
  },

  setError: (error) => {
    const session = get().getActiveSession();
    if (!session) return;
    set((state) => ({
      sessionsBySceneId: {
        ...state.sessionsBySceneId,
        [session.sceneId]: { ...session, status: 'error', error, updatedAt: now() },
      },
    }));
  },

  markAccepted: () => {
    const session = get().getActiveSession();
    if (!session) return;
    set((state) => ({
      history: appendHistory(state.history, { ...session, status: 'committing' }, true),
      sessionsBySceneId: withoutSession(state.sessionsBySceneId, session.sceneId),
    }));
  },

  rejectActiveSession: () => {
    const session = get().getActiveSession();
    if (!session) return;
    set((state) => ({
      history: appendHistory(state.history, { ...session, status: 'rejected' }, false),
      sessionsBySceneId: {
        ...state.sessionsBySceneId,
        [session.sceneId]: {
          ...session,
          status: 'rejected',
          editPlan: undefined,
          previewBaseScene: undefined,
          previewScene: undefined,
          diffSummary: undefined,
          error: undefined,
          updatedAt: now(),
        },
      },
    }));
  },

  clearActiveSession: () => {
    const session = get().getActiveSession();
    if (!session) return;
    set((state) => ({
      sessionsBySceneId: withoutSession(state.sessionsBySceneId, session.sceneId),
    }));
  },
  clearHistory: () => set({ history: [] }),
}));

export const useModificationStore = createSelectors(useModificationStoreBase);
