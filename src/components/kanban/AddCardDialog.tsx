import { useState } from 'react';
import { useCardStore } from '../../stores/cardStore';
import { generateId } from '../../lib/utils';
import type { Card, CardType, CardStatus } from '../../types';
import { CARD_TYPES } from '../../types';
import { cn } from '../../lib/utils';

interface AddCardDialogProps {
  projectId: string;
  initialStatus: CardStatus;
  onClose: () => void;
}

export function AddCardDialog({ projectId, initialStatus, onClose }: AddCardDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cardType, setCardType] = useState<CardType>('task');
  const [prompt, setPrompt] = useState('');
  const { addCard, cards } = useCardStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const existingCards = cards.filter(
      (c) => c.project_id === projectId && c.status === initialStatus
    );

    const card: Card = {
      id: generateId(),
      project_id: projectId,
      title: title.trim(),
      description: description.trim() || undefined,
      card_type: cardType,
      status: initialStatus,
      claude_status: 'idle',
      position: existingCards.length,
      prompt: prompt.trim() || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    addCard(card);
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
      <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5">
          <h2 className="text-xl font-semibold text-white/90">New Card</h2>
          <p className="text-sm text-white/40 mt-1">
            Add a feature, bug, or task to work on
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="glass-input w-full"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Type
            </label>
            <div className="flex gap-2">
              {CARD_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setCardType(type.value)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    cardType === type.value
                      ? 'bg-white/15 text-white ring-1 ring-white/20'
                      : 'bg-white/5 text-white/50 hover:bg-white/10'
                  )}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Description <span className="text-white/30">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more details..."
              className="glass-input w-full h-20 resize-none"
            />
          </div>

          {/* Claude Prompt */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">
              Initial Prompt for Claude{' '}
              <span className="text-white/30">(optional)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Implement a user authentication system with JWT tokens..."
              className="glass-input w-full h-24 resize-none font-mono text-sm"
            />
            <p className="text-xs text-white/30 mt-1.5">
              This will be sent to Claude Code when you open this card
            </p>
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
              disabled={!title.trim()}
              className="flex-1 glass-button-primary"
            >
              Create Card
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
