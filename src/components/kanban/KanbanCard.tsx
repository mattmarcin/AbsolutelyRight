import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '../../types';
import { useCardStore } from '../../stores/cardStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { cn, getCardTypeColor, getClaudeStatusColor, getClaudeStatusLabel } from '../../lib/utils';
import { DeleteCardDialog } from './DeleteCardDialog';

interface KanbanCardProps {
  card: Card;
  isDragging?: boolean;
}

export function KanbanCard({ card, isDragging }: KanbanCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { activeCardId, setActiveCard, deleteCard } = useCardStore();
  const { getWorkflowState } = useWorkflowStore();
  const isActive = activeCardId === card.id;
  const workflowState = getWorkflowState(card.id);
  const isReviewHighlighted = workflowState?.reviewHighlighted || card.status === 'review';
  const isBackgroundRunning = workflowState?.isBackgroundRunning || false;

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

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    deleteCard(card.id);
    setShowDeleteDialog(false);
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
        // Status-based styles
        card.status === 'in_progress' && isBackgroundRunning && 'ring-1 ring-amber-500/30',
        isReviewHighlighted && 'ring-2 ring-purple-500/50 animate-pulse-subtle',
        card.status === 'done' && 'opacity-75',
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
          onClick={handleDeleteClick}
          className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 text-xs transition-opacity"
        >
          Delete
        </button>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <DeleteCardDialog
          card={card}
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}

      {/* Status indicator */}
      {(isActive || isBackgroundRunning || card.status === 'done') && (
        <div className="mt-2 pt-2 border-t border-white/10">
          {card.status === 'backlog' || card.status === 'todo' ? (
            <p className="text-[10px] text-blue-400 flex items-center gap-1">
              <span>📋</span> Planning mode
            </p>
          ) : card.status === 'in_progress' ? (
            <p className={cn(
              "text-[10px] flex items-center gap-1",
              isBackgroundRunning ? "text-amber-400" : "text-blue-400"
            )}>
              {isBackgroundRunning ? (
                <>
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                  <span>Claude is working...</span>
                </>
              ) : (
                <>
                  <span>⚡</span> Execution mode
                </>
              )}
            </p>
          ) : card.status === 'review' ? (
            <p className="text-[10px] text-purple-400 flex items-center gap-1">
              <span>👀</span> Ready for review
            </p>
          ) : card.status === 'done' ? (
            <p className="text-[10px] text-green-400 flex items-center gap-1">
              <span>✓</span> Completed
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
