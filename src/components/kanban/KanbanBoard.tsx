import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  CollisionDetection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { AddCardDialog } from './AddCardDialog';
import { PullRequestDialog } from '../pr/PullRequestDialog';
import { MergeDialog } from '../merge/MergeDialog';
import { useCardStore } from '../../stores/cardStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useChatStore } from '../../stores/chatStore';
import { createWorktree, removeWorktree, getGitInfo, initGitRepo } from '../../lib/tauri-commands';
import { startBackgroundSession } from '../../lib/backgroundSessions';
import type { Project, CardStatus, Card } from '../../types';

const COLUMNS: { status: CardStatus; label: string }[] = [
  { status: 'backlog', label: 'Ideas' },
  { status: 'todo', label: 'Planning' },
  { status: 'in_progress', label: 'Execution' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
];

const COLUMN_IDS = new Set(['backlog', 'todo', 'in_progress', 'review', 'done']);

// Custom collision detection that prefers cards when directly over them,
// but falls back to columns for empty space
const customCollisionDetection: CollisionDetection = (args) => {
  // First, check if we're directly over any cards using rectIntersection
  const rectCollisions = rectIntersection(args);

  // If we have card collisions (non-column IDs), prefer those
  const cardCollisions = rectCollisions.filter(
    collision => !COLUMN_IDS.has(collision.id as string)
  );

  if (cardCollisions.length > 0) {
    return cardCollisions;
  }

  // If no card collisions, check pointer position within columns
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  // Fallback to rect intersection (includes columns)
  return rectCollisions;
};

// Column index for determining forward/backward moves
const COLUMN_ORDER: Record<CardStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  review: 3,
  done: 4,
};

// Transition rules: which transitions are allowed
interface TransitionResult {
  allowed: boolean;
  requiresConfirmation?: boolean;
  message?: string;
}

function checkTransition(from: CardStatus, to: CardStatus): TransitionResult {
  // Same column is always allowed
  if (from === to) return { allowed: true };

  const fromIdx = COLUMN_ORDER[from];
  const toIdx = COLUMN_ORDER[to];
  const isForward = toIdx > fromIdx;

  // Forward transitions
  if (isForward) {
    // Ideas can only go to Planning (one step at a time)
    if (from === 'backlog' && to !== 'todo') {
      return {
        allowed: false,
        message: `Ideas must first go through Planning before ${COLUMNS.find(c => c.status === to)?.label || to}`,
      };
    }

    // Planning can only go to Execution
    if (from === 'todo' && to !== 'in_progress') {
      return {
        allowed: false,
        message: 'Planning cards must go through Execution',
      };
    }

    // Execution to Review is auto (but manual is OK too)
    // Review to Done is allowed

    return { allowed: true };
  }

  // Backward transitions need confirmation
  if (!isForward) {
    if (from === 'todo' && to === 'backlog') {
      return {
        allowed: true,
        requiresConfirmation: true,
        message: 'Moving back to Ideas will clear the plan. Continue?',
      };
    }

    if (from === 'in_progress' && to === 'todo') {
      return {
        allowed: true,
        requiresConfirmation: true,
        message: 'Moving back to Planning will stop execution. Continue?',
      };
    }

    // Review back to Execution is OK (re-run)
    if (from === 'review' && to === 'in_progress') {
      return { allowed: true };
    }

    // Done back to Review (reopen)
    if (from === 'done' && to === 'review') {
      return { allowed: true };
    }

    // Other backward moves are blocked
    return {
      allowed: false,
      message: 'This transition is not allowed',
    };
  }

  return { allowed: true };
}

interface KanbanBoardProps {
  project: Project;
}

