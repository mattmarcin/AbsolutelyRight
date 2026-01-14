import { listen } from '@tauri-apps/api/event';
import { startClaudeSession as startTauriSession } from './tauri-commands';
import { useChatStore } from '../stores/chatStore';
import { useCardStore } from '../stores/cardStore';
import { SESSION_MODE_TOOLS } from '../stores/workflowStore';
import type { ClaudeEvent, Card, SessionMode } from '../types';

// Track active background sessions
const activeBackgroundSessions = new Map<string, string>(); // sessionId -> cardId

// Detect if Claude is awaiting user input
function isAwaitingInput(text: string): boolean {
  if (!text) return false;
  return text.includes('[AWAITING_INPUT]');
}

// Generate prompts for different modes
function generateIdeasPrompt(card: Card): string {
  return `You are helping to flesh out an idea for a software feature or task.

**Card Title:** ${card.title}
${card.description ? `**Description:** ${card.description}` : ''}
**Type:** ${card.card_type}

Your goal is to:
1. Understand what the user wants to build
2. Ask clarifying questions if needed
3. Help them think through the concept
4. Identify potential challenges or considerations

Start by acknowledging the idea and asking any clarifying questions you have. Be conversational and helpful.

IMPORTANT: If you have questions for the user or need their input, end your response with [AWAITING_INPUT] on its own line.`;
}

function generatePlanningPrompt(card: Card): string {
  return `You are creating an implementation plan for a software task.

**Card Title:** ${card.title}
${card.description ? `**Description:** ${card.description}` : ''}
**Type:** ${card.card_type}

Analyze what needs to be done and create a structured implementation plan with:
1. Overview of the approach
2. Step-by-step implementation tasks
3. Files that will likely need to be modified or created
4. Potential challenges or risks
5. Testing considerations

Be thorough but concise. Focus on actionable steps.

IMPORTANT: If you have questions for the user or need their input before proceeding, end your response with [AWAITING_INPUT] on its own line.`;
}

function generateExecutionPrompt(card: Card): string {
  return `You are implementing a software task.

**Card Title:** ${card.title}
${card.description ? `**Description:** ${card.description}` : ''}
**Type:** ${card.card_type}
${card.planContent ? `\n**Implementation Plan:**\n${card.planContent}` : ''}

Execute the implementation plan. Work through each step systematically.
If you encounter any blockers or need clarification, ask questions.
When you complete the implementation, summarize what was done.

IMPORTANT: If you have questions or need user input, end your response with [AWAITING_INPUT] on its own line.`;
}

// Initialize the background event listener
let listenerInitialized = false;

export function initBackgroundSessionListener() {
  if (listenerInitialized) return;
  listenerInitialized = true;

  listen<ClaudeEvent>('claude-event', (event) => {
    const payload = event.payload;
    const cardId = activeBackgroundSessions.get(payload.session_id);

    console.log('[BackgroundSessions] Event received:', payload.type, 'session:', payload.session_id, 'tracked:', cardId || 'NOT TRACKED');

    if (!cardId) return; // Not a background session we're tracking

    const { updateClaudeStatus } = useCardStore.getState();
    const { setStatus, appendToLastMessage, addToolToLastMessage, updateTool, setClaudeSessionId, setTotalCost, updateLastMessageStreaming } = useChatStore.getState();

    switch (payload.type) {
      case 'session_started':
        if (payload.claude_session_id) {
          setClaudeSessionId(payload.session_id, payload.claude_session_id);
        }
        setStatus(payload.session_id, 'running');
        updateClaudeStatus(cardId, 'running');
        break;

      case 'text_chunk':
        if (payload.text) {
          appendToLastMessage(payload.session_id, payload.text);
        }
        break;

      case 'tool_start':
        if (payload.tool_name && payload.tool_id) {
          // Detect when Claude is asking a question
          if (payload.tool_name === 'AskUserQuestion') {
            setStatus(payload.session_id, 'question');
            updateClaudeStatus(cardId, 'question');
          }

          addToolToLastMessage(payload.session_id, {
            id: payload.tool_id,
            name: payload.tool_name,
            input: payload.tool_input || {},
            status: 'running',
            startedAt: new Date().toISOString(),
          });
        }
        break;

      case 'tool_end':
        if (payload.tool_id) {
          updateTool(payload.session_id, payload.tool_id, {
            status: payload.success ? 'completed' : 'error',
            output: payload.output,
            completedAt: new Date().toISOString(),
          });
        }
        break;

      case 'status_changed':
        if (payload.status) {
          setStatus(payload.session_id, payload.status);
          updateClaudeStatus(cardId, payload.status);
        }
        break;

      case 'session_completed':
        updateLastMessageStreaming(payload.session_id, false); // Stop the thinking indicator

        // Check if Claude is awaiting user input
        const hasQuestions = payload.result && isAwaitingInput(payload.result);
        const finalStatus = hasQuestions ? 'question' : 'completed';

        setStatus(payload.session_id, finalStatus);
        updateClaudeStatus(cardId, finalStatus);

        if (payload.cost_usd) {
          setTotalCost(payload.session_id, payload.cost_usd);
        }
        // Clean up tracking
        activeBackgroundSessions.delete(payload.session_id);
        break;

      case 'session_error':
        setStatus(payload.session_id, 'error');
        updateClaudeStatus(cardId, 'error');
        activeBackgroundSessions.delete(payload.session_id);
        break;
    }
  });

  console.log('[BackgroundSessions] Event listener initialized');
}

