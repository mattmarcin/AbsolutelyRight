import { create } from 'zustand';
import type { TerminalSession, ClaudeStatus } from '../types';

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;

  // Actions
  addSession: (cardId: string, session: TerminalSession) => void;
  removeSession: (cardId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  updateSessionStatus: (sessionId: string, status: ClaudeStatus) => void;
  getSessionByCardId: (cardId: string) => TerminalSession | undefined;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,

  addSession: (cardId, session) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(cardId, session);
      return { sessions, activeSessionId: session.id };
    }),

  removeSession: (cardId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(cardId);
      sessions.delete(cardId);
      return {
        sessions,
        activeSessionId:
          state.activeSessionId === session?.id ? null : state.activeSessionId,
      };
    }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  updateSessionStatus: (sessionId, status) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      for (const [cardId, session] of sessions) {
        if (session.id === sessionId) {
          sessions.set(cardId, { ...session, claude_status: status });
          break;
        }
      }
      return { sessions };
    }),

  getSessionByCardId: (cardId) => {
    return get().sessions.get(cardId);
  },
}));
