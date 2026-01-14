import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCardStore } from '../../stores/cardStore';
import { PlanViewer } from './PlanViewer';
import { cn } from '../../lib/utils';
import type { Card } from '../../types';
import { CARD_TYPES, CARD_STATUSES } from '../../types';

interface CardInfoPaneProps {
  card: Card;
}

/**
 * CardInfoPane - Left pane content showing card metadata and plan
 * Allows editing title, description, and displays the plan when present
 */
export function CardInfoPane({ card }: CardInfoPaneProps) {
  const { updateCard } = useCardStore();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [isIdeaExpanded, setIsIdeaExpanded] = useState(false);
  const [isPlanExpanded, setIsPlanExpanded] = useState(false);

  const cardType = CARD_TYPES.find((t) => t.value === card.card_type);
  const cardStatus = CARD_STATUSES.find((s) => s.value === card.status);

  const handleTitleSave = () => {
    if (title.trim() && title !== card.title) {
      updateCard(card.id, { title: title.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleDescriptionSave = () => {
    const newDesc = description.trim();
    if (newDesc !== (card.description || '')) {
      updateCard(card.id, { description: newDesc || undefined });
    }
    setIsEditingDescription(false);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    saveHandler: () => void
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveHandler();
    }
    if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setIsEditingDescription(false);
      setTitle(card.title);
      setDescription(card.description || '');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/5">
        <div className="flex items-center gap-2 mb-3">
          {/* Type badge */}
          <span
            className={cn(
              'px-2 py-0.5 rounded text-xs font-medium',
              cardType?.color || 'bg-gray-500',
              'text-white'
            )}
          >
            {cardType?.label || card.card_type}
          </span>

          {/* Status badge */}
          <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-white/60">
            {cardStatus?.label || card.status}
          </span>

          {/* Worktree badge */}
          {card.worktree_status === 'ready' && (
            <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
              Worktree Active
            </span>
          )}

          {/* PR badge */}
          {card.pr_url && (
            <a
              href={card.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
            >
              PR #{card.pr_number}
            </a>
          )}
        </div>

        {/* Title */}
        {isEditingTitle ? (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => handleKeyDown(e, handleTitleSave)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-lg font-semibold text-white/90 focus:outline-none focus:border-blue-500/50"
            autoFocus
          />
        ) : (
          <h2
            onClick={() => setIsEditingTitle(true)}
            className="text-lg font-semibold text-white/90 cursor-pointer hover:text-white transition-colors"
            title="Click to edit"
          >
            {card.title}
          </h2>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <div>
          <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
            Description
          </h3>
          {isEditingDescription ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionSave}
              onKeyDown={(e) => handleKeyDown(e, handleDescriptionSave)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 resize-none h-24 focus:outline-none focus:border-blue-500/50"
              autoFocus
              placeholder="Add a description..."
            />
          ) : (
            <p
              onClick={() => setIsEditingDescription(true)}
              className={cn(
                'text-sm cursor-pointer hover:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors',
                card.description ? 'text-white/70' : 'text-white/30 italic'
              )}
              title="Click to edit"
            >
              {card.description || 'No description. Click to add one.'}
            </p>
          )}
        </div>

        {/* Idea Summary Section */}
        {(card.ideaSummary || card.ideaContent) && (
          <CollapsibleSection
            title="Idea Summary"
            summary={card.ideaSummary}
            fullContent={card.ideaContent}
            isExpanded={isIdeaExpanded}
            onToggle={() => setIsIdeaExpanded(!isIdeaExpanded)}
            statusLabel={card.ideaSummary ? 'Captured' : undefined}
            statusColor="text-green-400"
            emptyIcon="💡"
            emptyMessage="Discuss with Claude to capture the idea"
          />
        )}

        {/* Plan Section */}
        <CollapsibleSection
          title="Implementation Plan"
          summary={card.planSummary}
          fullContent={card.planContent}
          isExpanded={isPlanExpanded}
          onToggle={() => setIsPlanExpanded(!isPlanExpanded)}
          statusLabel={card.planContent ? 'Plan ready' : card.planSummary ? 'Summary ready' : undefined}
          statusColor="text-blue-400"
          emptyIcon="📋"
          emptyMessage={
            card.status === 'backlog'
              ? 'Chat with Claude to flesh out this idea first'
              : card.status === 'todo'
              ? 'Claude is generating an implementation plan...'
              : 'Plan will be generated when moved to Planning'
          }
        />

        {/* Metadata */}
        <div className="pt-4 border-t border-white/5">
          <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
            Details
          </h3>
          <div className="space-y-1 text-xs text-white/40">
            <p>Created: {new Date(card.created_at).toLocaleString()}</p>
            <p>Updated: {new Date(card.updated_at).toLocaleString()}</p>
            {card.branch_name && (
              <p className="font-mono text-white/50">Branch: {card.branch_name}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * CollapsibleSection - A section that shows a summary with option to expand to full content
 */
interface CollapsibleSectionProps {
  title: string;
  summary?: string;
  fullContent?: string;
  isExpanded: boolean;
  onToggle: () => void;
  statusLabel?: string;
  statusColor?: string;
  emptyIcon: string;
  emptyMessage: string;
}

function CollapsibleSection({
  title,
  summary,
  fullContent,
  isExpanded,
  onToggle,
  statusLabel,
  statusColor = 'text-green-400',
  emptyIcon,
  emptyMessage,
}: CollapsibleSectionProps) {
  const hasContent = summary || fullContent;
  const canExpand = fullContent && fullContent !== summary;

  return (
    <div>
      <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
        <span>{title}</span>
        {statusLabel && (
          <span className={cn('text-[10px] font-normal normal-case', statusColor)}>
            {statusLabel}
          </span>
        )}
      </h3>

      {hasContent ? (
        <div className="bg-white/[0.02] rounded-lg border border-white/5 overflow-hidden">
          {/* Summary - always visible when present */}
          {summary && (
            <div className="p-3">
              <div className="markdown-content prose prose-invert prose-sm max-w-none text-white/70">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {summary}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Expand/Collapse button */}
          {canExpand && (
            <button
              onClick={onToggle}
              className="w-full px-3 py-2 text-xs text-white/40 hover:text-white/60 hover:bg-white/5 border-t border-white/5 flex items-center justify-center gap-2 transition-colors"
            >
              <span>{isExpanded ? 'Show less' : 'Show full details'}</span>
              <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
            </button>
          )}

          {/* Full content - shown when expanded */}
          {isExpanded && fullContent && (
            <div className="p-4 border-t border-white/5 bg-white/[0.01]">
              <PlanViewer content={fullContent} />
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white/[0.02] rounded-lg p-6 border border-white/5 text-center">
          <div className="text-3xl mb-2">{emptyIcon}</div>
          <p className="text-sm text-white/40">{emptyMessage}</p>
        </div>
      )}
    </div>
  );
}
