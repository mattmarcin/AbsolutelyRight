import { invoke } from '@tauri-apps/api/core';
import type { TerminalOutput, TerminalSession } from '../types';

// Claude session info from backend
export interface ClaudeSessionInfo {
  id: string;
  card_id: string;
  project_path: string;
  claude_session_id: string | null;
  status: string;
  is_alive: boolean;
  total_cost_usd: number;
}

// Terminal commands
export async function createTerminalSession(
  cardId: string,
  projectPath: string,
  cols: number,
  rows: number,
  initialPrompt?: string
): Promise<string> {
  return invoke('create_terminal_session', {
    cardId,
    projectPath,
    cols,
    rows,
    initialPrompt,
  });
}

export async function writeToTerminal(
  sessionId: string,
  data: Uint8Array
): Promise<void> {
  return invoke('write_to_terminal', {
    sessionId,
    data: Array.from(data),
  });
}

export async function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke('resize_terminal', { sessionId, cols, rows });
}

export async function getTerminalOutput(
  sessionId: string
): Promise<TerminalOutput> {
  return invoke('get_terminal_output', { sessionId });
}

export async function listTerminalSessions(): Promise<TerminalSession[]> {
  return invoke('list_terminal_sessions');
}

export async function killTerminalSession(sessionId: string): Promise<void> {
  return invoke('kill_terminal_session', { sessionId });
}

// Claude headless session commands
export async function startClaudeSession(
  cardId: string,
  projectPath: string,
  prompt: string,
  allowedTools?: string[],
  resumeSessionId?: string
): Promise<string> {
  return invoke('start_claude_session', {
    cardId,
    projectPath,
    prompt,
    allowedTools,
    resumeSessionId,
  });
}

export async function getClaudeSession(
  sessionId: string
): Promise<ClaudeSessionInfo | null> {
  return invoke('get_claude_session', { sessionId });
}

export async function listClaudeSessions(): Promise<ClaudeSessionInfo[]> {
  return invoke('list_claude_sessions');
}

export async function killClaudeSession(sessionId: string): Promise<void> {
  return invoke('kill_claude_session', { sessionId });
}
