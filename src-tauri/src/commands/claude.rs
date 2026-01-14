use crate::models::ClaudeSessionInfo;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn start_claude_session(
    card_id: String,
    project_path: String,
    prompt: String,
    allowed_tools: Option<Vec<String>>,
    resume_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut manager = state.claude_session_manager.lock();
    manager.start_session(card_id, project_path, prompt, allowed_tools, resume_session_id)
}

#[tauri::command]
pub fn get_claude_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Option<ClaudeSessionInfo> {
    let manager = state.claude_session_manager.lock();
    manager.get_session(&session_id)
}

#[tauri::command]
pub fn list_claude_sessions(state: State<'_, AppState>) -> Vec<ClaudeSessionInfo> {
    let manager = state.claude_session_manager.lock();
    manager.list_sessions()
}

#[tauri::command]
pub fn kill_claude_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut manager = state.claude_session_manager.lock();
    manager.kill_session(&session_id)
}
