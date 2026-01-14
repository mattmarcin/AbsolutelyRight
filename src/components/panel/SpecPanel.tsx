import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { startClaudeSession, killClaudeSession, sendToClaudeSession } from '../../lib/tauri-commands';
import { useChatStore } from '../../stores/chatStore';
import { useCardStore } from '../../stores/cardStore';
import { MessageGroup } from '../chat/MessageGroup';
import { ChatInput } from '../chat/ChatInput';
import type { Card, ClaudeEvent } from '../../types';
import { getToolsForMode } from '../../stores/workflowStore';
import { parsePlanSummary, parsePlanContent, hasCompleteSummary } from '../../lib/summaryParser';
import { claimBackgroundSession, releaseToBackgroundSession, startBackgroundSession } from '../../lib/backgroundSessions';

interface SpecPanelProps {
  card: Card;
  projectPath: string;
}

/**
 * SpecPanel - Chat-only mode for planning (Backlog, To Do)
 * Uses read-only tools for research and planning discussions.
 */
export function SpecPanel({ card, projectPath }: SpecPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingEventsRef = useRef<ClaudeEvent[]>([]);
  const accumulatedTextRef = useRef<string>('');
  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastParsedSummaryRef = useRef<string | null>(null);
  const lastParsedContentRef = useRef<string | null>(null);

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

  const { updateClaudeStatus, moveCard, updateCard } = useCardStore();

  const session = getSessionByCardId(card.id);
  const turns = session ? getConversationTurns(session.id) : [];
  const autoPlanTriggeredRef = useRef(false);

  // Claim background session on mount, release on unmount
  useEffect(() => {
    const claimedSessionId = claimBackgroundSession(card.id);
    if (claimedSessionId) {
      sessionIdRef.current = claimedSessionId;
      console.log('[SpecPanel] Claimed background session:', claimedSessionId);
    } else if (session) {
      sessionIdRef.current = session.id;
      console.log('[SpecPanel] Synced with existing session:', session.id);
    }

    return () => {
      const currentSession = getSessionByCardId(card.id);
      if (sessionIdRef.current && currentSession && ['running', 'question'].includes(currentSession.status)) {
        releaseToBackgroundSession(sessionIdRef.current, card.id);
      }
    };
  }, [card.id, session, getSessionByCardId]);

  // Debounced summary parsing - extracts plan summaries from Claude's text output
  const debouncedParseSummary = useCallback((text: string) => {
    // Clear existing timeout
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
    }

    // Set a new timeout to parse after 1 second of no new text
    parseTimeoutRef.current = setTimeout(() => {
      console.log('[SpecPanel] Debounced parse running, text length:', text.length);
      const updates: { planSummary?: string; planContent?: string } = {};

      // Parse plan summary if complete
      const isComplete = hasCompleteSummary(text, 'plan');
      console.log('[SpecPanel] hasCompleteSummary:', isComplete);
      if (isComplete) {
        const summary = parsePlanSummary(text);
        console.log('[SpecPanel] Parsed plan summary:', summary?.substring(0, 100));
        if (summary && summary !== lastParsedSummaryRef.current) {
          lastParsedSummaryRef.current = summary;
          updates.planSummary = summary;
        }
      }

      // Parse plan content
      const content = parsePlanContent(text);
      console.log('[SpecPanel] Parsed plan content length:', content?.length);
      if (content && content !== lastParsedContentRef.current) {
        lastParsedContentRef.current = content;
        updates.planContent = content;
      }

      // Update card if we have new data
      console.log('[SpecPanel] Updates to apply:', Object.keys(updates));
      if (Object.keys(updates).length > 0) {
        updateCard(card.id, updates);
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

  // Auto-generate plan when card enters Planning with a worktree but no plan
  useEffect(() => {
    // Only trigger once per card
    if (autoPlanTriggeredRef.current) return;

    // Check conditions: card is in Planning, no existing plan or conversation
    // Note: worktree is optional - planning works without it (just no branch isolation)
    const shouldAutoGeneratePlan =
      card.status === 'todo' &&
      !card.planContent &&
      turns.length === 0 &&
      !isConnecting;

    if (shouldAutoGeneratePlan) {
      autoPlanTriggeredRef.current = true;

      // Generate the auto-plan prompt
      const prompt = generatePlanPrompt(card);

      // Start the session after a short delay to ensure UI is ready
      setTimeout(() => {
        startSession(prompt);
      }, 500);
    }
  }, [card.status, card.planContent, turns.length, isConnecting]);

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
            // Log occasionally to avoid spam
            if (accumulatedTextRef.current.length % 500 < event.text.length) {
              console.log('[SpecPanel] Accumulated text length:', accumulatedTextRef.current.length);
            }
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
          console.log('[SpecPanel] Session completed, accumulated text length:', accumulatedTextRef.current.length);
          if (accumulatedTextRef.current) {
            const updates: { planSummary?: string; planContent?: string } = {};
            const summary = parsePlanSummary(accumulatedTextRef.current);
            console.log('[SpecPanel] Final parsed plan summary:', summary?.substring(0, 100));
            if (summary && summary !== lastParsedSummaryRef.current) {
              console.log('[SpecPanel] Saving planSummary to card');
              lastParsedSummaryRef.current = summary;
              updates.planSummary = summary;
            }
            const content = parsePlanContent(accumulatedTextRef.current);
            console.log('[SpecPanel] Final parsed plan content length:', content?.length);
            if (content && content !== lastParsedContentRef.current) {
              console.log('[SpecPanel] Saving planContent to card');
              lastParsedContentRef.current = content;
              updates.planContent = content;
            }
            if (Object.keys(updates).length > 0) {
              console.log('[SpecPanel] Applying updates:', Object.keys(updates));
              updateCard(card.id, updates);
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
  const startSession = async (prompt: string, displayMessage?: string) => {
    setIsConnecting(true);
    setError(null);
    // Reset accumulated text for new response
    accumulatedTextRef.current = '';
    lastParsedSummaryRef.current = null;
    lastParsedContentRef.current = null;

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
  };

  // Augment follow-up messages with a reminder to include the plan summary
  const augmentWithPlanReminder = (message: string): string => {
    return `${message}

(Remember to include an updated "Plan Summary:" section at the end of your response, followed by a detailed implementation plan with phases, tasks, and file changes.)`;
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
      await sendToClaudeSession(sessionIdRef.current, augmentWithPlanReminder(message));
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
      const existingSession = getSessionByCardId(card.id);
      const cleanMessage = message.trim();
      if (existingSession && existingSession.messages.length > 0) {
        // Resuming: send augmented prompt but show clean message in UI
        await startSession(augmentWithPlanReminder(cleanMessage), cleanMessage);
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

  const handleStartWorking = async () => {
    // Clear the Planning session so ExecutionPanel can start fresh
    // (The plan context is preserved in card.planContent and card.planSummary)
    clearSession(card.id);
    // Start the execution background session
    await startBackgroundSession(card, projectPath, 'execution');
    // Move card to In Progress
    moveCard(card.id, 'in_progress', 0);
  };

  const status = session?.status || 'idle';

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.8)] backdrop-blur-xl">
      {/* Header */}
      <div className="panel-header-spec flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
              <span className="text-xs">📋</span>
            </div>
            <span className="text-sm text-white/60">Planning Mode</span>
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
            onClick={handleStartWorking}
            className="px-3 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg transition-all flex items-center gap-1"
          >
            <span>Start Working</span>
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
      <div className="px-4 py-2 bg-blue-500/5 border-b border-blue-500/10">
        <p className="text-xs text-blue-300/60">
          💡 Discuss requirements and plan the implementation. Claude can read files and search but won't make changes.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {turns.length === 0 && !isConnecting && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/30 max-w-md">
              <div className="text-4xl mb-4">📋</div>
              <p className="text-lg mb-2">Plan your feature</p>
              <p className="text-sm">
                Discuss requirements, explore the codebase, and refine specs before implementation.
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
            : 'Discuss specs, ask questions, explore the codebase...'
        }
      />
    </div>
  );
}

/**
 * Generate a plan generation prompt for auto-planning
 */
function generatePlanPrompt(card: Card): string {
  const typeLabel = card.card_type === 'bug' ? 'Bug Fix' :
                   card.card_type === 'chore' ? 'Chore' : 'Feature';

  let prompt = `Create an implementation plan for this ${typeLabel.toLowerCase()}:

**Title:** ${card.title}`;

  if (card.description) {
    prompt += `
**Description:** ${card.description}`;
  }

  if (card.ideaSummary) {
    prompt += `

**Idea Summary from Discussion:**
${card.ideaSummary}`;
  }

  prompt += `
**Type:** ${typeLabel}

Please analyze what needs to be done and create a structured implementation plan.

1. First, explore the codebase to understand the current state.

2. Create a detailed plan with the following structure:

## Implementation Plan

[Your detailed plan here with sections for:
- Overview of the approach
- Step-by-step implementation tasks
- Files to modify
- Potential challenges
- Testing considerations]

3. At the end of your response, include a "Plan Summary:" section with 3-5 bullet points summarizing the key steps. IMPORTANT: Always include the exact header "Plan Summary:" followed by bullet points.

Format your Plan Summary exactly like this:

Plan Summary:
- Step 1: [brief description]
- Step 2: [brief description]
- Key files: [list]
- Risk: [main concern]

Focus on being specific and actionable. The plan should guide the execution phase.`;

  return prompt;
}
