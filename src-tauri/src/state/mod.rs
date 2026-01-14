use crate::claude_session::ClaudeSessionManager;
use crate::terminal::TerminalManager;
use parking_lot::Mutex;
use std::sync::Arc;

pub struct AppState {
    pub terminal_manager: Arc<Mutex<TerminalManager>>,
    pub claude_session_manager: Arc<Mutex<ClaudeSessionManager>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            terminal_manager: Arc::new(Mutex::new(TerminalManager::new())),
            claude_session_manager: Arc::new(Mutex::new(ClaudeSessionManager::new())),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
