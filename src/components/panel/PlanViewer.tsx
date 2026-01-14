import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

interface PlanViewerProps {
  content: string;
  className?: string;
}

/**
 * PlanViewer - Renders markdown plan content
 * Styled for dark theme with GitHub Flavored Markdown support
 */
export function PlanViewer({ content, className }: PlanViewerProps) {
  return (
    <div className={cn('markdown-content text-white/80', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-bold mb-4 text-white/90 border-b border-white/10 pb-2">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mb-3 mt-6 text-white/85">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-medium mb-2 mt-4 text-white/80">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-3 leading-relaxed text-white/70">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1.5 mb-4 ml-2 text-white/70">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1.5 mb-4 ml-2 text-white/70">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">{children}</li>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="bg-black/30 px-1.5 py-0.5 rounded text-xs text-blue-300 font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn('text-sm', className)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-black/40 p-4 rounded-lg overflow-x-auto mb-4 text-sm font-mono">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-blue-500/50 pl-4 italic text-white/60 mb-4">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-blue-400 hover:text-blue-300 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4">
              <table className="w-full border-collapse">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-medium text-white/80">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-white/10 px-3 py-2 text-sm text-white/70">
              {children}
            </td>
          ),
          hr: () => (
            <hr className="border-white/10 my-6" />
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-white/90">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-white/75">{children}</em>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
