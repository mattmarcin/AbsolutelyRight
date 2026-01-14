export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export type CardType = 'feature' | 'bug' | 'task' | 'chore';
export type CardStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type ClaudeStatus = 'idle' | 'running' | 'waiting_input' | 'error' | 'completed';

export interface Card {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  card_type: CardType;
  status: CardStatus;
  claude_status: ClaudeStatus;
  position: number;
  prompt?: string;
  created_at: string;
  updated_at: string;
}

export interface TerminalSession {
  id: string;
  card_id: string;
  project_path: string;
  is_active: boolean;
  claude_status: ClaudeStatus;
}

export interface TerminalOutput {
  session_id: string;
  data: number[];
}

export const CARD_TYPES: { value: CardType; label: string; color: string }[] = [
  { value: 'feature', label: 'Feature', color: 'bg-accent-green' },
  { value: 'bug', label: 'Bug', color: 'bg-accent-red' },
  { value: 'task', label: 'Task', color: 'bg-accent-blue' },
  { value: 'chore', label: 'Chore', color: 'bg-accent-purple' },
];

export const CARD_STATUSES: { value: CardStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
];

export const CLAUDE_STATUS_CONFIG: Record<ClaudeStatus, { label: string; color: string }> = {
  idle: { label: 'Idle', color: 'bg-gray-500' },
  running: { label: 'Running', color: 'bg-blue-500' },
  waiting_input: { label: 'Waiting', color: 'bg-yellow-500' },
  error: { label: 'Error', color: 'bg-red-500' },
  completed: { label: 'Done', color: 'bg-green-500' },
};

// ============================================
// Chat/Claude Headless Types
// ============================================

export type ChatMessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ToolUsage {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt?: string;
  completedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  tools?: ToolUsage[];
}

export interface ClaudeSession {
  id: string;
  cardId: string;
  claudeSessionId?: string;
  projectPath: string;
  messages: ChatMessage[];
  status: ClaudeStatus;
  isAlive: boolean;
  totalCostUsd: number;
}

// Claude events from backend
export type ClaudeEventType =
  | 'session_started'
  | 'text_chunk'
  | 'tool_start'
  | 'tool_end'
  | 'status_changed'
  | 'session_completed'
  | 'session_error';

export interface ClaudeEvent {
  type: ClaudeEventType;
  session_id: string;
  // Fields vary by event type
  claude_session_id?: string;
  text?: string;
  tool_name?: string;
  tool_id?: string;
  tool_input?: Record<string, unknown>;
  success?: boolean;
  output?: string;
  status?: ClaudeStatus;
  result?: string;
  cost_usd?: number;
  error?: string;
}
