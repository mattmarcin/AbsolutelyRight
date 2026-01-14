import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { startClaudeSession, killClaudeSession, sendToClaudeSession } from '../../lib/tauri-commands';
import { useChatStore } from '../../stores/chatStore';
import { useCardStore } from '../../stores/cardStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { MessageGroup } from '../chat/MessageGroup';
import { ChatInput } from '../chat/ChatInput';
import { cn } from '../../lib/utils';
import type { Card, ClaudeEvent } from '../../types';
import { getToolsForMode } from '../../stores/workflowStore';
import { claimBackgroundSession, releaseToBackgroundSession } from '../../lib/backgroundSessions';

interface ExecutionPanelProps {
  card: Card;
  projectPath: string;
}

/**
 * ExecutionPanel - Full execution mode for In Progress cards.
 * Claude has access to all tools and can make changes.
 * Supports background execution with progress tracking.
 */
export function ExecutionPanel({ card, projectPath }: ExecutionPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingEventsRef = useRef<ClaudeEvent[]>([]);

  const {
    createSessionPreservingHistory,
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
  const { registerBackgroundSession, updateBackgroundSession, removeBackgroundSession } = useWorkflowStore();

  const session = getSessionByCardId(card.id);
  const turns = session ? getConversationTurns(session.id) : [];

  // Claim background session on mount, release on unmount
  useEffect(() => {
    const claimedSessionId = claimBackgroundSession(card.id);
    if (claimedSessionId) {
      sessionIdRef.current = claimedSessionId;
      console.log('[ExecutionPanel] Claimed background session:', claimedSessionId);
    } else if (session && !sessionIdRef.current) {
      sessionIdRef.current = session.id;
      console.log('[ExecutionPanel] Synced with existing session:', session.id);
    }

    return () => {
      const currentSession = getSessionByCardId(card.id);
      if (sessionIdRef.current && currentSession && ['running', 'question'].includes(currentSession.status)) {
        releaseToBackgroundSession(sessionIdRef.current, card.id);
      }
    };
  }, [card.id, session, getSessionByCardId]);

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
          updateBackgroundSession(sessionIdRef.current, { status: 'running' });
          break;

        case 'text_chunk':
          if (event.text) {
            appendToLastMessage(sessionIdRef.current, event.text);
          }
          break;

        case 'tool_start':
          if (event.tool_name && event.tool_id) {
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
            updateBackgroundSession(sessionIdRef.current, { status: event.status });
          }
          break;

        case 'session_completed':
          updateLastMessageStreaming(sessionIdRef.current, false);

          // Check if Claude is awaiting user input
          // Don't overwrite 'question' status if already set (e.g., by AskUserQuestion tool)
          const hasQuestions = event.result && event.result.includes('[AWAITING_INPUT]');
          const currentSessionStatus = useChatStore.getState().sessions[sessionIdRef.current]?.status;
          const finalStatus = (currentSessionStatus === 'question' || hasQuestions) ? 'question' : 'completed';

          setStatus(sessionIdRef.current, finalStatus);
          updateClaudeStatus(card.id, finalStatus);

          if (event.cost_usd) {
            setTotalCost(sessionIdRef.current, event.cost_usd);
          }
          removeBackgroundSession(sessionIdRef.current);
          // Auto-move to review on completion (but not if waiting for input)
          if (finalStatus !== 'question') {
            moveCard(card.id, 'review', 0);
          }
          break;

        case 'session_error':
          setStatus(sessionIdRef.current, 'error');
          updateClaudeStatus(card.id, 'error');
          updateLastMessageStreaming(sessionIdRef.current, false);
          if (event.error) {
            setError(event.error);
          }
          removeBackgroundSession(sessionIdRef.current);
          break;
      }
    },
    [card.id, appendToLastMessage, updateLastMessageStreaming, addToolToLastMessage, updateTool, setStatus, setClaudeSessionId, setTotalCost, updateClaudeStatus, updateBackgroundSession, removeBackgroundSession, moveCard]
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

  // Start execution with prompt (preserves existing message history)
  const startExecution = async (prompt: string) => {
    setIsConnecting(true);
    setError(null);

    try {
      const existingSession = getSessionByCardId(card.id);
      const resumeId = existingSession?.claudeSessionId;

      // Use execution mode tools (full access)
      const tools = getToolsForMode('execution');

      const backendSessionId = await startClaudeSession(
        card.id,
        projectPath,
        prompt,
        tools,
        resumeId
      );

      sessionIdRef.current = backendSessionId;

      // Create new session but preserve existing messages
      createSessionPreservingHistory(backendSessionId, card.id, projectPath, 'execution');

      // Register as background session
      registerBackgroundSession({
        sessionId: backendSessionId,
        cardId: card.id,
        projectPath,
        status: 'running',
        mode: 'execution',
        startedAt: new Date().toISOString(),
      });

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
      console.error('Failed to start Claude execution:', err);
      setError(String(err));
      if (sessionIdRef.current) {
        setStatus(sessionIdRef.current, 'error');
        removeBackgroundSession(sessionIdRef.current);
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
      // Otherwise start a new execution
      await startExecution(message.trim());
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
      removeBackgroundSession(sessionIdRef.current);
    }
  };

  const handleMoveToReview = () => {
    moveCard(card.id, 'review', 0);
  };

  const status = session?.status || 'idle';
  const isRunning = status === 'running';

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.8)] backdrop-blur-xl">
      {/* Header */}
      <div className="panel-header-execution flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center",
              isRunning ? "bg-amber-500/20" : "bg-green-500/20"
            )}>
              <span className="text-xs">{isRunning ? '⚡' : '🔧'}</span>
            </div>
            <span className={cn(
              "text-sm",
              isRunning ? "text-amber-400" : "text-white/60"
            )}>
              {isRunning ? 'Executing...' : 'Execution Mode'}
            </span>
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

          {isRunning && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 rounded-lg">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
              <span className="text-xs text-amber-400">Working</span>
            </div>
          )}

          {!isRunning && status !== 'idle' && (
            <button
              onClick={handleMoveToReview}
              className="px-3 py-1 text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg transition-all flex items-center gap-1"
            >
              <span>Move to Review</span>
              <span>→</span>
            </button>
          )}

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

      {/* Progress Banner */}
      {isRunning && (
        <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/10">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-amber-500/10 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500/40 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
            <span className="text-xs text-amber-300/60">Claude is working...</span>
          </div>
        </div>
      )}

      {/* Info Banner */}
      {!isRunning && status === 'idle' && (
        <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/10">
          <p className="text-xs text-amber-300/60">
            ⚡ Claude has full access to modify files, run commands, and implement your feature.
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {turns.length === 0 && !isConnecting && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/30 max-w-md">
              <div className="text-4xl mb-4">⚡</div>
              <p className="text-lg mb-2">Ready to execute</p>
              <p className="text-sm">
                Describe what you want Claude to build. It will have full access to write code, run commands, and implement features.
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
            ? 'Claude is executing...'
            : 'Describe what to build (Claude will implement it)...'
        }
      />
    </div>
  );
}
