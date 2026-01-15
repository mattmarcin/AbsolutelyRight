import { useState, useEffect, useCallback } from 'react';
import type { Card, MergeDialogState, MergeStrategy } from '../../types';
import {
  getWorktreeStatus,
  getWorktreeCommits,
  getDiffStats,
  commitWorktreeChanges,
  stashWorktreeChanges,
  mergeWorktreeToBase,
  removeWorktree,
  deleteBranch,
  checkGhCli,
} from '../../lib/tauri-commands';
import type {
  WorktreeStatusResult,
  CommitInfoResult,
  DiffStats,
  GhStatus,
} from '../../lib/tauri-commands';
import { cn } from '../../lib/utils';
import type { CardType } from '../../types';

/**
 * Generate a Conventional Commits formatted message
 * @see https://www.conventionalcommits.org/en/v1.0.0/
 *
 * Format: <type>[optional scope]: <description>
 *         [optional body]
 *         [optional footer(s)]
 *
 * Types:
 * - feat: introduces a new feature (correlates with MINOR in SemVer)
 * - fix: patches a bug (correlates with PATCH in SemVer)
 * - chore, build, ci, docs, style, refactor, perf, test: other changes
 */
function generateConventionalCommit(card: Card): string {
  // Map card type to conventional commit type
  const typeMap: Record<CardType, string> = {
    feature: 'feat',
    bug: 'fix',
    chore: 'chore',
    task: 'feat',
  };

  const type = typeMap[card.card_type] || 'feat';

  // Format description: lowercase first letter, remove trailing punctuation
  // The description should be a short summary of the code changes
  let description = card.title.trim();
  if (description.length > 0) {
    description = description.charAt(0).toLowerCase() + description.slice(1);
    description = description.replace(/[.!?]+$/, '');
  }

  // Build the commit message
  // Format: <type>: <description>
  const parts: string[] = [`${type}: ${description}`];

  // Optional body: longer description if available
  // Must begin one blank line after the description
  if (card.description && card.description.trim()) {
    parts.push('');
    parts.push(card.description.trim());
  }

  return parts.join('\n');
}

/**
 * Generate a WIP commit message for uncommitted changes
 */
function generateWipCommit(card: Card): string {
  const typeMap: Record<CardType, string> = {
    feature: 'feat',
    bug: 'fix',
    chore: 'chore',
    task: 'feat',
  };

  const type = typeMap[card.card_type] || 'feat';
  let description = card.title.trim();
  if (description.length > 0) {
    description = description.charAt(0).toLowerCase() + description.slice(1);
    description = description.replace(/[.!?]+$/, '');
  }

  return `${type}(wip): ${description}`;
}

interface MergeDialogProps {
  card: Card;
  projectPath: string;
  onClose: () => void;
  onSuccess: () => void;
  onCreatePR: () => void; // Switch to PR dialog
}

