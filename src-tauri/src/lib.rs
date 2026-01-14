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
        .setup(|app| {
            // Initialize app state
            app.manage(AppState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Terminal commands
            commands::terminal::create_terminal_session,
            commands::terminal::write_to_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::kill_terminal_session,
            commands::terminal::get_terminal_output,
            commands::terminal::list_terminal_sessions,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
