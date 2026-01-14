# Claude Kanban

A Tauri-based desktop application that provides a Kanban board interface for managing development tasks with Claude Code integration.

## Features

- **Kanban Board**: Organize tasks across columns (Backlog, To Do, In Progress, Review, Done)
- **Project Management**: Create and manage multiple projects with their own task boards
- **Claude Code Integration**: Chat interface powered by Claude Code's headless mode for AI-assisted development
- **Session Persistence**: Resume Claude conversations across app restarts
- **Glass Morphism UI**: Modern, clean interface with glassmorphism design
- **Drag and Drop**: Reorder cards and move them between columns

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Zustand
- **Backend**: Tauri 2, Rust
- **AI**: Claude Code (headless mode with streaming JSON)
- **Database**: SQLite (via tauri-plugin-sql)

## Prerequisites

- Node.js 18+
- Rust (latest stable)
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd AbsolutelyRight
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run tauri dev
   ```

4. Build for production:
   ```bash
   npm run tauri build
   ```

## Project Structure

```
AbsolutelyRight/
├── src/                      # Frontend React code
│   ├── components/           # React components
│   │   ├── chat/            # Chat UI components
│   │   ├── kanban/          # Kanban board components
│   │   ├── sidebar/         # Sidebar components
│   │   └── terminal/        # Legacy terminal components
│   ├── stores/              # Zustand state stores
│   ├── lib/                 # Utilities and Tauri commands
│   ├── styles/              # CSS styles
│   └── types/               # TypeScript type definitions
├── src-tauri/               # Rust backend code
│   └── src/
│       ├── claude_session/  # Claude headless session manager
│       ├── commands/        # Tauri command handlers
│       ├── models/          # Data models
│       ├── state/           # Application state
│       └── terminal/        # Legacy PTY terminal manager
└── package.json
```

## Usage

1. **Create a Project**: Click the "+" button in the sidebar and select a project directory
2. **Add Cards**: Click "+ Add Card" to create tasks with optional prompts for Claude
3. **Start Claude**: Click on a card to open the chat panel and start a conversation with Claude
4. **Manage Tasks**: Drag and drop cards between columns to track progress

## Claude Code Integration

The app uses Claude Code's headless mode for AI conversations:

- **Streaming Responses**: Real-time display of Claude's responses
- **Tool Usage**: Visual display of tools Claude uses (file reads, edits, searches)
- **Session Resume**: Conversations persist and can be resumed using Claude's `--resume` flag
- **Auto-Approval**: Read-only tools (Read, Grep, Glob) are auto-approved for seamless interaction

## Development

### Frontend Development

```bash
npm run dev          # Start Vite dev server
npm run build        # Build frontend
npm run preview      # Preview production build
```

### Tauri Development

```bash
npm run tauri dev    # Run full app in dev mode
npm run tauri build  # Build production app
```

### Rust Only

```bash
cd src-tauri
cargo check          # Check for errors
cargo build          # Build Rust backend
```

## Configuration

The app stores data in:
- **macOS**: `~/Library/Application Support/com.claudekanban.app/`
- **Linux**: `~/.local/share/com.claudekanban.app/`
- **Windows**: `%APPDATA%/com.claudekanban.app/`

## License

MIT