export function KanbanBoard({ project }: KanbanBoardProps) {
  const { cards, moveCard, updateCard, updateClaudeStatus } = useCardStore();
  const { recordTransition } = useWorkflowStore();
  const { clearSession } = useChatStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addToColumn, setAddToColumn] = useState<CardStatus>('backlog');
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<{
    cardId: string;
    toStatus: CardStatus;
    position: number;
    message: string;
  } | null>(null);
  const [prDialogCard, setPrDialogCard] = useState<Card | null>(null);
  const [mergeDialogCard, setMergeDialogCard] = useState<Card | null>(null);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [gitInitPrompt, setGitInitPrompt] = useState<{
    cardData: Card;
    toStatus: CardStatus;
    position: number;
  } | null>(null);

  const projectCards = cards.filter((c) => c.project_id === project.id);
  const activeCard = projectCards.find((c) => c.id === activeId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Execute the actual move with worktree operations
  const executeMove = useCallback(async (
    cardData: Card,
    toStatus: CardStatus,
    position: number,
    skipWorktree: boolean = false
  ) => {
    const fromStatus = cardData.status;
    console.log('[KanbanBoard] executeMove:', { from: fromStatus, to: toStatus, skipWorktree });

    // Clear chat session and reset Claude status when changing columns
    if (fromStatus !== toStatus) {
      clearSession(cardData.id);
      updateClaudeStatus(cardData.id, 'idle');
    }

    // Handle worktree creation: Ideas → Planning
    if (fromStatus === 'backlog' && toStatus === 'todo' && !skipWorktree) {
      setIsCreatingWorktree(true);
      try {
        // First check if it's a git repo
        console.log('[KanbanBoard] Checking git status for:', project.path);
        const gitInfo = await getGitInfo(project.path);
        console.log('[KanbanBoard] Git info:', gitInfo);
        if (!gitInfo.is_git_repo) {
          // Prompt user to initialize git
          console.log('[KanbanBoard] Not a git repo, showing init prompt');
          setGitInitPrompt({ cardData, toStatus, position });
          setIsCreatingWorktree(false);
          return;
        }
        console.log('[KanbanBoard] Is git repo, proceeding with worktree creation');

        const result = await createWorktree(
          project.path,
          cardData.id,
          cardData.title,
          cardData.card_type,
          undefined // Use default branch
        );
        updateCard(cardData.id, {
          worktree_path: result.worktree_path,
          branch_name: result.branch_name,
          base_branch: result.base_branch,
          worktree_status: 'ready',
        });
      } catch (err) {
        setBlockedMessage(`Failed to create worktree: ${err}`);
        setTimeout(() => setBlockedMessage(null), 5000);
        setIsCreatingWorktree(false);
        return;
      }
      setIsCreatingWorktree(false);
    }

    // Handle worktree cleanup: Planning → Ideas (backward)
    if (fromStatus === 'todo' && toStatus === 'backlog' && cardData.worktree_path) {
      try {
        await removeWorktree(project.path, cardData.worktree_path);
        updateCard(cardData.id, {
          worktree_path: undefined,
          branch_name: undefined,
          base_branch: undefined,
          worktree_status: 'cleaned',
          planContent: undefined,
        });
      } catch (err) {
        console.warn('Failed to clean up worktree:', err);
      }
    }

    // Handle merge dialog: Review → Done (when card has a worktree)
    if (fromStatus === 'review' && toStatus === 'done' && cardData.worktree_path) {
      setMergeDialogCard(cardData);
      return; // Don't move yet - Merge dialog will handle it
    }

    // Move the card
    moveCard(cardData.id, toStatus, position);
    recordTransition({
      cardId: cardData.id,
      fromStatus,
      toStatus,
      triggeredBy: 'user_drag',
      timestamp: new Date().toISOString(),
    });

    // Auto-start Claude sessions for relevant transitions
    // Use updated card data with new status
    const updatedCard = { ...cardData, status: toStatus };

    // Use worktree path if available, otherwise project path
    const sessionPath = updatedCard.worktree_path || project.path;

    // Ideas → Planning: Start planning session
    if (fromStatus === 'backlog' && toStatus === 'todo') {
      setTimeout(() => {
        startBackgroundSession(updatedCard, sessionPath, 'planning');
      }, 100);
    }

    // Planning → Execution: Start execution session
    if (fromStatus === 'todo' && toStatus === 'in_progress') {
      setTimeout(() => {
        startBackgroundSession(updatedCard, sessionPath, 'execution');
      }, 100);
    }

    // Execution → Review: Start review session
    if (fromStatus === 'in_progress' && toStatus === 'review') {
      setTimeout(() => {
        startBackgroundSession(updatedCard, sessionPath, 'review');
      }, 100);
    }
  }, [moveCard, recordTransition, updateCard, updateClaudeStatus, clearSession, project.path]);

  // Attempt to move a card, checking transition rules
  const attemptMove = useCallback((
    card: { id: string; status: CardStatus },
    toStatus: CardStatus,
    position: number
  ) => {
    if (card.status === toStatus) {
      moveCard(card.id, toStatus, position);
      return;
    }

    const result = checkTransition(card.status, toStatus);

    if (!result.allowed) {
      setBlockedMessage(result.message || 'This transition is not allowed');
      setTimeout(() => setBlockedMessage(null), 3000);
      return;
    }

    // Find the full card object
    const fullCard = cards.find((c) => c.id === card.id);
    if (!fullCard) return;

    if (result.requiresConfirmation) {
      setPendingTransition({
        cardId: card.id,
        toStatus,
        position,
        message: result.message || 'Are you sure?',
      });
      return;
    }

    // Allowed without confirmation - execute the move
    executeMove(fullCard, toStatus, position);
  }, [moveCard, cards, executeMove]);

  const handleConfirmTransition = useCallback(() => {
    if (!pendingTransition) return;

    const card = cards.find((c) => c.id === pendingTransition.cardId);
    if (card) {
      executeMove(card, pendingTransition.toStatus, pendingTransition.position);
    }
    setPendingTransition(null);
  }, [pendingTransition, cards, executeMove]);

  const handleCancelTransition = useCallback(() => {
    setPendingTransition(null);
  }, []);

  const handlePrDialogClose = useCallback(() => {
    setPrDialogCard(null);
  }, []);

  const handlePrSuccess = useCallback((prUrl: string) => {
    if (!prDialogCard) return;

    // Update card with PR info and move to done
    updateCard(prDialogCard.id, {
      pr_url: prUrl,
      worktree_status: 'cleaned',
      worktree_path: undefined,
    });

    moveCard(prDialogCard.id, 'done', 0);
    recordTransition({
      cardId: prDialogCard.id,
      fromStatus: 'review',
      toStatus: 'done',
      triggeredBy: 'user_drag',
      timestamp: new Date().toISOString(),
    });

    setPrDialogCard(null);
  }, [prDialogCard, updateCard, moveCard, recordTransition]);

  // Handle merge dialog
  const handleMergeDialogClose = useCallback(() => {
    setMergeDialogCard(null);
  }, []);

  const handleMergeSuccess = useCallback(() => {
    if (!mergeDialogCard) return;

    // Update card and move to done
    updateCard(mergeDialogCard.id, {
      worktree_status: 'cleaned',
      worktree_path: undefined,
      branch_name: undefined,
    });

    moveCard(mergeDialogCard.id, 'done', 0);
    recordTransition({
      cardId: mergeDialogCard.id,
      fromStatus: 'review',
      toStatus: 'done',
      triggeredBy: 'user_drag',
      timestamp: new Date().toISOString(),
    });

    setMergeDialogCard(null);
  }, [mergeDialogCard, updateCard, moveCard, recordTransition]);

  const handleSwitchToPR = useCallback(() => {
    // Switch from merge dialog to PR dialog
    if (mergeDialogCard) {
      setPrDialogCard(mergeDialogCard);
      setMergeDialogCard(null);
    }
  }, [mergeDialogCard]);

  // Handle git init confirmation
  const handleGitInitAccept = useCallback(async () => {
    if (!gitInitPrompt) return;

    setIsCreatingWorktree(true);
    try {
      // Initialize git repo using Tauri command
      await initGitRepo(project.path);

      // Now create the worktree
      const worktreeResult = await createWorktree(
        project.path,
        gitInitPrompt.cardData.id,
        gitInitPrompt.cardData.title,
        gitInitPrompt.cardData.card_type,
        undefined
      );

      updateCard(gitInitPrompt.cardData.id, {
        worktree_path: worktreeResult.worktree_path,
        branch_name: worktreeResult.branch_name,
        base_branch: worktreeResult.base_branch,
        worktree_status: 'ready',
      });

      // Clear session and move
      clearSession(gitInitPrompt.cardData.id);
      updateClaudeStatus(gitInitPrompt.cardData.id, 'idle');
      moveCard(gitInitPrompt.cardData.id, gitInitPrompt.toStatus, gitInitPrompt.position);
      recordTransition({
        cardId: gitInitPrompt.cardData.id,
        fromStatus: gitInitPrompt.cardData.status,
        toStatus: gitInitPrompt.toStatus,
        triggeredBy: 'user_drag',
        timestamp: new Date().toISOString(),
      });

      // Auto-start planning session after move
      if (gitInitPrompt.toStatus === 'todo') {
        const updatedCard = { ...gitInitPrompt.cardData, status: gitInitPrompt.toStatus };
        setTimeout(() => {
          startBackgroundSession(updatedCard, project.path, 'planning');
        }, 100);
      }
    } catch (err) {
      setBlockedMessage(`Failed to initialize git: ${err}`);
      setTimeout(() => setBlockedMessage(null), 5000);
    } finally {
      setIsCreatingWorktree(false);
      setGitInitPrompt(null);
    }
  }, [gitInitPrompt, project.path, updateCard, clearSession, updateClaudeStatus, moveCard, recordTransition]);

  const handleGitInitDecline = useCallback(() => {
    if (!gitInitPrompt) return;

    // Move without worktree - planning will work but no branch isolation
    clearSession(gitInitPrompt.cardData.id);
    updateClaudeStatus(gitInitPrompt.cardData.id, 'idle');
    moveCard(gitInitPrompt.cardData.id, gitInitPrompt.toStatus, gitInitPrompt.position);
    recordTransition({
      cardId: gitInitPrompt.cardData.id,
      fromStatus: gitInitPrompt.cardData.status,
      toStatus: gitInitPrompt.toStatus,
      triggeredBy: 'user_drag',
      timestamp: new Date().toISOString(),
    });

    // Auto-start planning session after move
    if (gitInitPrompt.toStatus === 'todo') {
      const updatedCard = { ...gitInitPrompt.cardData, status: gitInitPrompt.toStatus };
      setTimeout(() => {
        startBackgroundSession(updatedCard, project.path, 'planning');
      }, 100);
    }

    setGitInitPrompt(null);
  }, [gitInitPrompt, clearSession, updateClaudeStatus, moveCard, recordTransition, project.path]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (_event: DragOverEvent) => {
    // Don't move cards during drag - only move on drop in handleDragEnd
    // This ensures all transitions go through executeMove for proper git/worktree handling
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    console.log('[DragEnd] active:', active?.id, 'over:', over?.id);

    if (!over) {
      console.log('[DragEnd] No over target, aborting');
      return;
    }

    const draggedCard = projectCards.find((c) => c.id === active.id);
    if (!draggedCard) {
      console.log('[DragEnd] Dragged card not found, aborting');
      return;
    }

    // Check if dropping on a column
    const overColumn = COLUMNS.find((col) => col.status === over.id);
    console.log('[DragEnd] overColumn:', overColumn?.status, 'draggedCard.status:', draggedCard.status);
    if (overColumn && draggedCard.status !== overColumn.status) {
      console.log('[DragEnd] Dropping on column:', overColumn.status);
      attemptMove(draggedCard, overColumn.status, 0);
      return;
    }

    // Check if dropping on another card
    const overCard = projectCards.find((c) => c.id === over.id);
    console.log('[DragEnd] overCard:', overCard?.id, 'overCard status:', overCard?.status);
    if (overCard) {
      if (draggedCard.status !== overCard.status) {
        console.log('[DragEnd] Dropping on card in different column:', overCard.status);
        attemptMove(draggedCard, overCard.status, overCard.position);
      } else if (active.id !== over.id) {
        // Same column, just reorder
        console.log('[DragEnd] Reordering within column');
        moveCard(draggedCard.id, overCard.status, overCard.position);
      }
    }
  };

  const handleAddCard = (_status: CardStatus) => {
    // Cards can only be created in Ideas
    setAddToColumn('backlog');
    setIsAddDialogOpen(true);
  };

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white/90">{project.name}</h2>
            <p className="text-sm text-white/40 mt-0.5">{project.path}</p>
          </div>
          <button
            onClick={() => handleAddCard('backlog')}
            className="glass-button-primary"
          >
            + Add Idea
          </button>
        </div>

        {/* Board */}
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
            <div className="flex gap-4 h-full min-w-max">
              {COLUMNS.map((column) => (
                <KanbanColumn
                  key={column.status}
                  status={column.status}
                  label={column.label}
                  cards={projectCards
                    .filter((c) => c.status === column.status)
                    .sort((a, b) => a.position - b.position)}
                  onAddCard={() => handleAddCard(column.status)}
                />
              ))}
            </div>
          </div>

          <DragOverlay>
            {activeCard ? (
              <div className="drag-overlay">
                <KanbanCard card={activeCard} isDragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {isAddDialogOpen && (
        <AddCardDialog
          projectId={project.id}
          projectPath={project.path}
          initialStatus={addToColumn}
          onClose={() => setIsAddDialogOpen(false)}
        />
      )}

      {/* Blocked transition toast */}
      {blockedMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
          <div className="glass-panel px-6 py-3 rounded-xl border border-red-500/20 bg-red-500/10">
            <div className="flex items-center gap-3">
              <span className="text-red-400">✕</span>
              <span className="text-sm text-white/80">{blockedMessage}</span>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation dialog for backward transitions */}
      {pendingTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleCancelTransition}
          />
          <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-white/5">
              <h2 className="text-lg font-semibold text-white/90">Confirm Move</h2>
            </div>
            <div className="p-6">
              <p className="text-white/70 mb-6">{pendingTransition.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={handleCancelTransition}
                  className="flex-1 glass-button-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmTransition}
                  className="flex-1 glass-button-primary"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Merge Dialog */}
      {mergeDialogCard && (
        <MergeDialog
          card={mergeDialogCard}
          projectPath={project.path}
          onClose={handleMergeDialogClose}
          onSuccess={handleMergeSuccess}
          onCreatePR={handleSwitchToPR}
        />
      )}

      {/* PR Dialog */}
      {prDialogCard && (
        <PullRequestDialog
          card={prDialogCard}
          projectPath={project.path}
          onClose={handlePrDialogClose}
          onSuccess={handlePrSuccess}
        />
      )}

      {/* Git Init Prompt Dialog */}
      {gitInitPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setGitInitPrompt(null)}
          />
          <div className="relative glass-panel rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-white/5">
              <h2 className="text-lg font-semibold text-white/90">Initialize Git Repository?</h2>
            </div>
            <div className="p-6">
              <p className="text-white/70 mb-4">
                This project is not a Git repository. Git is required for branch-based planning with worktrees.
              </p>
              <p className="text-white/50 text-sm mb-6">
                You can initialize Git now, or proceed without it (planning will still work, but without branch isolation).
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleGitInitDecline}
                  className="flex-1 glass-button-secondary"
                >
                  Skip Git
                </button>
                <button
                  onClick={handleGitInitAccept}
                  className="flex-1 glass-button-primary"
                >
                  Initialize Git
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Worktree creation loading indicator */}
      {isCreatingWorktree && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
          <div className="glass-panel px-6 py-3 rounded-xl border border-blue-500/20 bg-blue-500/10">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-white/80">Creating worktree and branch...</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
