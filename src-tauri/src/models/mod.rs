use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardType {
    Feature,
    Bug,
    Task,
    Chore,
}

impl CardType {
    pub fn as_str(&self) -> &'static str {
        match self {
            CardType::Feature => "feature",
            CardType::Bug => "bug",
            CardType::Task => "task",
            CardType::Chore => "chore",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardStatus {
    Backlog,
    Todo,
    InProgress,
    Review,
    Done,
}

impl CardStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            CardStatus::Backlog => "backlog",
            CardStatus::Todo => "todo",
            CardStatus::InProgress => "in_progress",
            CardStatus::Review => "review",
            CardStatus::Done => "done",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeStatus {
    Idle,
    Running,
    WaitingInput,
    Error,
    Completed,
}

impl Default for ClaudeStatus {
    fn default() -> Self {
        ClaudeStatus::Idle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub card_type: String,
    pub status: String,
    pub claude_status: String,
    pub position: i32,
    pub prompt: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSession {
    pub id: String,
    pub card_id: String,
    pub project_path: String,
    pub is_active: bool,
    pub claude_status: ClaudeStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub session_id: String,
    pub data: Vec<u8>,
}

// ============================================
// Claude Headless Mode Types
// ============================================

/// Session info for Claude headless sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSessionInfo {
    pub id: String,
    pub card_id: String,
    pub project_path: String,
    pub claude_session_id: Option<String>,
    pub status: ClaudeStatus,
    pub is_alive: bool,
    pub total_cost_usd: f64,
}

/// Events emitted to frontend during Claude session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClaudeEvent {
    /// Session started with Claude's session ID
    SessionStarted {
        session_id: String,
        claude_session_id: String,
    },
    /// Text chunk from Claude's response (streaming)
    TextChunk {
        session_id: String,
        text: String,
    },
    /// Tool execution started
    ToolStart {
        session_id: String,
        tool_name: String,
        tool_id: String,
        tool_input: serde_json::Value,
    },
    /// Tool execution completed
    ToolEnd {
        session_id: String,
        tool_id: String,
        tool_name: String,
        success: bool,
        output: Option<String>,
    },
    /// Claude's status changed
    StatusChanged {
        session_id: String,
        status: ClaudeStatus,
    },
    /// Session completed
    SessionCompleted {
        session_id: String,
        result: Option<String>,
        cost_usd: f64,
    },
    /// Session error
    SessionError {
        session_id: String,
        error: String,
    },
}
