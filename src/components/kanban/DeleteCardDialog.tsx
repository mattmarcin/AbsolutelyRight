import type { Card } from '../../types';

interface DeleteCardDialogProps {
  card: Card;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteCardDialog({ card, onConfirm, onCancel }: DeleteCardDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden bg-slate-900/95 backdrop-blur-xl border border-white/10">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5">
          <h2 className="text-xl font-semibold text-white/90">Delete Card</h2>
          <p className="text-sm text-white/40 mt-1">
            This action cannot be undone
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-white/70 mb-2">
            Are you sure you want to delete this card?
          </p>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm font-medium text-white/90">{card.title}</p>
            {card.description && (
              <p className="text-xs text-white/50 mt-1 line-clamp-2">
                {card.description}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 glass-button-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-all bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
