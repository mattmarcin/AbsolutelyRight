import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useCardStore } from '../../stores/cardStore';
import { MessageGroup } from '../chat/MessageGroup';
import type { Card } from '../../types';

interface ReadOnlyPanelProps {
  card: Card;
  projectPath: string; // Required for interface consistency but not used in this read-only panel
}

/**
 * ReadOnlyPanel - Read-only view for completed (Done) cards.
 * Shows the full conversation history without interaction.
 * Allows reopening if needed.
 */
export function ReadOnlyPanel({ card, projectPath: _projectPath }: ReadOnlyPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { getSessionByCardId, getConversationTurns } = useChatStore();
  const { moveCard } = useCardStore();

  const session = getSessionByCardId(card.id);
  const turns = session ? getConversationTurns(session.id) : [];

  // Scroll to bottom initially
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleReopen = () => {
    moveCard(card.id, 'review', 0);
  };

  // Calculate summary stats
  const totalTools = turns.reduce((sum, t) => sum + t.tools.length, 0);
  const completedTools = turns.reduce(
    (sum, t) => sum + t.tools.filter((tool) => tool.status === 'completed').length,
    0
  );

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.8)] backdrop-blur-xl">
      {/* Header */}
      <div className="panel-header-readonly flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="text-xs">✓</span>
            </div>
            <span className="text-sm text-green-400">Completed</span>
          </div>
          <span className="text-xs text-white/30">|</span>
          <span className="text-sm text-white/80">{card.title}</span>
        </div>

        <div className="flex items-center gap-2">
          {session?.totalCostUsd ? (
            <span className="text-xs text-white/30 mr-2">
              ${session.totalCostUsd.toFixed(4)}
            </span>
          ) : null}

          <button
            onClick={handleReopen}
            className="px-3 py-1 text-xs text-purple-400/60 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-all"
          >
            Reopen for Review
          </button>
        </div>
      </div>

      {/* Summary Banner */}
      <div className="px-4 py-3 bg-green-500/5 border-b border-green-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-white/80">{turns.length}</div>
              <div className="text-xs text-white/40">Turns</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-center">
              <div className="text-lg font-semibold text-white/80">{completedTools}/{totalTools}</div>
              <div className="text-xs text-white/40">Tools</div>
            </div>
            {session?.totalCostUsd ? (
              <>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-400/80">
                    ${session.totalCostUsd.toFixed(2)}
                  </div>
                  <div className="text-xs text-white/40">Total Cost</div>
                </div>
              </>
            ) : null}
            {session?.createdAt && (
              <>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <div className="text-sm font-medium text-white/60">
                    {new Date(session.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-white/40">Completed</div>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 rounded-lg">
            <span className="text-green-400">✓</span>
            <span className="text-xs text-green-400/80">Task completed successfully</span>
          </div>
        </div>
      </div>

      {/* Messages (read-only) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {turns.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/30 max-w-md">
              <div className="text-4xl mb-4">✓</div>
              <p className="text-lg mb-2">Task completed</p>
              <p className="text-sm">
                No conversation history available for this card.
              </p>
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <MessageGroup key={turn.id} turn={turn} turnNumber={index + 1} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer (no input for read-only) */}
      <div className="px-4 py-3 border-t border-white/5 bg-black/20">
        <div className="flex items-center justify-between text-xs text-white/30">
          <span>Read-only view • Task has been completed</span>
          <button
            onClick={handleReopen}
            className="text-purple-400/60 hover:text-purple-400 transition-colors"
          >
            Need changes? Reopen for review →
          </button>
        </div>
      </div>
    </div>
  );
}
