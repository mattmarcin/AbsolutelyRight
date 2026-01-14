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
