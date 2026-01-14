import { useState, useRef, useCallback, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface SplitPanelLayoutProps {
  leftPane: ReactNode;
  rightPane: ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
  onClose?: () => void;
}

/**
 * SplitPanelLayout - A resizable split-pane container
 * Left pane shows card info/plan, right pane shows chat interface
 */
export function SplitPanelLayout({
  leftPane,
  rightPane,
  defaultLeftWidth = 400,
  minLeftWidth = 280,
  minRightWidth = 400,
  onClose,
}: SplitPanelLayoutProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;
    const startWidth = leftWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const delta = moveEvent.clientX - startX;
      const newWidth = startWidth + delta;

      // Constrain to min widths
      const maxLeftWidth = containerWidth - minRightWidth;
      const constrainedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newWidth));

      setLeftWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [leftWidth, minLeftWidth, minRightWidth]);

  // Handle keyboard shortcut to close
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) {
      onClose();
    }
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Backdrop - click to close */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel container - 85% of screen */}
      <div
        ref={containerRef}
        className="relative w-[92%] h-[88%] flex rounded-2xl overflow-hidden shadow-2xl border border-white/10"
      >
        {/* Left Pane */}
        <div
          className="split-panel-left h-full bg-[rgba(10,10,20,0.98)]"
          style={{ width: leftWidth, flexShrink: 0 }}
        >
          {leftPane}
        </div>

        {/* Resizable Divider */}
        <div
          className={cn(
            'split-panel-divider relative group',
            isDragging && 'bg-blue-500/50'
          )}
          onMouseDown={handleMouseDown}
        >
          {/* Visual handle */}
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 flex items-center justify-center">
            <div className={cn(
              'w-1 h-8 rounded-full transition-colors',
              isDragging ? 'bg-blue-400' : 'bg-white/20 group-hover:bg-white/40'
            )} />
          </div>
        </div>

        {/* Right Pane */}
        <div className="split-panel-right h-full flex-1 min-w-0 bg-[rgba(10,10,20,0.95)]">
          {rightPane}
        </div>
      </div>
    </div>
  );
}