export function MergeDialog({
  card,
  projectPath,
  onClose,
  onSuccess,
  onCreatePR,
}: MergeDialogProps) {
  // State
  const [dialogState, setDialogState] = useState<MergeDialogState>('loading');
  const [worktreeStatus, setWorktreeStatus] = useState<WorktreeStatusResult | null>(null);
  const [commits, setCommits] = useState<CommitInfoResult[]>([]);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [ghStatus, setGhStatus] = useState<GhStatus | null>(null);
  const [strategy, setStrategy] = useState<MergeStrategy>('merge');
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [mergeHash, setMergeHash] = useState<string | null>(null);
  const [deleteBranchAfter, setDeleteBranchAfter] = useState(true);

  // Load worktree status on mount
  useEffect(() => {
    async function loadStatus() {
      if (!card.worktree_path || !card.base_branch) {
        setError('Missing worktree or base branch information');
        setDialogState('error');
        return;
      }

      try {
        const [status, commitList, stats, gh] = await Promise.all([
          getWorktreeStatus(card.worktree_path, card.base_branch),
          getWorktreeCommits(card.worktree_path, card.base_branch),
          getDiffStats(card.worktree_path, card.base_branch),
          checkGhCli(),
        ]);

        setWorktreeStatus(status);
        setCommits(commitList);
        setDiffStats(stats);
        setGhStatus(gh);

        // Generate default commit message using Conventional Commits format
        setCommitMessage(generateConventionalCommit(card));

        // Determine initial state
        if (status.has_uncommitted) {
          setDialogState('uncommitted_warning');
        } else {
          setDialogState('ready');
        }
      } catch (err) {
        console.error('Failed to load worktree status:', err);
        setError(err instanceof Error ? err.message : String(err));
        setDialogState('error');
      }
    }

    loadStatus();
  }, [card]);

  // Handle committing uncommitted changes
  const handleCommitChanges = useCallback(async () => {
    if (!card.worktree_path) return;

    try {
      setDialogState('loading');
      const msg = generateWipCommit(card);
      await commitWorktreeChanges(card.worktree_path, msg);

      // Reload status
      const [status, commitList] = await Promise.all([
        getWorktreeStatus(card.worktree_path, card.base_branch!),
        getWorktreeCommits(card.worktree_path, card.base_branch!),
      ]);
      setWorktreeStatus(status);
      setCommits(commitList);
      setDialogState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialogState('error');
    }
  }, [card]);

  // Handle stashing uncommitted changes
  const handleStashChanges = useCallback(async () => {
    if (!card.worktree_path) return;

    try {
      setDialogState('loading');
      await stashWorktreeChanges(card.worktree_path, `Pre-merge stash for ${card.title}`);

      // Reload status
      const status = await getWorktreeStatus(card.worktree_path, card.base_branch!);
      setWorktreeStatus(status);
      setDialogState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialogState('error');
    }
  }, [card]);

  // Handle the merge
  const handleMerge = useCallback(async () => {
    if (!card.worktree_path || !card.branch_name || !card.base_branch) {
      setError('Missing required information for merge');
      return;
    }

    setDialogState('merging');
    setError(null);

    try {
      const result = await mergeWorktreeToBase(
        projectPath,
        card.branch_name,
        card.base_branch,
        commitMessage,
        strategy === 'squash'
      );

      if (result.success) {
        setMergeHash(result.merge_commit_hash || null);

        // Clean up worktree
        try {
          await removeWorktree(projectPath, card.worktree_path);
        } catch (cleanupErr) {
          console.warn('Failed to remove worktree:', cleanupErr);
        }

        // Delete branch if requested
        if (deleteBranchAfter) {
          try {
            await deleteBranch(projectPath, card.branch_name, false);
          } catch (branchErr) {
            console.warn('Failed to delete branch:', branchErr);
          }
        }

        setDialogState('success');
      } else {
        if (result.conflict_files && result.conflict_files.length > 0) {
          setConflictFiles(result.conflict_files);
          setDialogState('conflict');
        } else {
          setError(result.error_message || 'Merge failed');
          setDialogState('error');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialogState('error');
    }
  }, [card, projectPath, commitMessage, strategy, deleteBranchAfter]);

  // Handle skip merge (just move to done without merging)
  const handleSkipMerge = useCallback(() => {
    onSuccess();
  }, [onSuccess]);

  // Render loading state
  if (dialogState === 'loading') {
    return (
      <DialogContainer onClose={onClose}>
        <DialogHeader title="Preparing Merge" subtitle="Loading worktree status..." />
        <div className="p-6 flex items-center justify-center h-32">
          <div className="flex items-center gap-3 text-white/60">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
            <span>Loading...</span>
          </div>
        </div>
      </DialogContainer>
    );
  }

  // Render uncommitted warning state
  if (dialogState === 'uncommitted_warning' && worktreeStatus) {
    return (
      <DialogContainer onClose={onClose}>
        <DialogHeader
          title="Uncommitted Changes"
          subtitle={`${worktreeStatus.uncommitted_files.length} file(s) with unsaved changes`}
        />
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-3">
              <span className="text-amber-400 text-lg">⚠️</span>
              <div>
                <p className="text-sm font-medium text-amber-300">
                  You have uncommitted changes
                </p>
                <p className="text-sm text-white/60 mt-1">
                  These changes must be committed or stashed before merging.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-black/20 rounded-lg p-3 max-h-32 overflow-y-auto">
            <p className="text-xs text-white/40 mb-2">Modified files:</p>
            {worktreeStatus.uncommitted_files.map((file, i) => (
              <p key={i} className="text-sm text-white/70 font-mono truncate">
                {file}
              </p>
            ))}
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="flex-1 glass-button-secondary">
            Cancel
          </button>
          <button onClick={handleStashChanges} className="flex-1 glass-button-secondary">
            Stash Changes
          </button>
          <button onClick={handleCommitChanges} className="flex-1 glass-button-primary">
            Commit All
          </button>
        </DialogFooter>
      </DialogContainer>
    );
  }

  // Render ready state
  if (dialogState === 'ready' && worktreeStatus) {
    const hasRemote = ghStatus?.installed && ghStatus?.authenticated;

    return (
      <DialogContainer onClose={onClose}>
        <DialogHeader
          title="Merge Branch"
          subtitle={`${worktreeStatus.branch_name} → ${worktreeStatus.base_branch}`}
        />
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Stats */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-white/60">
              {commits.length} commit{commits.length !== 1 ? 's' : ''}
            </span>
            {diffStats && (
              <>
                <span className="text-white/40">|</span>
                <span className="text-white/60">
                  {diffStats.files_changed} file{diffStats.files_changed !== 1 ? 's' : ''}
                </span>
                <span className="text-green-400">+{diffStats.insertions}</span>
                <span className="text-red-400">-{diffStats.deletions}</span>
              </>
            )}
          </div>

          {/* Commits list */}
          {commits.length > 0 && (
            <div className="bg-black/20 rounded-lg p-3 max-h-40 overflow-y-auto">
              <p className="text-xs text-white/40 mb-2">Commits to merge:</p>
              {commits.map((commit, i) => (
                <div key={i} className="flex items-start gap-2 py-1">
                  <code className="text-xs text-blue-400 font-mono">{commit.hash}</code>
                  <span className="text-sm text-white/70 flex-1 truncate">{commit.message}</span>
                  <span className="text-xs text-white/40">{commit.date}</span>
                </div>
              ))}
            </div>
          )}

          {/* Strategy selection */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">
              Merge Strategy
            </label>
            <div className="flex gap-2">
              <StrategyButton
                label="Merge"
                description="Keep all commits"
                selected={strategy === 'merge'}
                onClick={() => setStrategy('merge')}
              />
              <StrategyButton
                label="Squash"
                description="Combine into one"
                selected={strategy === 'squash'}
                onClick={() => setStrategy('squash')}
              />
              {hasRemote && (
                <StrategyButton
                  label="Create PR"
                  description="Push & open PR"
                  selected={strategy === 'pr'}
                  onClick={() => setStrategy('pr')}
                />
              )}
            </div>
          </div>

          {/* Commit message (for merge/squash) */}
          {strategy !== 'pr' && (
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Commit Message
              </label>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                rows={4}
                className="glass-input w-full resize-none font-mono text-sm"
                placeholder="Enter commit message..."
              />
            </div>
          )}

          {/* Delete branch option */}
          {strategy !== 'pr' && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteBranchAfter}
                onChange={(e) => setDeleteBranchAfter(e.target.checked)}
                className="w-4 h-4 rounded bg-black/30 border border-white/20 checked:bg-blue-500 checked:border-blue-500"
              />
              <span className="text-sm text-white/70">Delete branch after merge</span>
            </label>
          )}
        </div>
        <DialogFooter>
          <button onClick={onClose} className="glass-button-secondary">
            Cancel
          </button>
          <button
            onClick={handleSkipMerge}
            className="glass-button-secondary text-xs"
          >
            Skip Merge
          </button>
          {strategy === 'pr' ? (
            <button onClick={onCreatePR} className="flex-1 glass-button-primary">
              Create Pull Request
            </button>
          ) : (
            <button
              onClick={handleMerge}
              disabled={!commitMessage.trim()}
              className="flex-1 glass-button-primary"
            >
              {strategy === 'squash' ? 'Squash & Merge' : 'Merge'}
            </button>
          )}
        </DialogFooter>
      </DialogContainer>
    );
  }

  // Render merging state
  if (dialogState === 'merging') {
    return (
      <DialogContainer onClose={onClose}>
        <DialogHeader title="Merging..." subtitle="Please wait" />
        <div className="p-6 flex items-center justify-center h-32">
          <div className="flex items-center gap-3 text-white/60">
            <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
            <span>Merging branch...</span>
          </div>
        </div>
      </DialogContainer>
    );
  }

  // Render conflict state
  if (dialogState === 'conflict') {
    return (
      <DialogContainer onClose={onClose}>
        <DialogHeader
          title="Merge Conflicts"
          subtitle={`${conflictFiles.length} file(s) need manual resolution`}
        />
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
            <div className="flex items-start gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <p className="text-sm font-medium text-red-300">Merge conflicts detected</p>
                <p className="text-sm text-white/60 mt-1">
                  The following files have conflicts that need to be resolved manually.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-black/20 rounded-lg p-3 max-h-40 overflow-y-auto">
            {conflictFiles.map((file, i) => (
              <p key={i} className="text-sm text-red-300 font-mono py-1">
                {file}
              </p>
            ))}
          </div>

          <p className="text-sm text-white/50">
            Open your editor to resolve the conflicts, then try again.
          </p>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="flex-1 glass-button-secondary">
            Close
          </button>
        </DialogFooter>
      </DialogContainer>
    );
  }

  // Render success state
  if (dialogState === 'success') {
    return (
      <DialogContainer onClose={onClose}>
        <DialogHeader title="Merge Complete" subtitle="Branch successfully merged" />
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
            <div className="flex items-start gap-3">
              <span className="text-green-400 text-lg">✓</span>
              <div>
                <p className="text-sm font-medium text-green-300">Successfully merged!</p>
                {mergeHash && (
                  <p className="text-sm text-white/60 mt-1 font-mono">
                    Commit: {mergeHash.substring(0, 8)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <button onClick={onSuccess} className="flex-1 glass-button-primary">
            Done
          </button>
        </DialogFooter>
      </DialogContainer>
    );
  }

  // Render error state
  return (
    <DialogContainer onClose={onClose}>
      <DialogHeader title="Merge Failed" subtitle="An error occurred" />
      <div className="p-6 space-y-4">
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-lg">✕</span>
            <div>
              <p className="text-sm font-medium text-red-300">Error</p>
              <p className="text-sm text-white/60 mt-1">{error || 'Unknown error'}</p>
            </div>
          </div>
        </div>
      </div>
      <DialogFooter>
        <button onClick={onClose} className="flex-1 glass-button-secondary">
          Close
        </button>
      </DialogFooter>
    </DialogContainer>
  );
}

// Sub-components

function DialogContainer({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function DialogHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-6 py-5 border-b border-white/5">
      <h2 className="text-lg font-semibold text-white/90">{title}</h2>
      {subtitle && <p className="text-sm text-white/50 mt-1">{subtitle}</p>}
    </div>
  );
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-4 border-t border-white/5 flex gap-3">{children}</div>
  );
}

function StrategyButton({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 p-3 rounded-lg border transition-all text-left',
        selected
          ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
          : 'bg-black/20 border-white/10 text-white/60 hover:border-white/20'
      )}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs opacity-60">{description}</p>
    </button>
  );
}
