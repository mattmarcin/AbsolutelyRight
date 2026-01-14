import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn, stripAwaitingInputMarker } from '../../lib/utils';
import type { ConversationTurn, ToolUsage } from '../../types';

interface MessageGroupProps {
  turn: ConversationTurn;
  turnNumber: number;
  isExpanded?: boolean;
}

export function MessageGroup({ turn, turnNumber, isExpanded: _isExpanded = true }: MessageGroupProps) {
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const rawCombinedText = turn.assistantMessages.map((m) => m.content).join('');
  const combinedText = stripAwaitingInputMarker(rawCombinedText);
  const hasContent = combinedText.trim().length > 0;
  const completedTools = turn.tools.filter((t) => t.status === 'completed').length;

  return (
    <div
      className={cn(
        'message-group relative pl-4 mb-4',
        turn.isActive && 'message-group-active'
      )}
    >
      {/* Turn indicator line */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-0.5 rounded-full',
          turn.isActive
            ? 'bg-blue-500/60 animate-pulse'
            : 'bg-white/10'
        )}
      />

      {/* Turn header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-white/30">
          Turn {turnNumber} • {new Date(turn.timestamp).toLocaleTimeString()}
        </span>
        {turn.isActive && (
          <span className="flex items-center gap-1.5 text-xs text-blue-400">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            Working...
          </span>
        )}
      </div>

      {/* User message */}
      {turn.userMessage && (
        <div className="chat-bubble-user rounded-xl px-4 py-3 mb-3">
          <p className="text-sm text-white/90 whitespace-pre-wrap break-words">
            {turn.userMessage.content}
          </p>
        </div>
      )}

      {/* Assistant response */}
      <div className="chat-bubble-assistant rounded-xl px-4 py-3">
        {/* Combined text from all assistant messages */}
        {hasContent ? (
          <div className="text-sm text-white/90 break-words markdown-content prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {combinedText}
            </ReactMarkdown>
          </div>
        ) : turn.isActive ? (
          <span className="text-white/40 italic">Thinking...</span>
        ) : null}

        {/* Tools summary */}
        {turn.tools.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <button
              onClick={() => setToolsExpanded(!toolsExpanded)}
              className="flex items-center gap-2 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              <span className="text-[10px]">{toolsExpanded ? '▼' : '▶'}</span>
              <span>
                {turn.tools.length} tool{turn.tools.length > 1 ? 's' : ''} used
              </span>
              <span className="text-white/20">
                ({completedTools} completed)
              </span>
            </button>

            {toolsExpanded && (
              <div className="mt-2 space-y-1.5">
                {turn.tools.map((tool) => (
                  <CompactToolBlock key={tool.id} tool={tool} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Streaming indicator */}
        {turn.isActive && hasContent && (
          <div className="mt-2 flex items-center gap-1">
            <div className="typing-dot" style={{ animationDelay: '0ms' }} />
            <div className="typing-dot" style={{ animationDelay: '160ms' }} />
            <div className="typing-dot" style={{ animationDelay: '320ms' }} />
          </div>
        )}
      </div>
    </div>
  );
}

interface CompactToolBlockProps {
  tool: ToolUsage;
}

function CompactToolBlock({ tool }: CompactToolBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const statusColors: Record<string, string> = {
    pending: 'text-white/40',
    running: 'text-blue-400',
    completed: 'text-green-400',
    error: 'text-red-400',
  };

  const statusIcons: Record<string, string> = {
    pending: '○',
    running: '◐',
    completed: '✓',
    error: '✕',
  };

  const toolIcons: Record<string, string> = {
    Read: '📄',
    Write: '✏️',
    Edit: '✏️',
    Bash: '💻',
    Grep: '🔍',
    Glob: '🔍',
    WebFetch: '🌐',
    WebSearch: '🔎',
    Task: '📋',
    TodoRead: '📝',
    TodoWrite: '📝',
  };

  // Get a summary of the input
  const getInputSummary = () => {
    if (!tool.input) return '';

    // For file operations, show the path
    if (tool.input.file_path) return String(tool.input.file_path);
    if (tool.input.path) return String(tool.input.path);
    if (tool.input.pattern) return String(tool.input.pattern);
    if (tool.input.command) {
      const cmd = String(tool.input.command);
      return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
    }
    if (tool.input.query) return String(tool.input.query);

    return '';
  };

  const inputSummary = getInputSummary();

  return (
    <div className="tool-block-compact rounded-lg bg-black/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5 transition-colors rounded-lg"
      >
        <span className="text-sm">{toolIcons[tool.name] || '🔧'}</span>
        <span className="text-xs text-white/60 flex-1 truncate">
          {tool.name}
          {inputSummary && (
            <span className="text-white/30 ml-1">{inputSummary}</span>
          )}
        </span>
        <span className={cn('text-xs', statusColors[tool.status])}>
          {statusIcons[tool.status]}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 text-xs">
          {/* Input */}
          <div className="mb-2">
            <span className="text-white/30">Input:</span>
            <pre className="mt-1 text-white/50 overflow-x-auto text-[10px] bg-black/20 rounded p-1">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {/* Output */}
          {tool.output && (
            <div>
              <span className="text-white/30">Output:</span>
              <pre className="mt-1 text-white/50 overflow-x-auto max-h-32 text-[10px] bg-black/20 rounded p-1">
                {tool.output.length > 500
                  ? tool.output.substring(0, 500) + '...'
                  : tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
