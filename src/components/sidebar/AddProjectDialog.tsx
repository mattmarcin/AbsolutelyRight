import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { generateId } from '../../lib/utils';
import type { Project } from '../../types';

interface AddProjectDialogProps {
  onClose: () => void;
}

export function AddProjectDialog({ onClose }: AddProjectDialogProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const { addProject } = useProjectStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;

    const project: Project = {
      id: generateId(),
      name: name.trim(),
      path: path.trim(),
      description: description.trim() || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    addProject(project);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5">
          <h2 className="text-xl font-semibold text-white/90">New Project</h2>
          <p className="text-sm text-white/40 mt-1">
            Add a project to start working with Claude Code
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Project"
              className="glass-input w-full"
              autoFocus
            />
          </div>

          {/* Path */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Project Path
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/project"
              className="glass-input w-full"
            />
            <p className="text-xs text-white/30 mt-1.5">
              The directory where Claude Code will run
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Description <span className="text-white/30">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of your project..."
              className="glass-input w-full h-20 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 glass-button-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !path.trim()}
              className="flex-1 glass-button-primary"
            >
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
