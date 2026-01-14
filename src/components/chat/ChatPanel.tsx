import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { startClaudeSession, killClaudeSession } from '../../lib/tauri-commands';
import { useChatStore } from '../../stores/chatStore';
import { useCardStore } from '../../stores/cardStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { cn } from '../../lib/utils';
import type { Card, ClaudeEvent, ClaudeStatus } from '../../types';

interface ChatPanelProps {
  card: Card;
  projectPath: string;
}

export function ChatPanel({ card, projectPath }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const {
    createSessionWithId,
    getSessionByCardId,
    clearSession,
    addMessage,
    appendToLastMessage,
    updateLastMessageStreaming,
    addToolToLastMessage,
    updateTool,
    setStatus,
    setClaudeSessionId,
    setTotalCost,
  } = useChatStore();

  const { updateClaudeStatus } = useCardStore();

  const session = getSessionByCardId(card.id);
  const messages = session?.messages || [];

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Store for pending events that arrive before session is set up
  const pendingEventsRef = useRef<ClaudeEvent[]>([]);

  // Handle Claude events
  const handleClaudeEvent = useCallback(
    (event: ClaudeEvent) => {
      console.log('[ChatPanel] handleClaudeEvent:', event.type, 'sessionIdRef:', sessionIdRef.current, 'event.session_id:', event.session_id);

      // If session isn't set yet, queue the event
      if (!sessionIdRef.current) {
        console.log('[ChatPanel] Queuing event (no session yet):', event.type);
        pendingEventsRef.current.push(event);
        return;
      }

      if (event.session_id !== sessionIdRef.current) {
        console.log('[ChatPanel] Ignoring event (session mismatch)');
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
            addToolToLastMessage(sessionIdRef.current, {
              id: event.tool_id,
              name: event.tool_name,
              input: event.tool_input || {},
              status: 'running',
              startedAt: new Date().toISOString(),
            });
          }
          setStatus(sessionIdRef.current, 'running');
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
          setStatus(sessionIdRef.current, 'completed');
          updateClaudeStatus(card.id, 'completed');
          updateLastMessageStreaming(sessionIdRef.current, false);
          if (event.cost_usd) {
            setTotalCost(sessionIdRef.current, event.cost_usd);
          }
          break;

        case 'session_error':
          setStatus(sessionIdRef.current, 'error');
          updateClaudeStatus(card.id, 'error');
          if (event.error) {
            setError(event.error);
          }
          break;
      }
    },
    [
      card.id,
      appendToLastMessage,
      updateLastMessageStreaming,
      addToolToLastMessage,
      updateTool,
      setStatus,
      setClaudeSessionId,
      setTotalCost,
      updateClaudeStatus,
    ]
  );

  // Set up event listener
  useEffect(() => {
    console.log('[ChatPanel] Setting up claude-event listener');
    const unlisten = listen<ClaudeEvent>('claude-event', (event) => {
      console.log('[ChatPanel] Received event:', event.payload.type, 'session:', event.payload.session_id, 'expected:', sessionIdRef.current);
      handleClaudeEvent(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleClaudeEvent]);

  // Start session with prompt
  const startSession = async (prompt: string) => {
    console.log('[ChatPanel] startSession called with prompt:', prompt.substring(0, 50) + '...');
    setIsConnecting(true);
    setError(null);

    try {
      // Get existing Claude session ID for resume (before clearing)
      const existingSession = getSessionByCardId(card.id);
      const resumeId = existingSession?.claudeSessionId;
      console.log('[ChatPanel] Existing session:', existingSession?.id, 'resumeId:', resumeId);

      // Clear any existing session for this card
      clearSession(card.id);

      // Start backend session FIRST to get the real session ID
      const backendSessionId = await startClaudeSession(
        card.id,
        projectPath,
        prompt,
        ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'TodoRead', 'TodoWrite'], // Auto-approve common development tools
        resumeId
      );

      // Use the backend session ID for our local session
      sessionIdRef.current = backendSessionId;

      // Create local session with the same ID as backend
      createSessionWithId(backendSessionId, card.id, projectPath);

      // Add user message
      addMessage(backendSessionId, {
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      });

      // Add placeholder assistant message for streaming
      addMessage(backendSessionId, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      });

      setStatus(backendSessionId, 'running');
      updateClaudeStatus(card.id, 'running');

      // Process any pending events that arrived during setup
      console.log('[ChatPanel] Processing', pendingEventsRef.current.length, 'pending events');
      const pending = pendingEventsRef.current.filter(e => e.session_id === backendSessionId);
      pendingEventsRef.current = [];
      for (const event of pending) {
        console.log('[ChatPanel] Processing queued event:', event.type);
        handleClaudeEvent(event);
      }
    } catch (err) {
      console.error('Failed to start Claude session:', err);
      setError(String(err));
      if (sessionIdRef.current) {
        setStatus(sessionIdRef.current, 'error');
      }
      updateClaudeStatus(card.id, 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle sending a new message
  const handleSend = async (message: string) => {
    if (!message.trim()) return;
    await startSession(message.trim());
  };

  // Handle kill session
  const handleKill = async () => {
    if (sessionIdRef.current) {
      try {
        await killClaudeSession(sessionIdRef.current);
      } catch {
        // Ignore errors
      }
      setStatus(sessionIdRef.current, 'idle');
      updateClaudeStatus(card.id, 'idle');
    }
  };

  // Handle restart
  const handleRestart = async () => {
    await handleKill();
    if (card.prompt) {
      await startSession(card.prompt);
    }
  };

  // Auto-start with card prompt
  useEffect(() => {
    console.log('[ChatPanel] Auto-start check:', {
      cardId: card.id,
      hasPrompt: !!card.prompt,
      messagesLength: messages.length,
      isConnecting,
      sessionId: sessionIdRef.current
    });
    if (card.prompt && messages.length === 0 && !isConnecting) {
      console.log('[ChatPanel] Auto-starting session with prompt:', card.prompt.substring(0, 50) + '...');
      startSession(card.prompt);
    }
  }, [card.id]); // Only on card change

  const status = session?.status || 'idle';

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.8)] backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full',
                status === 'running' && 'bg-blue-500 animate-pulse',
                status === 'completed' && 'bg-green-500',
                status === 'error' && 'bg-red-500',
                status === 'idle' && 'bg-gray-500',
                status === 'waiting_input' && 'bg-yellow-500 animate-pulse'
              )}
            />
            <span className="text-sm text-white/60">{card.title}</span>
          </div>

          {session?.totalCostUsd ? (
            <span className="text-xs text-white/30">
              ${session.totalCostUsd.toFixed(4)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRestart}
            className="px-3 py-1 text-xs text-white/50 hover:text-white/80 hover:bg-white/5 rounded-lg transition-all"
          >
            Restart
          </button>
          <button
            onClick={handleKill}
            className="px-3 py-1 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
          >
            Kill
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isConnecting && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/30">
              <p className="text-lg mb-2">Start a conversation with Claude</p>
              <p className="text-sm">
                {card.prompt
                  ? 'Processing your prompt...'
                  : 'Type a message below to begin'}
              </p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
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
        disabled={status === 'running' || isConnecting}
        placeholder={
          status === 'running'
            ? 'Claude is responding...'
            : 'Send a message to Claude...'
        }
      />
    </div>
  );
}
