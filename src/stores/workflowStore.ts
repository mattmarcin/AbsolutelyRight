import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  CardStatus,
  CardWorkflowState,
  CardTransitionEvent,
  TransitionGuard,
  CardInteractionMode,
  BackgroundSession,
  SessionMode,
} from '../types';
import { STATUS_TO_INTERACTION_MODE, STATUS_TO_SESSION_MODE } from '../types';

interface WorkflowState {
  // Card workflow states
  cardWorkflowStates: Record<string, CardWorkflowState>;

  // Transition history for debugging/audit
  transitionHistory: CardTransitionEvent[];

  // Background sessions
  backgroundSessions: Record<string, BackgroundSession>;

  // State queries
  getWorkflowState: (cardId: string) => CardWorkflowState | undefined;
  getInteractionMode: (cardId: string, status: CardStatus) => CardInteractionMode;
  canTransition: (cardId: string, fromStatus: CardStatus, toStatus: CardStatus) => TransitionGuard;

  // Workflow state management
  initializeWorkflowState: (cardId: string, status: CardStatus) => void;
  updateWorkflowState: (cardId: string, updates: Partial<CardWorkflowState>) => void;

  // Transition actions
  handlePreTransition: (cardId: string, fromStatus: CardStatus, toStatus: CardStatus) => Promise<TransitionActions>;
  handlePostTransition: (cardId: string, fromStatus: CardStatus, toStatus: CardStatus) => void;
  recordTransition: (event: CardTransitionEvent) => void;

  // Background session management
  registerBackgroundSession: (session: BackgroundSession) => void;
  updateBackgroundSession: (sessionId: string, updates: Partial<BackgroundSession>) => void;
  removeBackgroundSession: (sessionId: string) => void;
  getBackgroundSessionByCardId: (cardId: string) => BackgroundSession | undefined;

  // Review state
  setReviewHighlighted: (cardId: string, highlighted: boolean) => void;
  clearReviewHighlight: (cardId: string) => void;
}

/** Actions that should be taken after a transition */
export interface TransitionActions {
  shouldStartExecution: boolean;
  shouldStopExecution: boolean;
  shouldHighlightForReview: boolean;
  sessionMode: SessionMode;
  existingSessionId?: string;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      cardWorkflowStates: {},
      transitionHistory: [],
      backgroundSessions: {},

      getWorkflowState: (cardId) => {
        return get().cardWorkflowStates[cardId];
      },

      getInteractionMode: (cardId, status) => {
        const workflowState = get().cardWorkflowStates[cardId];
        if (workflowState) {
          return workflowState.interactionMode;
        }
        return STATUS_TO_INTERACTION_MODE[status];
      },

      canTransition: (cardId, fromStatus, toStatus) => {
        const workflowState = get().cardWorkflowStates[cardId];

        // Check if there's an active execution that would be interrupted
        if (fromStatus === 'in_progress' && workflowState?.isBackgroundRunning) {
          if (toStatus === 'backlog' || toStatus === 'todo') {
            return {
              canTransition: true,
              requiresConfirmation: true,
              confirmationMessage: 'Claude is currently working on this task. Moving it will stop the execution. Continue?',
            };
          }
        }

        // Skipping from backlog/todo directly to done should warn
        if ((fromStatus === 'backlog' || fromStatus === 'todo') && toStatus === 'done') {
          return {
            canTransition: true,
            requiresConfirmation: true,
            confirmationMessage: 'This task has not been worked on yet. Are you sure you want to mark it as done?',
          };
        }

        return { canTransition: true };
      },

      initializeWorkflowState: (cardId, status) => {
        const interactionMode = STATUS_TO_INTERACTION_MODE[status];

        set((state) => ({
          cardWorkflowStates: {
            ...state.cardWorkflowStates,
            [cardId]: {
              cardId,
              interactionMode,
              reviewHighlighted: status === 'review',
              isBackgroundRunning: false,
            },
          },
        }));
      },

      updateWorkflowState: (cardId, updates) => {
        set((state) => {
          const existing = state.cardWorkflowStates[cardId];
          if (!existing) return state;

          return {
            cardWorkflowStates: {
              ...state.cardWorkflowStates,
              [cardId]: { ...existing, ...updates },
            },
          };
        });
      },

