use crate::models::Card;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateCardInput {
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub card_type: String,
    pub status: String,
    pub prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCardInput {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub card_type: Option<String>,
    pub status: Option<String>,
    pub claude_status: Option<String>,
    pub position: Option<i32>,
    pub prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MoveCardInput {
    pub id: String,
    pub status: String,
    pub position: i32,
}

#[tauri::command]
pub fn create_card(input: CreateCardInput) -> Result<Card, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono_lite_now();

    Ok(Card {
        id,
        project_id: input.project_id,
        title: input.title,
        description: input.description,
        card_type: input.card_type,
        status: input.status,
        claude_status: "idle".to_string(),
        position: 0,
        prompt: input.prompt,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_cards(project_id: String) -> Result<Vec<Card>, String> {
    // The frontend will handle the actual query via SQL
    let _ = project_id;
    Ok(vec![])
}

#[tauri::command]
pub fn update_card(input: UpdateCardInput) -> Result<Card, String> {
    let now = chrono_lite_now();

    Ok(Card {
        id: input.id,
        project_id: String::new(),
        title: input.title.unwrap_or_default(),
        description: input.description,
        card_type: input.card_type.unwrap_or_else(|| "task".to_string()),
        status: input.status.unwrap_or_else(|| "backlog".to_string()),
        claude_status: input.claude_status.unwrap_or_else(|| "idle".to_string()),
        position: input.position.unwrap_or(0),
        prompt: input.prompt,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_card(id: String) -> Result<(), String> {
    let _ = id;
    Ok(())
}

#[tauri::command]
pub fn move_card(input: MoveCardInput) -> Result<(), String> {
    let _ = input;
    Ok(())
}

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}
