import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { startClaudeSession, killClaudeSession, sendToClaudeSession, createWorktree, getGitInfo } from '../../lib/tauri-commands';
import { useChatStore } from '../../stores/chatStore';
import { useCardStore } from '../../stores/cardStore';
import { MessageGroup } from '../chat/MessageGroup';
import { ChatInput } from '../chat/ChatInput';
import type { Card, ClaudeEvent } from '../../types';
import { getToolsForMode } from '../../stores/workflowStore';
import { parseIdeaSummary, hasCompleteSummary } from '../../lib/summaryParser';
import { claimBackgroundSession, releaseToBackgroundSession } from '../../lib/backgroundSessions';

interface IdeasPanelProps {
  card: Card;
  projectPath: string;
}

/**
 * IdeasPanel - Initial ideation mode for cards in the Ideas column.
 * Auto-prompts Claude with card context and helps flesh out the idea.
 */
export function IdeasPanel({ card, projectPath }: IdeasPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingEventsRef = useRef<ClaudeEvent[]>([]);
  const autoPromptTriggeredRef = useRef(false);
  const accumulatedTextRef = useRef<string>('');
  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastParsedSummaryRef = useRef<string | null>(null);

  const {
    createSessionPreservingHistory,
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
    getConversationTurns,
  } = useChatStore();

  const { updateClaudeStatus, updateCard, moveCard } = useCardStore();

  const session = getSessionByCardId(card.id);
  const turns = session ? getConversationTurns(session.id) : [];

  // Claim background session on mount, release on unmount
  useEffect(() => {
    const claimedSessionId = claimBackgroundSession(card.id);
    if (claimedSessionId) {
      sessionIdRef.current = claimedSessionId;
      console.log('[IdeasPanel] Claimed background session:', claimedSessionId);
    } else if (session) {
      // Sync with existing session even if not background
      sessionIdRef.current = session.id;
      console.log('[IdeasPanel] Synced with existing session:', session.id);
    }

    return () => {
      // Release back to background if session is still running
      const currentSession = getSessionByCardId(card.id);
      if (sessionIdRef.current && currentSession && ['running', 'question'].includes(currentSession.status)) {
        releaseToBackgroundSession(sessionIdRef.current, card.id);
      }
    };
  }, [card.id, session, getSessionByCardId]);

  // Debounced summary parsing - extracts summaries from Claude's text output
  const debouncedParseSummary = useCallback((text: string) => {
    // Clear existing timeout
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
    }

    // Set a new timeout to parse after 1 second of no new text
    parseTimeoutRef.current = setTimeout(() => {
      console.log('[IdeasPanel] Debounce fired, checking for summary...');
      console.log('[IdeasPanel] hasCompleteSummary:', hasCompleteSummary(text, 'idea'));

      // Only parse if we have a complete summary
      if (hasCompleteSummary(text, 'idea')) {
        const summary = parseIdeaSummary(text);
        console.log('[IdeasPanel] Parsed summary:', summary);
        if (summary && summary !== lastParsedSummaryRef.current) {
          console.log('[IdeasPanel] Updating card with ideaSummary');
          lastParsedSummaryRef.current = summary;
          updateCard(card.id, { ideaSummary: summary });
        }
      }
    }, 1000);
  }, [card.id, updateCard]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (parseTimeoutRef.current) {
        clearTimeout(parseTimeoutRef.current);
      }
    };
  }, []);

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
            // Accumulate text for summary parsing
            accumulatedTextRef.current += event.text;
            console.log('[IdeasPanel] Accumulated text length:', accumulatedTextRef.current.length);
            debouncedParseSummary(accumulatedTextRef.current);
          }
          break;

        case 'tool_start':
          if (event.tool_name && event.tool_id) {
            // Intercept UpdateCard tool - this is a frontend-only tool
            if (event.tool_name === 'UpdateCard' && event.tool_input) {
              const { title, description, ideaSummary, ideaContent, planSummary, planContent } = event.tool_input as {
                title?: string;
                description?: string;
                ideaSummary?: string;
                ideaContent?: string;
                planSummary?: string;
                planContent?: string;
              };
              updateCard(card.id, {
                ...(title && { title }),
                ...(description && { description }),
                ...(ideaSummary && { ideaSummary }),
                ...(ideaContent && { ideaContent }),
                ...(planSummary && { planSummary }),
                ...(planContent && { planContent }),
              });
            }

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
          // Don't overwrite 'question' status if already set (e.g., by AskUserQuestion tool)
          const hasQuestions = event.result && event.result.includes('[AWAITING_INPUT]');
          const currentSessionStatus = useChatStore.getState().sessions[sessionIdRef.current]?.status;
          const finalStatus = (currentSessionStatus === 'question' || hasQuestions) ? 'question' : 'completed';

          setStatus(sessionIdRef.current, finalStatus);
          updateClaudeStatus(card.id, finalStatus);

          if (event.cost_usd) {
            setTotalCost(sessionIdRef.current, event.cost_usd);
          }
          // Final summary extraction when session completes
          console.log('[IdeasPanel] Session completed, accumulated text length:', accumulatedTextRef.current.length);
          if (accumulatedTextRef.current) {
            const summary = parseIdeaSummary(accumulatedTextRef.current);
            console.log('[IdeasPanel] Final parsed summary:', summary);
            if (summary && summary !== lastParsedSummaryRef.current) {
              console.log('[IdeasPanel] Saving final ideaSummary to card');
              lastParsedSummaryRef.current = summary;
              updateCard(card.id, { ideaSummary: summary });
            }
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
    [card.id, appendToLastMessage, updateLastMessageStreaming, addToolToLastMessage, updateTool, setStatus, setClaudeSessionId, setTotalCost, updateClaudeStatus, updateCard, debouncedParseSummary]
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

  // Start session with prompt (preserves existing message history)
  // displayMessage is what shows in UI; prompt is what gets sent to Claude (may include hidden instructions)
  const startSession = useCallback(async (prompt: string, displayMessage?: string) => {
    setIsConnecting(true);
    setError(null);
    // Reset accumulated text for new response
    accumulatedTextRef.current = '';
    lastParsedSummaryRef.current = null;

    try {
      const existingSession = getSessionByCardId(card.id);
      const resumeId = existingSession?.claudeSessionId;

      // Use planning mode tools (read-only)
      const tools = getToolsForMode('planning');

      const backendSessionId = await startClaudeSession(
        card.id,
        projectPath,
        prompt,
        tools,
        resumeId
      );

      sessionIdRef.current = backendSessionId;

      // Create new session but preserve existing messages
      createSessionPreservingHistory(backendSessionId, card.id, projectPath, 'planning');

      addMessage(backendSessionId, {
        id: `user-${Date.now()}`,
        role: 'user',
        content: displayMessage || prompt, // Show clean message in UI
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
      console.error('Failed to start Claude session:', err);
      setError(String(err));
      if (sessionIdRef.current) {
        setStatus(sessionIdRef.current, 'error');
      }
      updateClaudeStatus(card.id, 'error');
    } finally {
      setIsConnecting(false);
    }
  }, [card.id, projectPath, getSessionByCardId, createSessionPreservingHistory, addMessage, setStatus, updateClaudeStatus, handleClaudeEvent]);

  // Auto-prompt Claude with card context when panel opens
  useEffect(() => {
    // Only trigger once and only if no existing conversation
    if (autoPromptTriggeredRef.current) return;
    if (turns.length > 0) return;
    if (isConnecting) return;

    autoPromptTriggeredRef.current = true;

    // Generate the initial prompt with card context
    const prompt = generateIdeaPrompt(card);

    // Start the session after a short delay to ensure UI is ready
    setTimeout(() => {
      startSession(prompt);
    }, 300);
  }, [turns.length, isConnecting, card, startSession]);

  // Augment follow-up messages with a reminder to include the summary
  const augmentWithSummaryReminder = (message: string): string => {
    return `${message}

(Remember to include an updated "Idea Summary:" section at the end of your response with bullet points covering: main goal, key features, scope, and any open questions.)`;
  };

  // Send a follow-up message to an existing running session
  const sendFollowUp = async (message: string) => {
    if (!sessionIdRef.current) return;

    try {
      // Add user message to UI (show original, not augmented)
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

      // Send augmented message to Claude via stdin
      await sendToClaudeSession(sessionIdRef.current, augmentWithSummaryReminder(message));
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
      // For resuming a completed session, augment with reminder
      // (Initial auto-prompt already has full instructions via generateIdeaPrompt)
      const existingSession = getSessionByCardId(card.id);
      const cleanMessage = message.trim();
      if (existingSession && existingSession.messages.length > 0) {
        // Resuming: send augmented prompt but show clean message in UI
        await startSession(augmentWithSummaryReminder(cleanMessage), cleanMessage);
      } else {
        // Fresh start: just send the message as-is
        await startSession(cleanMessage);
      }
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

  const handleMoveToPlanning = async () => {
    try {
      // Check if this is a git repo and create worktree
      const gitInfo = await getGitInfo(projectPath);
      if (gitInfo.is_git_repo) {
        // Create worktree for isolated development
        const result = await createWorktree(
          projectPath,
          card.id,
          card.title,
          card.card_type
        );
        updateCard(card.id, {
          worktree_path: result.worktree_path,
          branch_name: result.branch_name,
          base_branch: result.base_branch,
          worktree_status: 'ready',
        });
      }
    } catch (err) {
      console.warn('[IdeasPanel] Failed to create worktree:', err);
      // Continue anyway - worktree is optional
    }

    // Clear the Ideas session so SpecPanel can auto-start planning
    // (The idea context is preserved in card.ideaSummary)
    clearSession(card.id);
    // Move card to Planning to start detailed planning
    moveCard(card.id, 'todo', 0);
  };

  const status = session?.status || 'idle';

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.8)] backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5" style={{ background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.1) 0%, transparent 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="text-xs">💡</span>
            </div>
            <span className="text-sm text-white/60">Ideas Mode</span>
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
            onClick={handleMoveToPlanning}
            className="px-3 py-1 text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg transition-all flex items-center gap-1"
          >
            <span>Ready to Plan</span>
            <span>→</span>
          </button>
          {status === 'running' && (
            <button
              onClick={handleKill}
              className="px-3 py-1 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <div className="px-4 py-2 bg-green-500/5 border-b border-green-500/10">
        <p className="text-xs text-green-300/60">
          💡 Flesh out your idea with Claude. Discuss requirements, explore possibilities, and refine the concept before planning.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {turns.length === 0 && isConnecting && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/30 max-w-md">
              <div className="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-lg mb-2">Analyzing your idea...</p>
              <p className="text-sm">
                Claude is reviewing your idea and preparing questions.
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
        disabled={status === 'running' || isConnecting}
        placeholder={
          status === 'running'
            ? 'Claude is thinking...'
            : 'Continue discussing your idea...'
        }
      />
    </div>
  );
}

/**
 * Generate initial prompt for idea exploration
 */
function generateIdeaPrompt(card: Card): string {
  const typeLabel = card.card_type === 'bug' ? 'bug fix' :
                   card.card_type === 'chore' ? 'chore' :
                   card.card_type === 'task' ? 'task' : 'feature';

  let prompt = `I have an idea for a ${typeLabel} that I'd like to explore and flesh out before planning the implementation.

**Title:** ${card.title}`;

  if (card.description) {
    prompt += `

**Description:** ${card.description}`;
  }

  prompt += `

Your job is to help me flesh out this idea through conversation. Here's how:

1. **First, explore the codebase** - Look at the current folder structure and existing code to understand the project context. This helps you ask better questions and understand how this idea might fit in.

2. **Ask me clarifying questions** - Don't assume you understand everything. Ask 2-3 specific questions about what I'm trying to accomplish, edge cases, or preferences. Wait for my answers before proceeding.

3. **Have a back-and-forth discussion** - This should be a conversation where you ask questions and I provide answers. Don't just dump information - engage with me.

4. **After each exchange, output an updated "Idea Summary:"** - This should be 3-5 bullet points capturing the key aspects of the idea as we discuss it. IMPORTANT: Always include the exact header "Idea Summary:" followed by bullet points so I can track how the idea evolves.

Format your Idea Summary exactly like this:

Idea Summary:
- Main goal: [what we're trying to achieve]
- Key features: [core functionality]
- Scope: [what's in/out]
- Open questions: [things still to decide]

Start by quickly exploring the codebase to understand the project, then ask me your clarifying questions about this idea.`;

  return prompt;
}
