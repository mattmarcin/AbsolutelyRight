import { useState, useEffect } from 'react';
import type { Project } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useCardStore } from '../../stores/cardStore';
import { cn } from '../../lib/utils';
import { getGitInfo, initGitRepo } from '../../lib/tauri-commands';

interface ProjectItemProps {
  project: Project;
  isSelected: boolean;
  onClick: () => void;
}

export function ProjectItem({ project, isSelected, onClick }: ProjectItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showGitDialog, setShowGitDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const { deleteProject, updateProject } = useProjectStore();
  const { cards } = useCardStore();

  const projectCards = cards.filter((c) => c.project_id === project.id);
  const inProgressCount = projectCards.filter((c) => c.status === 'in_progress').length;

  // Check git status on mount and when project path changes
  useEffect(() => {
    const checkGitStatus = async () => {
      try {
        const gitInfo = await getGitInfo(project.path);
        if (project.is_git_repo !== gitInfo.is_git_repo) {
          updateProject(project.id, { is_git_repo: gitInfo.is_git_repo });
        }
      } catch (err) {
        console.error('Failed to check git status:', err);
      }
    };
    checkGitStatus();
  }, [project.id, project.path, project.is_git_repo, updateProject]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    deleteProject(project.id);
    setShowDeleteDialog(false);
  };

  const handleGitWarningClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowGitDialog(true);
  };

  const handleInitGit = async () => {
    setIsInitializing(true);
    setGitError(null);
    try {
      await initGitRepo(project.path);
      updateProject(project.id, { is_git_repo: true });
      setShowGitDialog(false);
    } catch (err) {
      console.error('Failed to initialize git:', err);
      setGitError(String(err));
    } finally {
      setIsInitializing(false);
    }
  };

  return (
    <div
      className={cn(
        'group relative rounded-xl transition-all duration-200 cursor-pointer',
        isSelected
          ? 'bg-white/10 shadow-lg shadow-white/5'
          : 'hover:bg-white/5'
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowMenu(false);
      }}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-r-full" />
      )}

      <div className="p-3 pl-4">
        <div className="flex items-center gap-3">
          {/* Icon with git warning */}
          <div className="relative">
            <div
              className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all',
                isSelected
                  ? 'bg-gradient-to-br from-blue-500/30 to-purple-500/30 shadow-inner'
                  : 'bg-white/5'
              )}
            >
              📁
            </div>
            {/* Git warning indicator */}
            {project.is_git_repo === false && (
              <button
                onClick={handleGitWarningClick}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition-colors shadow-lg shadow-red-500/50"
                title="Git not initialized"
              >
                <span className="text-[8px] text-white font-bold">!</span>
              </button>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                'text-sm font-medium truncate transition-colors',
                isSelected ? 'text-white' : 'text-white/70'
              )}
            >
              {project.name}
            </p>
            <p className="text-[10px] text-white/30 truncate">{project.path}</p>
          </div>

          {/* Badge or Menu */}
          {isHovered && !showMenu ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(true);
              }}
              className="w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white/70 transition-all"
            >
              ⋯
            </button>
          ) : inProgressCount > 0 ? (
            <div className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-medium">
              {inProgressCount} active
            </div>
          ) : null}
        </div>
      </div>

      {/* Dropdown Menu */}
      {showMenu && (
        <div className="absolute right-2 top-full mt-1 z-50 glass-panel rounded-lg shadow-xl py-1 min-w-[120px]">
          <button
            onClick={handleDeleteClick}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-white/5 transition-colors"
          >
            Delete
          </button>
        </div>
      )}

      {/* Git Init Dialog */}
      {showGitDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowGitDialog(false); setGitError(null); }}
          />
          <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-white/5">
              <h2 className="text-lg font-semibold text-white/90">Initialize Git Repository?</h2>
            </div>
            <div className="p-6">
              <p className="text-white/70 mb-4">
                This project folder is not a Git repository yet. Git enables branch-based development and version control for your work.
              </p>
              <p className="text-white/50 text-sm mb-6">
                Initialize Git to track changes and enable features like worktrees for isolated card development.
              </p>
              {gitError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
                  {gitError}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowGitDialog(false); setGitError(null); }}
                  className="flex-1 glass-button-secondary"
                  disabled={isInitializing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleInitGit}
                  className="flex-1 glass-button-primary"
                  disabled={isInitializing}
                >
                  {isInitializing ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Initializing...
                    </span>
                  ) : (
                    'Initialize Git'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Project Dialog */}
      {showDeleteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDeleteDialog(false)}
          />
          <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-white/5">
              <h2 className="text-xl font-semibold text-white/90">Delete Project</h2>
              <p className="text-sm text-white/40 mt-1">
                This action cannot be undone
              </p>
            </div>
            <div className="p-6">
              <p className="text-white/70 mb-2">
                Are you sure you want to delete this project?
              </p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <p className="text-sm font-medium text-white/90">{project.name}</p>
                <p className="text-xs text-white/50 mt-1">{project.path}</p>
              </div>
              <p className="text-white/50 text-xs mt-3">
                {projectCards.length} card{projectCards.length !== 1 ? 's' : ''} will be deleted
              </p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 glass-button-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-all bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20"
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
