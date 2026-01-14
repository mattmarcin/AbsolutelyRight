use crate::models::Project;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectInput {
    pub id: String,
    pub name: Option<String>,
    pub path: Option<String>,
    pub description: Option<String>,
}

#[tauri::command]
pub fn create_project(input: CreateProjectInput) -> Result<Project, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono_lite_now();

    Ok(Project {
        id,
        name: input.name,
        path: input.path,
        description: input.description,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_projects() -> Result<Vec<Project>, String> {
    // This would normally query the database
    // For now, return empty - the frontend will handle persistence via tauri-plugin-sql
    Ok(vec![])
}

#[tauri::command]
pub fn update_project(input: UpdateProjectInput) -> Result<Project, String> {
    let now = chrono_lite_now();

    Ok(Project {
        id: input.id,
        name: input.name.unwrap_or_default(),
        path: input.path.unwrap_or_default(),
        description: input.description,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_project(id: String) -> Result<(), String> {
    // The frontend will handle the actual deletion via SQL
    let _ = id;
    Ok(())
}

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}
