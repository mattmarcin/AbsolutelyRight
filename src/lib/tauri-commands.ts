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

export async function sendToClaudeSession(
  sessionId: string,
  message: string
): Promise<void> {
  return invoke('send_to_claude_session', { sessionId, message });
}

export async function killSessionsForCard(cardId: string): Promise<void> {
  return invoke('kill_sessions_for_card', { cardId });
}

export async function killAllClaudeSessions(): Promise<void> {
  return invoke('kill_all_claude_sessions');
}

// Git commands
export interface GitInfo {
  default_branch: string;
  remote_url: string | null;
  is_git_repo: boolean;
}

export interface WorktreeResult {
  worktree_path: string;
  branch_name: string;
  base_branch: string;
}

export interface DiffStats {
  files_changed: number;
  insertions: number;
  deletions: number;
}

export interface GhStatus {
  installed: boolean;
  authenticated: boolean;
}

export interface PrResult {
  pr_url: string;
  pr_number: number;
}

export async function initGitRepo(projectPath: string): Promise<void> {
  return invoke('init_git_repo', { projectPath });
}

export async function getGitInfo(projectPath: string): Promise<GitInfo> {
  return invoke('get_git_info', { projectPath });
}

export async function createWorktree(
  projectPath: string,
  cardId: string,
  cardTitle: string,
  cardType: string,
  baseBranch?: string
): Promise<WorktreeResult> {
  return invoke('create_worktree', {
    projectPath,
    cardId,
    cardTitle,
    cardType,
    baseBranch,
  });
}

export async function removeWorktree(
  projectPath: string,
  worktreePath: string
): Promise<void> {
  return invoke('remove_worktree', { projectPath, worktreePath });
}

export async function getDiffStats(
  worktreePath: string,
  baseBranch: string
): Promise<DiffStats> {
  return invoke('get_diff_stats', { worktreePath, baseBranch });
}

export async function checkGhCli(): Promise<GhStatus> {
  return invoke('check_gh_cli');
}

export async function createPullRequest(
  worktreePath: string,
  title: string,
  body: string,
  baseBranch: string,
  isDraft: boolean
): Promise<PrResult> {
  return invoke('create_pull_request', {
    worktreePath,
    title,
    body,
    baseBranch,
    isDraft,
  });
}
