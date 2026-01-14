import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, ClaudeSession, ClaudeStatus, ToolUsage } from '../types';

interface ChatState {
  sessions: Record<string, ClaudeSession>;

  // Session lifecycle
  createSession: (cardId: string, projectPath: string) => string;
  createSessionWithId: (sessionId: string, cardId: string, projectPath: string) => void;
  updateSession: (sessionId: string, updates: Partial<ClaudeSession>) => void;
  setClaudeSessionId: (sessionId: string, claudeSessionId: string) => void;
  getSessionByCardId: (cardId: string) => ClaudeSession | undefined;
  clearSession: (cardId: string) => void;

  // Messages
  addMessage: (sessionId: string, message: ChatMessage) => void;
  appendToLastMessage: (sessionId: string, text: string) => void;
  updateLastMessageStreaming: (sessionId: string, isStreaming: boolean) => void;

  // Tools
  addToolToLastMessage: (sessionId: string, tool: ToolUsage) => void;
  updateTool: (sessionId: string, toolId: string, updates: Partial<ToolUsage>) => void;

  // Status
  setStatus: (sessionId: string, status: ClaudeStatus) => void;
  setTotalCost: (sessionId: string, cost: number) => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: {},

      createSession: (cardId, projectPath) => {
        const sessionId = generateId();
        const session: ClaudeSession = {
          id: sessionId,
          cardId,
          projectPath,
          messages: [],
          status: 'idle',
          isAlive: true,
          totalCostUsd: 0,
        };

        set((state) => ({
          sessions: { ...state.sessions, [sessionId]: session },
        }));

        return sessionId;
      },

      createSessionWithId: (sessionId, cardId, projectPath) => {
        const session: ClaudeSession = {
          id: sessionId,
          cardId,
          projectPath,
          messages: [],
          status: 'running',
          isAlive: true,
          totalCostUsd: 0,
        };

        set((state) => ({
          sessions: { ...state.sessions, [sessionId]: session },
        }));
      },

      updateSession: (sessionId, updates) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, ...updates },
            },
          };
        });
      },

      setClaudeSessionId: (sessionId, claudeSessionId) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, claudeSessionId },
            },
          };
        });
      },

      getSessionByCardId: (cardId) => {
        const sessions = get().sessions;
        return Object.values(sessions).find((s) => s.cardId === cardId);
      },

      clearSession: (cardId) => {
        set((state) => {
          const newSessions = { ...state.sessions };
          for (const [id, session] of Object.entries(newSessions)) {
            if (session.cardId === cardId) {
              delete newSessions[id];
            }
          }
          return { sessions: newSessions };
        });
      },

      addMessage: (sessionId, message) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                messages: [...session.messages, message],
              },
            },
          };
        });
      },

      appendToLastMessage: (sessionId, text) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session || session.messages.length === 0) return state;

          const messages = [...session.messages];
          const lastMsg = messages[messages.length - 1];

          // Only append to assistant messages
          if (lastMsg.role !== 'assistant') {
            // Create new assistant message
            messages.push({
              id: generateId(),
              role: 'assistant',
              content: text,
              timestamp: new Date().toISOString(),
              isStreaming: true,
            });
          } else {
            messages[messages.length - 1] = {
              ...lastMsg,
              content: lastMsg.content + text,
            };
          }

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, messages },
            },
          };
        });
      },

      updateLastMessageStreaming: (sessionId, isStreaming) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session || session.messages.length === 0) return state;

          const messages = [...session.messages];
          const lastMsg = messages[messages.length - 1];
          messages[messages.length - 1] = { ...lastMsg, isStreaming };

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, messages },
            },
          };
        });
      },

      addToolToLastMessage: (sessionId, tool) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session || session.messages.length === 0) return state;

          const messages = [...session.messages];
          const lastMsg = messages[messages.length - 1];
          const tools = [...(lastMsg.tools || []), tool];
          messages[messages.length - 1] = { ...lastMsg, tools };

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, messages },
            },
          };
        });
      },

      updateTool: (sessionId, toolId, updates) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          const messages = session.messages.map((msg) => {
            if (!msg.tools) return msg;
            const tools = msg.tools.map((t) =>
              t.id === toolId ? { ...t, ...updates } : t
            );
            return { ...msg, tools };
          });

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, messages },
            },
          };
        });
      },

      setStatus: (sessionId, status) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, status },
            },
          };
        });
      },

      setTotalCost: (sessionId, cost) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                totalCostUsd: session.totalCostUsd + cost,
              },
            },
          };
        });
      },
    }),
    {
      name: 'chat-store',
      partialize: (state) => ({
        // Only persist sessions (not ephemeral state)
        sessions: state.sessions,
      }),
    }
  )
);
