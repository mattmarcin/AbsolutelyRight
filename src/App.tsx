import { useEffect } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { CardDetailPanel } from './components/panel/CardDetailPanel';
import { useProjectStore } from './stores/projectStore';
import { useCardStore } from './stores/cardStore';
import { initBackgroundSessionListener } from './lib/backgroundSessions';

function App() {
  // Initialize background session listener on mount
  useEffect(() => {
    initBackgroundSessionListener();
  }, []);
  const { selectedProjectId, projects } = useProjectStore();
  const { activeCardId, cards, setActiveCard } = useCardStore();

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const activeCard = cards.find((c) => c.id === activeCardId);

  const handleCloseCardDetail = () => {
    setActiveCard(null);
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
            <div className="flex-1 overflow-hidden">
              <KanbanBoard project={selectedProject} />
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex items-center justify-center">
            <div className="glass-panel p-12 rounded-3xl text-center max-w-md">
              <div className="text-6xl mb-6">🚀</div>
              <h2 className="text-2xl font-semibold text-white/90 mb-3">
                Welcome to AbsolutelyRight
              </h2>
              <p className="text-white/50 leading-relaxed">
                Create a project to get started. Capture ideas, plan features,
                and let Claude Code implement them while you focus on reviewing.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Full-screen Card Detail Overlay */}
      {activeCard && selectedProject && (
        <CardDetailPanel
          card={activeCard}
          projectPath={selectedProject.path}
          onClose={handleCloseCardDetail}
        />
      )}
    </div>
  );
}

export default App;
