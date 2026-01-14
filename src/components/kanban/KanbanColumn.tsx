import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { KanbanCard } from './KanbanCard';
import type { Card, CardStatus } from '../../types';
import { cn } from '../../lib/utils';

interface KanbanColumnProps {
  status: CardStatus;
  label: string;
  cards: Card[];
  onAddCard: () => void;
}

const columnColors: Record<CardStatus, string> = {
  backlog: 'from-slate-500/20 to-slate-600/10',
  todo: 'from-blue-500/20 to-blue-600/10',
  in_progress: 'from-amber-500/20 to-amber-600/10',
  review: 'from-purple-500/20 to-purple-600/10',
  done: 'from-green-500/20 to-green-600/10',
};

const headerColors: Record<CardStatus, string> = {
  backlog: 'text-slate-400',
  todo: 'text-blue-400',
  in_progress: 'text-amber-400',
  review: 'text-purple-400',
  done: 'text-green-400',
};

export function KanbanColumn({ status, label, cards, onAddCard }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-72 flex-shrink-0 flex flex-col rounded-2xl transition-all duration-200',
        'bg-gradient-to-b',
        columnColors[status],
        isOver && 'ring-2 ring-white/20 scale-[1.02]'
      )}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className={cn('font-semibold', headerColors[status])}>{label}</h3>
          <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs text-white/50">
            {cards.length}
          </span>
        </div>
        <button
          onClick={onAddCard}
          className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white/70 transition-all"
        >
          +
        </button>
      </div>

      {/* Cards */}
      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {cards.length === 0 ? (
            <div className="h-24 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center">
              <p className="text-sm text-white/20">Drop cards here</p>
            </div>
          ) : (
            cards.map((card) => <KanbanCard key={card.id} card={card} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}