// Start a background Claude session for a card
export async function startBackgroundSession(
  card: Card,
  projectPath: string,
  mode: SessionMode
): Promise<string | null> {
  // Make sure listener is initialized
  initBackgroundSessionListener();

  const { createSessionWithId, addMessage, getSessionByCardId } = useChatStore.getState();
  const { updateClaudeStatus } = useCardStore.getState();

  // Check if there's already an active session for this card
  const existingSession = getSessionByCardId(card.id);
  if (existingSession && ['running', 'question'].includes(existingSession.status)) {
    console.log('[BackgroundSessions] Session already active for card:', card.id);
    return existingSession.id;
  }

  // Generate prompt based on mode and card status
  let prompt: string;
  // For Ideas column (backlog), use ideas prompt even though mode is 'planning'
  if (card.status === 'backlog') {
    prompt = generateIdeasPrompt(card);
  } else {
    switch (mode) {
      case 'planning':
        prompt = generatePlanningPrompt(card);
        break;
      case 'execution':
        prompt = generateExecutionPrompt(card);
        break;
      case 'review':
        prompt = generatePlanningPrompt(card); // Review uses planning prompt
        break;
      default:
        prompt = generatePlanningPrompt(card);
    }
  }

  // Get tools for this mode
  const tools = SESSION_MODE_TOOLS[mode] || [];

  try {
    // Get resume ID if exists
    const resumeId = existingSession?.claudeSessionId;

    // Update status immediately
    updateClaudeStatus(card.id, 'running');

    // Start the Tauri session first to get the backend session ID
    const backendSessionId = await startTauriSession(
      card.id,
      projectPath,
      prompt,
      tools,
      resumeId
    );

    // Use the backend session ID for everything
    const sessionId = backendSessionId;

    // Create session in store with the backend's session ID
    createSessionWithId(sessionId, card.id, projectPath, mode);

    // Add user message
    addMessage(sessionId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    });

    // Add empty assistant message for streaming
    addMessage(sessionId, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    });

    // Track this as a background session using the backend's ID
    activeBackgroundSessions.set(sessionId, card.id);

    console.log('[BackgroundSessions] Started session:', sessionId, 'for card:', card.id);
    return sessionId;
  } catch (err) {
    console.error('[BackgroundSessions] Failed to start session:', err);
    updateClaudeStatus(card.id, 'error');
    return null;
  }
}

// Check if a card has an active background session
export function hasActiveBackgroundSession(cardId: string): boolean {
  for (const [_, cid] of activeBackgroundSessions) {
    if (cid === cardId) return true;
  }
  return false;
}

// Claim a session - remove from background tracking so panel can handle events
// Returns the session ID if found, null otherwise
export function claimBackgroundSession(cardId: string): string | null {
  for (const [sessionId, cid] of activeBackgroundSessions) {
    if (cid === cardId) {
      activeBackgroundSessions.delete(sessionId);
      console.log('[BackgroundSessions] Session claimed by panel:', sessionId, 'for card:', cardId);
      return sessionId;
    }
  }
  return null;
}

// Release a session back to background tracking
export function releaseToBackgroundSession(sessionId: string, cardId: string): void {
  activeBackgroundSessions.set(sessionId, cardId);
  console.log('[BackgroundSessions] Session released to background:', sessionId, 'for card:', cardId);
}
