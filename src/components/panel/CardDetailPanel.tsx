import { getPanelModeForStatus } from '../../types';
import type { Card, PanelMode } from '../../types';
import { SplitPanelLayout } from './SplitPanelLayout';
import { CardInfoPane } from './CardInfoPane';
import { IdeasPanel } from './IdeasPanel';
import { SpecPanel } from './SpecPanel';
import { ExecutionPanel } from './ExecutionPanel';
import { ReviewPanel } from './ReviewPanel';
import { ReadOnlyPanel } from './ReadOnlyPanel';

interface CardDetailPanelProps {
  card: Card;
  projectPath: string;
  onClose?: () => void;
}

/**
 * Router component that renders the appropriate panel based on card status.
 * Uses a split-pane layout with card info on the left and chat/execution on the right.
 *
 * Panel modes:
 * - spec: Chat-only for planning (Ideas, Planning)
 * - execution: Full Claude Code execution (Execution)
 * - review: Review completed work, iterate (Review)
 * - readonly: View archived work (Done)
 */
export function CardDetailPanel({ card, projectPath, onClose }: CardDetailPanelProps) {
  const panelMode = getPanelModeForStatus(card.status);

  // Use worktree path if available, otherwise project path
  const effectivePath = card.worktree_path || projectPath;

  return (
    <SplitPanelLayout
      leftPane={<CardInfoPane card={card} />}
      rightPane={renderPanel(panelMode, card, effectivePath)}
      onClose={onClose}
      defaultLeftWidth={400}
      minLeftWidth={300}
      minRightWidth={500}
    />
  );
}

function renderPanel(mode: PanelMode, card: Card, projectPath: string) {
  switch (mode) {
    case 'ideas':
      return <IdeasPanel card={card} projectPath={projectPath} />;
    case 'spec':
      return <SpecPanel card={card} projectPath={projectPath} />;
    case 'execution':
      return <ExecutionPanel card={card} projectPath={projectPath} />;
    case 'review':
      return <ReviewPanel card={card} projectPath={projectPath} />;
    case 'readonly':
      return <ReadOnlyPanel card={card} projectPath={projectPath} />;
    default:
      return <IdeasPanel card={card} projectPath={projectPath} />;
  }
}
