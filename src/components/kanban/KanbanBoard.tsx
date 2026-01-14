import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { AddCardDialog } from './AddCardDialog';
import { useCardStore } from '../../stores/cardStore';
import type { Project, CardStatus } from '../../types';

const COLUMNS: { status: CardStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
];

interface KanbanBoardProps {
  project: Project;
}

export function KanbanBoard({ project }: KanbanBoardProps) {
  const { cards, moveCard } = useCardStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addToColumn, setAddToColumn] = useState<CardStatus>('backlog');

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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeCard = projectCards.find((c) => c.id === active.id);
    if (!activeCard) return;

    // Check if dropping on a column
    const overColumn = COLUMNS.find((col) => col.status === over.id);
    if (overColumn && activeCard.status !== overColumn.status) {
      moveCard(activeCard.id, overColumn.status, 0);
    }

    // Check if dropping on another card
    const overCard = projectCards.find((c) => c.id === over.id);
    if (overCard && activeCard.status !== overCard.status) {
      moveCard(activeCard.id, overCard.status, overCard.position);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeCard = projectCards.find((c) => c.id === active.id);
    if (!activeCard) return;

    // Final position update
    const overCard = projectCards.find((c) => c.id === over.id);
    if (overCard && active.id !== over.id) {
      moveCard(activeCard.id, overCard.status, overCard.position);
    }
  };

  const handleAddCard = (status: CardStatus) => {
    setAddToColumn(status);
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
            + Add Card
          </button>
        </div>

        {/* Board */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
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
          initialStatus={addToColumn}
          onClose={() => setIsAddDialogOpen(false)}
        />
      )}
    </>
  );
}
