import { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  createTerminalSession,
  writeToTerminal,
  getTerminalOutput,
  killTerminalSession,
} from '../lib/tauri-commands';
import { useTerminalStore } from '../stores/terminalStore';
import { useCardStore } from '../stores/cardStore';
import type { ClaudeStatus } from '../types';

interface UseTerminalOptions {
  cardId: string;
  projectPath: string;
  initialPrompt?: string;
}

export function useTerminal({ cardId, projectPath, initialPrompt }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isReady, setIsReady] = useState(false);

  const { addSession, removeSession, getSessionByCardId } = useTerminalStore();
  const { updateClaudeStatus } = useCardStore();

  // Initialize terminal
  const initTerminal = useCallback(async () => {
    if (!containerRef.current || terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#45475a',
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
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Check if we already have a session for this card
    const existingSession = getSessionByCardId(cardId);
    if (existingSession) {
      sessionIdRef.current = existingSession.id;
    } else {
      // Create new session
      try {
        const sessionId = await createTerminalSession(
          cardId,
          projectPath,
          terminal.cols,
          terminal.rows,
          initialPrompt
        );
        sessionIdRef.current = sessionId;
        addSession(cardId, {
          id: sessionId,
          card_id: cardId,
          project_path: projectPath,
          is_active: true,
          claude_status: 'idle',
        });
      } catch (error) {
        console.error('Failed to create terminal session:', error);
        terminal.writeln(`\x1b[31mFailed to start Claude Code: ${error}\x1b[0m`);
        terminal.writeln('\x1b[33mMake sure "claude" is installed and in your PATH.\x1b[0m');
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
              updateClaudeStatus(cardId, status);
            }
          }
        } catch (error) {
          // Session might be dead
          console.error('Failed to get terminal output:', error);
        }
      }
    }, 50); // Poll every 50ms

    setIsReady(true);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [cardId, projectPath, initialPrompt, addSession, getSessionByCardId, updateClaudeStatus]);

  // Setup and cleanup
  useEffect(() => {
    initTerminal();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [initTerminal]);

  // Handle container resize
  useEffect(() => {
    if (!fitAddonRef.current || !containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isReady]);

  // Write data to terminal
  const write = useCallback((data: string | Uint8Array) => {
    terminalRef.current?.write(data);
  }, []);

  // Clear terminal
  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  // Focus terminal
  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  // Kill session
  const kill = useCallback(async () => {
    if (sessionIdRef.current) {
      try {
        await killTerminalSession(sessionIdRef.current);
        removeSession(cardId);
        sessionIdRef.current = null;
      } catch (error) {
        console.error('Failed to kill terminal session:', error);
      }
    }
  }, [cardId, removeSession]);

  return {
    containerRef,
    terminal: terminalRef.current,
    sessionId: sessionIdRef.current,
    write,
    clear,
    focus,
    kill,
    isReady,
  };
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
