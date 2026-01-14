import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Card, CardStatus, ClaudeStatus } from '../types';
import { killSessionsForCard } from '../lib/tauri-commands';

interface CardState {
  cards: Card[];
  activeCardId: string | null;

  // Actions
  addCard: (card: Card) => void;
  updateCard: (id: string, updates: Partial<Card>) => void;
  deleteCard: (id: string) => void;
  moveCard: (id: string, status: CardStatus, position: number) => void;
  setActiveCard: (id: string | null) => void;
  setCards: (cards: Card[]) => void;
  updateClaudeStatus: (cardId: string, status: ClaudeStatus) => void;
  getCardsByProject: (projectId: string) => Card[];
}

export const useCardStore = create<CardState>()(
  persist(
    (set, get) => ({
      cards: [],
      activeCardId: null,

      addCard: (card) =>
        set((state) => ({
          cards: [...state.cards, card],
        })),

      updateCard: (id, updates) =>
        set((state) => ({
          cards: state.cards.map((c) =>
            c.id === id ? { ...c, ...updates, updated_at: new Date().toISOString() } : c
          ),
        })),

      deleteCard: (id) => {
        // Kill any Claude sessions associated with this card first
        killSessionsForCard(id).catch((err) => {
          console.warn('[CardStore] Failed to kill sessions for card:', err);
        });

        set((state) => ({
          cards: state.cards.filter((c) => c.id !== id),
          activeCardId: state.activeCardId === id ? null : state.activeCardId,
        }));
      },

      moveCard: (id, status, position) =>
        set((state) => ({
          cards: state.cards.map((c) =>
            c.id === id
              ? { ...c, status, position, updated_at: new Date().toISOString() }
              : c
          ),
        })),

      setActiveCard: (id) => set({ activeCardId: id }),

      setCards: (cards) => set({ cards }),

      updateClaudeStatus: (cardId, status) =>
        set((state) => ({
          cards: state.cards.map((c) =>
            c.id === cardId ? { ...c, claude_status: status } : c
          ),
        })),

      getCardsByProject: (projectId) => {
        return get().cards.filter((c) => c.project_id === projectId);
      },
    }),
    {
      name: 'absolutely-right-cards',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
