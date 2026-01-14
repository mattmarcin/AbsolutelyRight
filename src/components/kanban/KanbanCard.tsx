import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '../../types';
import { useCardStore } from '../../stores/cardStore';
import { cn, getCardTypeColor, getClaudeStatusColor, getClaudeStatusLabel } from '../../lib/utils';

interface KanbanCardProps {
  card: Card;
  isDragging?: boolean;
}

export function KanbanCard({ card, isDragging }: KanbanCardProps) {
  const { activeCardId, setActiveCard, deleteCard } = useCardStore();
  const isActive = activeCardId === card.id;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => {
    setActiveCard(isActive ? null : card.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this card?')) {
      deleteCard(card.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={cn(
        'glass-panel-card group rounded-xl p-3 cursor-pointer transition-all duration-200',
        'hover:bg-white/10 hover:shadow-lg hover:shadow-black/20',
        isActive && 'ring-2 ring-blue-500/50 bg-white/10',
        (isDragging || isSortableDragging) && 'opacity-50 scale-105',
      )}
    >
      {/* Top Row: Type Badge + Claude Status */}
      <div className="flex items-center justify-between mb-2">
        <span
          className={cn(
            'text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize',
            getCardTypeColor(card.card_type)
          )}
        >
          {card.card_type}
        </span>

        {/* Claude Status Indicator */}
        {card.claude_status !== 'idle' && (
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                getClaudeStatusColor(card.claude_status)
              )}
            />
            <span className="text-[10px] text-white/50">
              {getClaudeStatusLabel(card.claude_status)}
            </span>
          </div>
        )}
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-white/90 mb-1 line-clamp-2">
        {card.title}
      </h4>

      {/* Description */}
      {card.description && (
        <p className="text-xs text-white/40 line-clamp-2 mb-2">
          {card.description}
        </p>
      )}

      {/* Bottom Row: Actions */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
        {card.prompt ? (
          <span className="text-[10px] text-white/30 flex items-center gap-1">
            <span>📝</span> Has prompt
          </span>
        ) : (
          <span />
        )}

        {/* Delete button (visible on hover) */}
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 text-xs transition-opacity"
        >
          Delete
        </button>
      </div>

      {/* Active indicator */}
      {isActive && (
        <div className="mt-2 pt-2 border-t border-white/10">
          <p className="text-[10px] text-blue-400 flex items-center gap-1">
            <span>⚡</span> Terminal active
          </p>
        </div>
      )}
    </div>
  );
}
