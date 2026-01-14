import { useState, useEffect } from 'react';
import type { Card } from '../../types';
import { checkGhCli, getDiffStats, createPullRequest, removeWorktree } from '../../lib/tauri-commands';
import type { DiffStats, GhStatus } from '../../lib/tauri-commands';

interface PullRequestDialogProps {
  card: Card;
  projectPath: string;
  onClose: () => void;
  onSuccess: (prUrl: string) => void;
}

export function PullRequestDialog({ card, projectPath, onClose, onSuccess }: PullRequestDialogProps) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(generatePrBody(card));
  const [isDraft, setIsDraft] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ghStatus, setGhStatus] = useState<GhStatus | null>(null);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);

  useEffect(() => {
    async function loadStatus() {
      try {
        const [gh, stats] = await Promise.all([
          checkGhCli(),
          card.worktree_path && card.base_branch
            ? getDiffStats(card.worktree_path, card.base_branch)
            : Promise.resolve(null),
        ]);
        setGhStatus(gh);
        setDiffStats(stats);
      } catch (err) {
        console.error('Failed to load PR status:', err);
      }
    }
    loadStatus();
  }, [card.worktree_path, card.base_branch]);

  const handleCreatePr = async () => {
    if (!card.worktree_path || !card.base_branch) {
      setError('Missing worktree or base branch information');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await createPullRequest(
        card.worktree_path,
        title,
        body,
        card.base_branch,
        isDraft
      );

      // Clean up worktree after successful PR
      try {
        await removeWorktree(projectPath, card.worktree_path);
      } catch (cleanupErr) {
        console.warn('Failed to clean up worktree:', cleanupErr);
      }

      onSuccess(result.pr_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenInBrowser = () => {
    // Construct GitHub compare URL
    if (card.branch_name && card.base_branch) {
      const encodedTitle = encodeURIComponent(title);
      const encodedBody = encodeURIComponent(body);
      const url = `https://github.com/compare/${card.base_branch}...${card.branch_name}?quick_pull=1&title=${encodedTitle}&body=${encodedBody}`;
      window.open(url, '_blank');
    }
    onClose();
  };

  const ghNotReady = !ghStatus?.installed || !ghStatus?.authenticated;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white/90">Create Pull Request</h2>
          <p className="text-sm text-white/50 mt-1">
            Branch: {card.branch_name || 'Unknown'} → {card.base_branch || 'main'}
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* GitHub CLI Status */}
          {ghNotReady && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-3">
                <span className="text-amber-400">⚠️</span>
                <div>
                  <p className="text-sm font-medium text-amber-300">GitHub CLI Not Ready</p>
                  <p className="text-sm text-white/60 mt-1">
                    {!ghStatus?.installed
                      ? 'GitHub CLI (gh) is not installed. '
                      : 'GitHub CLI is not authenticated. '}
                    You can still open the PR in your browser.
                  </p>
                  {!ghStatus?.installed && (
                    <a
                      href="https://cli.github.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300 mt-2 inline-block"
                    >
                      Install GitHub CLI →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Diff Stats */}
          {diffStats && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-white/60">
                {diffStats.files_changed} file{diffStats.files_changed !== 1 ? 's' : ''} changed
              </span>
              <span className="text-green-400">+{diffStats.insertions}</span>
              <span className="text-red-400">-{diffStats.deletions}</span>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="glass-input w-full"
              placeholder="PR title"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Description</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="glass-input w-full resize-none"
              placeholder="Describe your changes..."
            />
          </div>

          {/* Draft Toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDraft}
              onChange={(e) => setIsDraft(e.target.checked)}
              className="w-4 h-4 rounded bg-black/30 border border-white/20 checked:bg-blue-500 checked:border-blue-500"
            />
            <span className="text-sm text-white/70">Create as draft PR</span>
          </label>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex gap-3">
          <button onClick={onClose} className="flex-1 glass-button-secondary">
            Cancel
          </button>
          {ghNotReady ? (
            <button onClick={handleOpenInBrowser} className="flex-1 glass-button-primary">
              Open in Browser
            </button>
          ) : (
            <button
              onClick={handleCreatePr}
              disabled={isLoading || !title.trim()}
              className="flex-1 glass-button-primary"
            >
              {isLoading ? 'Creating...' : 'Create PR'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function generatePrBody(card: Card): string {
  const parts: string[] = [];

  parts.push('## Summary');
  if (card.description) {
    parts.push(card.description);
  } else {
    parts.push('_No description provided._');
  }

  if (card.planContent) {
    parts.push('');
    parts.push('## Implementation Plan');
    parts.push(card.planContent);
  }

  parts.push('');
  parts.push('---');
  parts.push('_Created with [AbsolutelyRight](https://github.com/absolutelyright)_');

  return parts.join('\n');
}
