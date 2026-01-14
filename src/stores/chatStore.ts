import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, ClaudeSession, ClaudeStatus, ToolUsage, SessionMode, ConversationTurn } from '../types';

interface ChatState {
  sessions: Record<string, ClaudeSession>;

  // Session lifecycle
  createSession: (cardId: string, projectPath: string, mode?: SessionMode) => string;
  createSessionWithId: (sessionId: string, cardId: string, projectPath: string, mode?: SessionMode) => void;
  createSessionPreservingHistory: (newSessionId: string, cardId: string, projectPath: string, mode?: SessionMode) => ChatMessage[];
  updateSession: (sessionId: string, updates: Partial<ClaudeSession>) => void;
  setClaudeSessionId: (sessionId: string, claudeSessionId: string) => void;
  getSessionByCardId: (cardId: string) => ClaudeSession | undefined;
  clearSession: (cardId: string) => void;

  // Messages
  addMessage: (sessionId: string, message: ChatMessage) => void;
  appendToLastMessage: (sessionId: string, text: string) => void;
  updateLastMessageStreaming: (sessionId: string, isStreaming: boolean) => void;

  // Conversation turns (message grouping)
  getConversationTurns: (sessionId: string) => ConversationTurn[];

  // Tools
  addToolToLastMessage: (sessionId: string, tool: ToolUsage) => void;
  updateTool: (sessionId: string, toolId: string, updates: Partial<ToolUsage>) => void;

  // Status
  setStatus: (sessionId: string, status: ClaudeStatus) => void;
  setMode: (sessionId: string, mode: SessionMode) => void;
  setTotalCost: (sessionId: string, cost: number) => void;
  updateLastActivity: (sessionId: string) => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: {},

      createSession: (cardId, projectPath, mode = 'planning') => {
        const sessionId = generateId();
        const now = new Date().toISOString();
        const session: ClaudeSession = {
          id: sessionId,
          cardId,
          projectPath,
          messages: [],
          status: 'idle',
          mode,
          isAlive: true,
          totalCostUsd: 0,
          createdAt: now,
          lastActivity: now,
        };

        set((state) => ({
          sessions: { ...state.sessions, [sessionId]: session },
        }));

        return sessionId;
      },

      createSessionWithId: (sessionId, cardId, projectPath, mode = 'execution') => {
        const now = new Date().toISOString();
        const session: ClaudeSession = {
          id: sessionId,
          cardId,
          projectPath,
          messages: [],
          status: 'running',
          mode,
          isAlive: true,
          totalCostUsd: 0,
          createdAt: now,
          lastActivity: now,
        };

        set((state) => ({
          sessions: { ...state.sessions, [sessionId]: session },
        }));
      },

      // Create a new session but preserve messages from the old session for this card
      createSessionPreservingHistory: (newSessionId, cardId, projectPath, mode = 'execution') => {
        const state = get();
        // Find existing session for this card and get its messages
        const existingSession = Object.values(state.sessions).find((s) => s.cardId === cardId);
        const existingMessages = existingSession?.messages || [];
        const existingCost = existingSession?.totalCostUsd || 0;

        const now = new Date().toISOString();
        const newSession: ClaudeSession = {
          id: newSessionId,
          cardId,
          projectPath,
          messages: existingMessages, // Preserve existing messages
          status: 'running',
          mode,
          isAlive: true,
          totalCostUsd: existingCost, // Preserve cost too
          createdAt: existingSession?.createdAt || now,
          lastActivity: now,
        };

        // Remove old session(s) for this card and add new one
        const newSessions = { ...state.sessions };
        for (const [id, session] of Object.entries(newSessions)) {
          if (session.cardId === cardId) {
            delete newSessions[id];
          }
        }
        newSessions[newSessionId] = newSession;

        set({ sessions: newSessions });

        return existingMessages;
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

      setMode: (sessionId, mode) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, mode },
            },
          };
        });
      },

      updateLastActivity: (sessionId) => {
        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...session, lastActivity: new Date().toISOString() },
            },
          };
        });
      },

      getConversationTurns: (sessionId) => {
        const session = get().sessions[sessionId];
        if (!session) return [];

        const turns: ConversationTurn[] = [];
        let currentTurn: ConversationTurn | null = null;

        for (const msg of session.messages) {
          if (msg.role === 'user') {
            // Start a new turn with user message
            if (currentTurn) {
              turns.push(currentTurn);
            }
            currentTurn = {
              id: msg.id,
              userMessage: msg,
              assistantMessages: [],
              tools: [],
              timestamp: msg.timestamp,
              isActive: false,
            };
          } else if (msg.role === 'assistant') {
            if (!currentTurn) {
              // Assistant message without user message (e.g., system prompt response)
              currentTurn = {
                id: msg.id,
                userMessage: null,
                assistantMessages: [msg],
                tools: msg.tools ? [...msg.tools] : [],
                timestamp: msg.timestamp,
                isActive: msg.isStreaming || false,
              };
            } else {
              currentTurn.assistantMessages.push(msg);
              if (msg.tools) {
                currentTurn.tools.push(...msg.tools);
              }
              currentTurn.isActive = msg.isStreaming || false;
            }
          }
        }

        // Don't forget the last turn
        if (currentTurn) {
          turns.push(currentTurn);
        }

        return turns;
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
