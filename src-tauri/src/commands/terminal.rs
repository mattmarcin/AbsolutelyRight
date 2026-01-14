use crate::models::{TerminalOutput, TerminalSession};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn create_terminal_session(
    card_id: String,
    project_path: String,
    cols: u16,
    rows: u16,
    initial_prompt: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut manager = state.terminal_manager.lock();
    manager.create_session(card_id, project_path, cols, rows, initial_prompt)
}

#[tauri::command]
pub fn write_to_terminal(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = state.terminal_manager.lock();
    manager.write_to_session(&session_id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = state.terminal_manager.lock();
    manager.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub fn get_terminal_output(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<TerminalOutput, String> {
    let manager = state.terminal_manager.lock();
    manager.get_output(&session_id)
}

#[tauri::command]
pub fn list_terminal_sessions(state: State<'_, AppState>) -> Vec<TerminalSession> {
    let manager = state.terminal_manager.lock();
    manager.list_sessions()
}

#[tauri::command]
pub fn kill_terminal_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut manager = state.terminal_manager.lock();
    manager.kill_session(&session_id)
}
