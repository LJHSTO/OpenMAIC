import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { createSelectors } from '@/lib/utils/create-selectors';
import type {
  DiffSummary,
  EditPlan,
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
}

interface ModificationState {
  activeSession: ModificationSession | null;
  history: ModificationHistoryEntry[];
  isPanelOpen: boolean;
  previewMode: 'split' | 'overlay';

  openPanel: () => void;
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
    accepted,
    createdAt: now(),
  };

  return [entry, ...history].slice(0, 50);
}

const useModificationStoreBase = create<ModificationState>()((set, get) => ({
  activeSession: null,
  history: [],
  isPanelOpen: false,
  previewMode: 'split',

  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),
  setPreviewMode: (previewMode) => set({ previewMode }),

  startSession: ({ stageId, scene, instruction, mode = 'scene' }) => {
    const timestamp = now();
    const sessionId = nanoid();
    set({
      isPanelOpen: true,
      activeSession: {
        id: sessionId,
        stageId,
        sceneId: scene.id,
        sceneType: scene.type,
        mode,
        status: 'planning',
        userInstruction: instruction,
        originalScene: cloneScene(scene),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
    return sessionId;
  },

  setStatus: (status) => {
    const session = get().activeSession;
    if (!session) return;
    set({ activeSession: { ...session, status, updatedAt: now() } });
  },

  setPlan: (editPlan) => {
    const session = get().activeSession;
    if (!session) return;
    set({
      activeSession: {
        ...session,
        editPlan,
        status: 'waiting_plan_approval',
        updatedAt: now(),
      },
    });
  },

  setPreview: (previewScene, diffSummary, previewBaseScene) => {
    const session = get().activeSession;
    if (!session) return;
    set({
      activeSession: {
        ...session,
        previewBaseScene: previewBaseScene ? cloneScene(previewBaseScene) : session.originalScene,
        previewScene: cloneScene(previewScene),
        diffSummary,
        status: 'previewing',
        updatedAt: now(),
      },
    });
  },

  setError: (error) => {
    const session = get().activeSession;
    if (!session) return;
    set({ activeSession: { ...session, status: 'error', error, updatedAt: now() } });
  },

  markAccepted: () => {
    const session = get().activeSession;
    if (!session) return;
    set({
      history: appendHistory(get().history, { ...session, status: 'committing' }, true),
      activeSession: null,
    });
  },

  rejectActiveSession: () => {
    const session = get().activeSession;
    if (!session) return;
    set({
      history: appendHistory(get().history, { ...session, status: 'rejected' }, false),
      activeSession: null,
    });
  },

  clearActiveSession: () => set({ activeSession: null }),
  clearHistory: () => set({ history: [] }),
}));

export const useModificationStore = createSelectors(useModificationStoreBase);
