import { invoke } from '@tauri-apps/api/core';
import type { TerminalOutput, TerminalSession } from '../types';

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