      handlePreTransition: async (cardId, fromStatus, toStatus) => {
        const workflowState = get().cardWorkflowStates[cardId];
        const sessionMode = STATUS_TO_SESSION_MODE[toStatus];

        const actions: TransitionActions = {
          shouldStartExecution: false,
          shouldStopExecution: false,
          shouldHighlightForReview: false,
          sessionMode,
          existingSessionId: workflowState?.executionSessionId,
        };

        // Determine what actions need to happen

        // Moving TO in_progress -> start execution
        if (toStatus === 'in_progress') {
          actions.shouldStartExecution = true;
        }

        // Moving FROM in_progress -> stop execution
        if (fromStatus === 'in_progress' && toStatus !== 'in_progress') {
          actions.shouldStopExecution = true;
        }

        // Moving TO review -> highlight for attention
        if (toStatus === 'review') {
          actions.shouldHighlightForReview = true;
        }

        return actions;
      },

      handlePostTransition: (cardId, _fromStatus, toStatus) => {
        const newInteractionMode = STATUS_TO_INTERACTION_MODE[toStatus];

        set((state) => {
          const existing = state.cardWorkflowStates[cardId] || {
            cardId,
            interactionMode: newInteractionMode,
            reviewHighlighted: false,
            isBackgroundRunning: false,
          };

          return {
            cardWorkflowStates: {
              ...state.cardWorkflowStates,
              [cardId]: {
                ...existing,
                interactionMode: newInteractionMode,
                reviewHighlighted: toStatus === 'review',
                // Clear execution session if moving away from in_progress
                executionSessionId: toStatus === 'in_progress'
                  ? existing.executionSessionId
                  : undefined,
                isBackgroundRunning: toStatus === 'in_progress'
                  ? existing.isBackgroundRunning
                  : false,
              },
            },
          };
        });
      },

      recordTransition: (event) => {
        set((state) => ({
          transitionHistory: [...state.transitionHistory.slice(-99), event], // Keep last 100
        }));
      },

      // Background session management
      registerBackgroundSession: (session) => {
        set((state) => ({
          backgroundSessions: {
            ...state.backgroundSessions,
            [session.sessionId]: session,
          },
        }));

        // Also update the card's workflow state
        get().updateWorkflowState(session.cardId, {
          executionSessionId: session.sessionId,
          isBackgroundRunning: true,
        });
      },

      updateBackgroundSession: (sessionId, updates) => {
        set((state) => {
          const existing = state.backgroundSessions[sessionId];
          if (!existing) return state;

          return {
            backgroundSessions: {
              ...state.backgroundSessions,
              [sessionId]: { ...existing, ...updates },
            },
          };
        });
      },

      removeBackgroundSession: (sessionId) => {
        const session = get().backgroundSessions[sessionId];

        set((state) => {
          const { [sessionId]: _, ...rest } = state.backgroundSessions;
          return { backgroundSessions: rest };
        });

        // Update the card's workflow state
        if (session) {
          get().updateWorkflowState(session.cardId, {
            isBackgroundRunning: false,
          });
        }
      },

      getBackgroundSessionByCardId: (cardId) => {
        const sessions = get().backgroundSessions;
        return Object.values(sessions).find((s) => s.cardId === cardId);
      },

      // Review state
      setReviewHighlighted: (cardId, highlighted) => {
        get().updateWorkflowState(cardId, { reviewHighlighted: highlighted });
      },

      clearReviewHighlight: (cardId) => {
        get().updateWorkflowState(cardId, { reviewHighlighted: false });
      },
    }),
    {
      name: 'workflow-store',
      partialize: (state) => ({
        cardWorkflowStates: state.cardWorkflowStates,
        backgroundSessions: state.backgroundSessions,
        // Don't persist transition history
      }),
    }
  )
);

/** Tool sets for each session mode */
export const SESSION_MODE_TOOLS: Record<SessionMode, string[]> = {
  planning: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoRead', 'Task', 'UpdateCard'],
  execution: [
    'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash',
    'TodoRead', 'TodoWrite', 'Task', 'WebSearch', 'WebFetch',
  ],
  review: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'TodoRead', 'TodoWrite', 'WebSearch', 'WebFetch', 'UpdateCard'],
};

/** Get tools allowed for a session mode */
export function getToolsForMode(mode: SessionMode): string[] {
  return SESSION_MODE_TOOLS[mode];
}
