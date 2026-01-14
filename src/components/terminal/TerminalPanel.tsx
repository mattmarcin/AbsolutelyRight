import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  createTerminalSession,
  writeToTerminal,
  getTerminalOutput,
  killTerminalSession,
} from '../../lib/tauri-commands';
import { useTerminalStore } from '../../stores/terminalStore';
import { useCardStore } from '../../stores/cardStore';
import type { Card, ClaudeStatus } from '../../types';
import { cn, getClaudeStatusColor, getClaudeStatusLabel } from '../../lib/utils';

interface TerminalPanelProps {
  card: Card;
  projectPath: string;
}

export function TerminalPanel({ card, projectPath }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const { addSession, getSessionByCardId, removeSession } = useTerminalStore();
  const { updateClaudeStatus } = useCardStore();

  // Initialize terminal
  const initTerminal = useCallback(async () => {
    if (!containerRef.current) return;

    // Clean up existing terminal
    if (terminalRef.current) {
      terminalRef.current.dispose();
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, Consolas, monospace',
      lineHeight: 1.4,
      theme: {
        background: 'rgba(15, 15, 25, 0.95)',
        foreground: '#cdd6f4',
        cursor: '#89b4fa',
        cursorAccent: '#1e1e2e',
        selectionBackground: 'rgba(137, 180, 250, 0.3)',
        selectionForeground: '#cdd6f4',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);

    // Delay fit to ensure container is properly sized
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Check for existing session
    const existingSession = getSessionByCardId(card.id);

    if (existingSession) {
      sessionIdRef.current = existingSession.id;
      terminal.writeln('\x1b[90m--- Reconnecting to existing session ---\x1b[0m\n');
      setIsConnected(true);
    } else {
      // Create new session
      terminal.writeln('\x1b[36m╭────────────────────────────────────────╮\x1b[0m');
      terminal.writeln('\x1b[36m│\x1b[0m  \x1b[1;97mClaude Kanban Terminal\x1b[0m               \x1b[36m│\x1b[0m');
      terminal.writeln('\x1b[36m│\x1b[0m  \x1b[90mStarting Claude Code...\x1b[0m               \x1b[36m│\x1b[0m');
      terminal.writeln('\x1b[36m╰────────────────────────────────────────╯\x1b[0m\n');

      try {
        const sessionId = await createTerminalSession(
          card.id,
          projectPath,
          terminal.cols,
          terminal.rows,
          card.prompt
        );
        sessionIdRef.current = sessionId;
        addSession(card.id, {
          id: sessionId,
          card_id: card.id,
          project_path: projectPath,
          is_active: true,
          claude_status: 'idle',
        });
        setIsConnected(true);
      } catch (error) {
        console.error('Failed to create terminal session:', error);
        terminal.writeln(`\x1b[31m✗ Failed to start Claude Code\x1b[0m`);
        terminal.writeln(`\x1b[90m  ${error}\x1b[0m\n`);
        terminal.writeln('\x1b[33m💡 Make sure "claude" CLI is installed:\x1b[0m');
        terminal.writeln('\x1b[90m   npm install -g @anthropic-ai/claude-code\x1b[0m\n');
      }
    }

    // Handle user input
    terminal.onData(async (data) => {
      if (sessionIdRef.current) {
        const encoder = new TextEncoder();
        try {
          await writeToTerminal(sessionIdRef.current, encoder.encode(data));
        } catch (error) {
          console.error('Failed to write to terminal:', error);
        }
      }
    });

    // Start polling for output
    pollIntervalRef.current = setInterval(async () => {
      if (sessionIdRef.current) {
        try {
          const output = await getTerminalOutput(sessionIdRef.current);
          if (output.data.length > 0) {
            const decoder = new TextDecoder();
            const text = decoder.decode(new Uint8Array(output.data));
            terminal.write(text);

            // Parse status from output
            const status = parseClaudeStatus(text);
            if (status) {
              updateClaudeStatus(card.id, status);
            }
          }
        } catch {
          // Session might be dead, ignore errors
        }
      }
    }, 50);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [card.id, card.prompt, projectPath, addSession, getSessionByCardId, updateClaudeStatus]);

  // Setup terminal when card changes
  useEffect(() => {
    initTerminal();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [card.id]); // Re-init when card changes

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Focus terminal when it becomes visible
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [card.id]);

  const handleKillSession = async () => {
    if (sessionIdRef.current) {
      try {
        await killTerminalSession(sessionIdRef.current);
        removeSession(card.id);
        sessionIdRef.current = null;
        setIsConnected(false);
        terminalRef.current?.writeln('\n\x1b[90m--- Session terminated ---\x1b[0m');
      } catch (error) {
        console.error('Failed to kill session:', error);
      }
    }
  };

  const handleRestart = async () => {
    await handleKillSession();
    setTimeout(() => {
      initTerminal();
    }, 100);
  };

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.8)] backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full',
                isConnected ? 'bg-green-500 shadow-lg shadow-green-500/50' : 'bg-gray-500'
              )}
            />
            <span className="text-sm text-white/60">
              {card.title}
            </span>
          </div>

          {/* Claude Status */}
          {card.claude_status !== 'idle' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5">
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  getClaudeStatusColor(card.claude_status)
                )}
              />
              <span className="text-[10px] text-white/50">
                {getClaudeStatusLabel(card.claude_status)}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRestart}
            className="px-3 py-1 text-xs text-white/50 hover:text-white/80 hover:bg-white/5 rounded-lg transition-all"
          >
            Restart
          </button>
          <button
            onClick={handleKillSession}
            className="px-3 py-1 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
          >
            Kill
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '8px' }}
      />
    </div>
  );
}

// Parse Claude Code status from terminal output
function parseClaudeStatus(text: string): ClaudeStatus | null {
  // Check for spinner characters (thinking)
  const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  if (spinnerChars.some((c) => text.includes(c))) {
    return 'running';
  }

  // Check for thinking/working indicators
  if (
    text.includes('Thinking') ||
    text.includes('Analyzing') ||
    text.includes('Reading') ||
    text.includes('Writing') ||
    text.includes('Searching')
  ) {
    return 'running';
  }

  // Check for permission/input prompts
  if (
    text.includes('[Y/n]') ||
    text.includes('[y/N]') ||
    text.includes('Allow?') ||
    text.includes('Approve?') ||
    text.includes('Do you want') ||
    text.includes('Should I')
  ) {
    return 'waiting_input';
  }

  // Check for errors
  if (text.includes('Error:') || text.includes('Failed:') || text.includes('error:')) {
    return 'error';
  }

  // Check for completion
  if (text.includes('Done.') || text.includes('Completed') || text.includes('Successfully')) {
    return 'completed';
  }

  return null;
}
