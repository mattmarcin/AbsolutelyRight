import { useState } from 'react';
import type { Project } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useCardStore } from '../../stores/cardStore';
import { cn } from '../../lib/utils';

interface ProjectItemProps {
  project: Project;
  isSelected: boolean;
  onClick: () => void;
}

export function ProjectItem({ project, isSelected, onClick }: ProjectItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const { deleteProject } = useProjectStore();
  const { cards } = useCardStore();

  const projectCards = cards.filter((c) => c.project_id === project.id);
  const inProgressCount = projectCards.filter((c) => c.status === 'in_progress').length;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      deleteProject(project.id);
    }
    setShowMenu(false);
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
          {/* Icon */}
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
            onClick={handleDelete}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-white/5 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
