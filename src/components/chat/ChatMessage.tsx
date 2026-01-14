import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn, stripAwaitingInputMarker } from '../../lib/utils';
import type { ChatMessage as ChatMessageType, ToolUsage } from '../../types';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div
      className={cn(
        'flex',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3',
          isUser && 'chat-bubble-user',
          isAssistant && 'chat-bubble-assistant'
        )}
      >
        {/* Message content */}
        <div className="text-sm text-white/90 break-words">
          {(() => {
            const displayContent = message.content ? stripAwaitingInputMarker(message.content) : '';
            return displayContent ? (
              isAssistant ? (
                <div className="markdown-content prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {displayContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap">{displayContent}</div>
              )
            ) : (
              message.isStreaming && (
                <span className="text-white/40 italic">Thinking...</span>
              )
            );
          })()}
        </div>

        {/* Tool usage blocks */}
        {message.tools && message.tools.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.tools.map((tool) => (
              <ToolBlock key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {/* Streaming indicator */}
        {message.isStreaming && message.content && (
          <div className="mt-2 flex items-center gap-1">
            <div className="typing-dot" style={{ animationDelay: '0ms' }} />
            <div className="typing-dot" style={{ animationDelay: '160ms' }} />
            <div className="typing-dot" style={{ animationDelay: '320ms' }} />
          </div>
        )}

        {/* Timestamp */}
        <div className="mt-1 text-[10px] text-white/20">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

interface ToolBlockProps {
  tool: ToolUsage;
}

function ToolBlock({ tool }: ToolBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusColors: Record<string, string> = {
    pending: 'text-white/40',
    running: 'text-blue-400 animate-pulse',
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
    Task: '📋',
  };

  return (
    <div className="tool-block">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="tool-block-header w-full"
      >
        <div className="flex items-center gap-2">
          <span>{toolIcons[tool.name] || '🔧'}</span>
          <span className="text-white/70">{tool.name}</span>
          <span className={statusColors[tool.status]}>
            {statusIcons[tool.status]}
          </span>
        </div>
        <span className="text-white/30 text-xs">
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {isExpanded && (
        <div className="tool-block-content">
          {/* Input */}
          <div className="mb-2">
            <span className="text-white/40 text-xs">Input:</span>
            <pre className="mt-1 text-white/60 text-xs overflow-x-auto">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {/* Output */}
          {tool.output && (
            <div>
              <span className="text-white/40 text-xs">Output:</span>
              <pre className="mt-1 text-white/60 text-xs overflow-x-auto max-h-40">
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
