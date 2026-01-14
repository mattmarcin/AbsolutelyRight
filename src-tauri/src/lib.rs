mod claude_session;
mod commands;
mod models;
mod state;
mod terminal;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Clean up any orphaned Claude processes from previous runs
            claude_session::cleanup_orphaned_processes();

            // Initialize app state with app handle for event emission
            let mut state = AppState::new();
            state
                .claude_session_manager
                .lock()
                .set_app_handle(app.handle().clone());
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Clean up Claude processes when app window is closed
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                println!("[App] Window close requested, cleaning up Claude sessions");
                if let Some(state) = window.try_state::<AppState>() {
                    let mut manager = state.claude_session_manager.lock();
                    manager.kill_all_sessions();
                }
                // Also clean up any orphaned processes by tag
                claude_session::cleanup_orphaned_processes();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Terminal commands (legacy PTY)
            commands::terminal::create_terminal_session,
            commands::terminal::write_to_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::kill_terminal_session,
            commands::terminal::get_terminal_output,
            commands::terminal::list_terminal_sessions,
            // Claude headless commands
            commands::claude::start_claude_session,
            commands::claude::get_claude_session,
            commands::claude::list_claude_sessions,
            commands::claude::kill_claude_session,
            commands::claude::send_to_claude_session,
            commands::claude::kill_sessions_for_card,
            commands::claude::kill_all_claude_sessions,
            // Project commands
            commands::projects::create_project,
            commands::projects::get_projects,
            commands::projects::update_project,
            commands::projects::delete_project,
            // Card commands
            commands::cards::create_card,
            commands::cards::get_cards,
            commands::cards::update_card,
            commands::cards::delete_card,
            commands::cards::move_card,
            // Git commands
            commands::git::init_git_repo,
            commands::git::get_git_info,
            commands::git::create_worktree,
            commands::git::remove_worktree,
            commands::git::get_diff_stats,
            commands::git::check_gh_cli,
            commands::git::create_pull_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
