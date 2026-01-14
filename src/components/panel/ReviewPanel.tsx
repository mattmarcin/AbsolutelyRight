import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { startClaudeSession, killClaudeSession, sendToClaudeSession } from '../../lib/tauri-commands';
import { useChatStore } from '../../stores/chatStore';
import { useCardStore } from '../../stores/cardStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { MessageGroup } from '../chat/MessageGroup';
import { ChatInput } from '../chat/ChatInput';
// cn import removed - not currently used
import type { Card, ClaudeEvent } from '../../types';
import { getToolsForMode } from '../../stores/workflowStore';
import { claimBackgroundSession, releaseToBackgroundSession } from '../../lib/backgroundSessions';

interface ReviewPanelProps {
  card: Card;
  projectPath: string;
}

/**
 * ReviewPanel - Review mode for completed work.
 * Shows execution summary and allows chat for iterations.
 * Can request changes that Claude will implement.
 */
export function ReviewPanel({ card, projectPath }: ReviewPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingEventsRef = useRef<ClaudeEvent[]>([]);

  const {
    createSessionWithId,
    getSessionByCardId,
    addMessage,
    appendToLastMessage,
    updateLastMessageStreaming,
    addToolToLastMessage,
    updateTool,
    setStatus,
    setClaudeSessionId,
    setTotalCost,
    getConversationTurns,
  } = useChatStore();

  const { updateClaudeStatus, moveCard } = useCardStore();
  const { clearReviewHighlight } = useWorkflowStore();

  const session = getSessionByCardId(card.id);
  const turns = session ? getConversationTurns(session.id) : [];

  // Claim background session on mount, release on unmount
  useEffect(() => {
    const claimedSessionId = claimBackgroundSession(card.id);
    if (claimedSessionId) {
      sessionIdRef.current = claimedSessionId;
      console.log('[ReviewPanel] Claimed background session:', claimedSessionId);
    } else if (session && !sessionIdRef.current) {
      sessionIdRef.current = session.id;
      console.log('[ReviewPanel] Synced with existing session:', session.id);
    }

    return () => {
      const currentSession = getSessionByCardId(card.id);
      if (sessionIdRef.current && currentSession && ['running', 'question'].includes(currentSession.status)) {
        releaseToBackgroundSession(sessionIdRef.current, card.id);
      }
    };
  }, [card.id, session, getSessionByCardId]);

  // Clear review highlight when panel is opened
  useEffect(() => {
    clearReviewHighlight(card.id);
  }, [card.id, clearReviewHighlight]);

  // Scroll to bottom on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // Handle Claude events
  const handleClaudeEvent = useCallback(
    (event: ClaudeEvent) => {
      if (!sessionIdRef.current) {
        pendingEventsRef.current.push(event);
        return;
      }

      if (event.session_id !== sessionIdRef.current) {
        return;
      }

      switch (event.type) {
        case 'session_started':
          if (event.claude_session_id) {
            setClaudeSessionId(sessionIdRef.current, event.claude_session_id);
          }
          setStatus(sessionIdRef.current, 'running');
          updateClaudeStatus(card.id, 'running');
          break;

        case 'text_chunk':
          if (event.text) {
            appendToLastMessage(sessionIdRef.current, event.text);
          }
          break;

        case 'tool_start':
          if (event.tool_name && event.tool_id) {
            // Detect when Claude is asking a question
            if (event.tool_name === 'AskUserQuestion') {
              setStatus(sessionIdRef.current, 'question');
              updateClaudeStatus(card.id, 'question');
            }

            addToolToLastMessage(sessionIdRef.current, {
              id: event.tool_id,
              name: event.tool_name,
              input: event.tool_input || {},
              status: 'running',
              startedAt: new Date().toISOString(),
            });
          }
          break;

        case 'tool_end':
          if (event.tool_id) {
            updateTool(sessionIdRef.current, event.tool_id, {
              status: event.success ? 'completed' : 'error',
              output: event.output,
              completedAt: new Date().toISOString(),
            });
          }
          break;

        case 'status_changed':
          if (event.status) {
            setStatus(sessionIdRef.current, event.status);
            updateClaudeStatus(card.id, event.status);
          }
          break;

        case 'session_completed':
          updateLastMessageStreaming(sessionIdRef.current, false);

          // Check if Claude is awaiting user input
          const hasQuestions = event.result && event.result.includes('[AWAITING_INPUT]');
          const finalStatus = hasQuestions ? 'question' : 'completed';

          setStatus(sessionIdRef.current, finalStatus);
          updateClaudeStatus(card.id, finalStatus);

          if (event.cost_usd) {
            setTotalCost(sessionIdRef.current, event.cost_usd);
          }
          break;

        case 'session_error':
          setStatus(sessionIdRef.current, 'error');
          updateClaudeStatus(card.id, 'error');
          updateLastMessageStreaming(sessionIdRef.current, false);
          if (event.error) {
            setError(event.error);
          }
          break;
      }
    },
    [card.id, appendToLastMessage, updateLastMessageStreaming, addToolToLastMessage, updateTool, setStatus, setClaudeSessionId, setTotalCost, updateClaudeStatus]
  );

  // Set up event listener
  useEffect(() => {
    const unlisten = listen<ClaudeEvent>('claude-event', (event) => {
      handleClaudeEvent(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleClaudeEvent]);

  // Start review session with prompt
  const startReviewSession = async (prompt: string) => {
    setIsConnecting(true);
    setError(null);

    try {
      const existingSession = getSessionByCardId(card.id);
      const resumeId = existingSession?.claudeSessionId;

      // Use review mode tools (can read and make minor edits)
      const tools = getToolsForMode('review');

      const backendSessionId = await startClaudeSession(
        card.id,
        projectPath,
        prompt,
        tools,
        resumeId
      );

      sessionIdRef.current = backendSessionId;

      // Only create new session if we don't have one
      if (!existingSession) {
        createSessionWithId(backendSessionId, card.id, projectPath, 'review');
      }

      addMessage(backendSessionId, {
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      });

      addMessage(backendSessionId, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      });

      setStatus(backendSessionId, 'running');
      updateClaudeStatus(card.id, 'running');

      // Process pending events
      const pending = pendingEventsRef.current.filter(
        (e) => e.session_id === backendSessionId
      );
      pendingEventsRef.current = [];
      for (const event of pending) {
        handleClaudeEvent(event);
      }
    } catch (err) {
      console.error('Failed to start review session:', err);
      setError(String(err));
      if (sessionIdRef.current) {
        setStatus(sessionIdRef.current, 'error');
      }
      updateClaudeStatus(card.id, 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  // Send a follow-up message to an existing running session
  const sendFollowUp = async (message: string) => {
    if (!sessionIdRef.current) return;

    try {
      // Add user message to UI
      addMessage(sessionIdRef.current, {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      });

      // Add placeholder assistant message for streaming response
      addMessage(sessionIdRef.current, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      });

      // Send to Claude via stdin
      await sendToClaudeSession(sessionIdRef.current, message);
    } catch (err) {
      console.error('Failed to send follow-up message:', err);
      setError(String(err));
    }
  };

  const handleSend = async (message: string) => {
    if (!message.trim()) return;

    const currentStatus = session?.status || 'idle';

    // If session is running, send as follow-up message
    if (currentStatus === 'running' && sessionIdRef.current) {
      await sendFollowUp(message.trim());
    } else {
      // Otherwise start a new review session
      await startReviewSession(message.trim());
    }
  };

  const handleKill = async () => {
    if (sessionIdRef.current) {
      try {
        await killClaudeSession(sessionIdRef.current);
      } catch {
        // Ignore
      }
      setStatus(sessionIdRef.current, 'idle');
      updateClaudeStatus(card.id, 'idle');
    }
  };

  const handleMarkDone = () => {
    moveCard(card.id, 'done', 0);
  };

  const handleBackToProgress = () => {
    moveCard(card.id, 'in_progress', 0);
  };

  const status = session?.status || 'idle';
  const isRunning = status === 'running';

  // Calculate summary stats from turns
  const totalTools = turns.reduce((sum, t) => sum + t.tools.length, 0);
  const completedTools = turns.reduce(
    (sum, t) => sum + t.tools.filter((tool) => tool.status === 'completed').length,
    0
  );

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.8)] backdrop-blur-xl">
      {/* Header */}
      <div className="panel-header-review flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center">
              <span className="text-xs">👀</span>
            </div>
            <span className="text-sm text-purple-400">Review Mode</span>
          </div>
          <span className="text-xs text-white/30">|</span>
          <span className="text-sm text-white/80">{card.title}</span>
        </div>

        <div className="flex items-center gap-2">
          {session?.totalCostUsd ? (
            <span className="text-xs text-white/30 mr-2">
              ${session.totalCostUsd.toFixed(4)}
            </span>
          ) : null}

          <button
            onClick={handleBackToProgress}
            className="px-3 py-1 text-xs text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-all"
          >
            ← Back to Work
          </button>

          <button
            onClick={handleMarkDone}
            className="px-3 py-1 text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg transition-all flex items-center gap-1"
          >
            <span>✓</span>
            <span>Mark Done</span>
          </button>

          {isRunning && (
            <button
              onClick={handleKill}
              className="px-3 py-1 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Summary Banner */}
      <div className="px-4 py-3 bg-purple-500/5 border-b border-purple-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-white/80">{turns.length}</div>
              <div className="text-xs text-white/40">Turns</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-center">
              <div className="text-lg font-semibold text-white/80">{completedTools}/{totalTools}</div>
              <div className="text-xs text-white/40">Tools</div>
            </div>
            {session?.totalCostUsd ? (
              <>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <div className="text-lg font-semibold text-white/80">
                    ${session.totalCostUsd.toFixed(2)}
                  </div>
                  <div className="text-xs text-white/40">Cost</div>
                </div>
              </>
            ) : null}
          </div>
          <p className="text-xs text-purple-300/60">
            👀 Review the work and request changes if needed
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {turns.length === 0 && !isConnecting && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/30 max-w-md">
              <div className="text-4xl mb-4">👀</div>
              <p className="text-lg mb-2">Ready for review</p>
              <p className="text-sm">
                Claude completed the task. Review the changes and either mark it done or request modifications.
              </p>
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <MessageGroup key={turn.id} turn={turn} turnNumber={index + 1} />
        ))}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isRunning || isConnecting}
        placeholder={
          isRunning
            ? 'Claude is working on your feedback...'
            : 'Request changes or ask questions about the implementation...'
        }
      />
    </div>
  );
}
