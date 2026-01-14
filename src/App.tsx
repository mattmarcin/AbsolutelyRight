import { useState } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { ChatPanel } from './components/chat/ChatPanel';
import { useProjectStore } from './stores/projectStore';
import { useCardStore } from './stores/cardStore';

function App() {
  const { selectedProjectId, projects } = useProjectStore();
  const { activeCardId, cards } = useCardStore();
  const [terminalHeight, setTerminalHeight] = useState(300);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const activeCard = cards.find((c) => c.id === activeCardId);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.max(150, Math.min(600, startHeight + delta));
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="h-screen w-screen flex bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden">
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {selectedProject ? (
          <>
            {/* Kanban Board */}
            <div
              className="flex-1 overflow-hidden"
              style={{ height: activeCard ? `calc(100% - ${terminalHeight}px)` : '100%' }}
            >
              <KanbanBoard project={selectedProject} />
            </div>

            {/* Terminal Panel */}
            {activeCard && (
              <>
                {/* Resize Handle */}
                <div
                  className="h-1 bg-white/5 hover:bg-blue-500/50 cursor-row-resize transition-colors relative group"
                  onMouseDown={handleResizeStart}
                >
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-12 h-1 bg-white/20 rounded-full" />
                  </div>
                </div>

                {/* Chat Panel */}
                <div style={{ height: terminalHeight }}>
                  <ChatPanel
                    card={activeCard}
                    projectPath={selectedProject.path}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex items-center justify-center">
            <div className="glass-panel p-12 rounded-3xl text-center max-w-md">
              <div className="text-6xl mb-6">🚀</div>
              <h2 className="text-2xl font-semibold text-white/90 mb-3">
                Welcome to Claude Kanban
              </h2>
              <p className="text-white/50 leading-relaxed">
                Create a project in the sidebar to get started. Each project can have
                features, bugs, and tasks that you can work on with Claude Code.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
