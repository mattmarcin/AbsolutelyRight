import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { ProjectItem } from './ProjectItem';
import { AddProjectDialog } from './AddProjectDialog';

export function Sidebar() {
  const { projects, selectedProjectId, setSelectedProject } = useProjectStore();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  return (
    <>
      <aside className="w-72 h-full flex flex-col border-r border-white/5 relative">
        {/* Glass background */}
        <div className="absolute inset-0 bg-white/[0.02] backdrop-blur-xl" />

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Header */}
          <div className="p-5 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <span className="text-lg">⚡</span>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white/90">AbsolutelyRight</h1>
                <p className="text-xs text-white/40">AI development collaboration</p>
              </div>
            </div>
          </div>

          {/* Projects Header */}
          <div className="px-5 py-4 flex items-center justify-between">
            <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Projects
            </span>
            <button
              onClick={() => setIsAddDialogOpen(true)}
              className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white/90 transition-all hover:scale-110"
            >
              <span className="text-sm">+</span>
            </button>
          </div>

          {/* Projects List */}
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            {projects.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <p className="text-white/30 text-sm">No projects yet</p>
                <button
                  onClick={() => setIsAddDialogOpen(true)}
                  className="mt-3 text-blue-400/80 hover:text-blue-400 text-sm transition-colors"
                >
                  Create your first project
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {projects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    isSelected={project.id === selectedProjectId}
                    onClick={() => setSelectedProject(project.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/5">
            <div className="glass-panel-subtle rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                <span className="text-sm">🤖</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/70 truncate">Claude Code</p>
                <p className="text-[10px] text-white/40">Ready</p>
              </div>
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-lg shadow-green-500/50" />
            </div>
          </div>
        </div>
      </aside>

      {isAddDialogOpen && (
        <AddProjectDialog onClose={() => setIsAddDialogOpen(false)} />
      )}
    </>
  );
}
