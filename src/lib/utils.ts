import type { CardType, ClaudeStatus } from '../types';

export function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function getCardTypeColor(type: CardType): string {
  const colors: Record<CardType, string> = {
    feature: 'bg-green-500/20 text-green-400 border-green-500/30',
    bug: 'bg-red-500/20 text-red-400 border-red-500/30',
    task: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    chore: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };
  return colors[type] || colors.task;
}

export function getClaudeStatusColor(status: ClaudeStatus): string {
  const colors: Record<ClaudeStatus, string> = {
    idle: 'bg-gray-500',
    running: 'bg-blue-500 animate-pulse',
    waiting_input: 'bg-yellow-500 animate-pulse',
    error: 'bg-red-500',
    completed: 'bg-green-500',
  };
  return colors[status] || colors.idle;
}

export function getClaudeStatusLabel(status: ClaudeStatus): string {
  const labels: Record<ClaudeStatus, string> = {
    idle: 'Idle',
    running: 'Running...',
    waiting_input: 'Needs Input',
    error: 'Error',
    completed: 'Completed',
  };
  return labels[status] || 'Unknown';
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
