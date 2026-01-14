use crate::models::{ClaudeStatus, TerminalOutput, TerminalSession};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use uuid::Uuid;

pub struct PtySession {
    pub id: String,
    pub card_id: String,
    pub project_path: String,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub output_buffer: Arc<Mutex<Vec<u8>>>,
    pub claude_status: Arc<Mutex<ClaudeStatus>>,
    pub is_alive: Arc<Mutex<bool>>,
}

pub struct TerminalManager {
    sessions: HashMap<String, PtySession>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn create_session(
        &mut self,
        card_id: String,
        project_path: String,
        cols: u16,
        rows: u16,
        initial_prompt: Option<String>,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Get native PTY system
        let pty_system = native_pty_system();

        // Open PTY with specified size
        let pair: PtyPair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Build command - spawn claude CLI
        let mut cmd = CommandBuilder::new("claude");
        cmd.cwd(&project_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // If there's an initial prompt, pass it as argument
        if let Some(prompt) = &initial_prompt {
            cmd.arg("-p");
            cmd.arg(prompt);
        }

        // Spawn the command
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        // Get writer
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        // Get reader
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let output_buffer = Arc::new(Mutex::new(Vec::new()));
        let claude_status = Arc::new(Mutex::new(ClaudeStatus::Idle));
        let is_alive = Arc::new(Mutex::new(true));

        // Clone for reader thread
        let output_buffer_clone = Arc::clone(&output_buffer);
        let claude_status_clone = Arc::clone(&claude_status);
        let is_alive_clone = Arc::clone(&is_alive);
        let session_id_clone = session_id.clone();

        // Spawn reader thread
        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // EOF
                        *is_alive_clone.lock() = false;
                        break;
                    }
                    Ok(n) => {
                        let data = &buffer[..n];

                        // Append to output buffer
                        {
                            let mut buf = output_buffer_clone.lock();
                            buf.extend_from_slice(data);
                            // Keep buffer manageable (last 100KB)
                            if buf.len() > 100_000 {
                                let drain_to = buf.len() - 50_000;
                                buf.drain(..drain_to);
                            }
                        }

                        // Parse status from output
                        let status = parse_claude_status(data);
                        *claude_status_clone.lock() = status;
                    }
                    Err(_) => {
                        *is_alive_clone.lock() = false;
                        break;
                    }
                }
            }

            // Wait for child process
            let _ = child.wait();
        });

        let session = PtySession {
            id: session_id.clone(),
            card_id,
            project_path,
            writer: Arc::new(Mutex::new(writer)),
            output_buffer,
            claude_status,
            is_alive,
        };

        self.sessions.insert(session_id.clone(), session);

        Ok(session_id)
    }

    pub fn write_to_session(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        let mut writer = session.writer.lock();
        writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {}", e))?;
        writer.flush().map_err(|e| format!("Flush failed: {}", e))?;

        Ok(())
    }

    pub fn resize_session(&self, session_id: &str, _cols: u16, _rows: u16) -> Result<(), String> {
        let _session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        // Note: portable-pty resize requires keeping the master handle
        // For now, we'll skip resize. A more complete implementation would
        // store the master and call resize on it.

        Ok(())
    }

    pub fn get_output(&self, session_id: &str) -> Result<TerminalOutput, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        let mut buffer = session.output_buffer.lock();
        let data = buffer.clone();
        buffer.clear();

        Ok(TerminalOutput {
            session_id: session_id.to_string(),
            data,
        })
    }

    pub fn get_session_info(&self, session_id: &str) -> Result<TerminalSession, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        Ok(TerminalSession {
            id: session.id.clone(),
            card_id: session.card_id.clone(),
            project_path: session.project_path.clone(),
            is_active: *session.is_alive.lock(),
            claude_status: session.claude_status.lock().clone(),
        })
    }

    pub fn list_sessions(&self) -> Vec<TerminalSession> {
        self.sessions
            .values()
            .map(|s| TerminalSession {
                id: s.id.clone(),
                card_id: s.card_id.clone(),
                project_path: s.project_path.clone(),
                is_active: *s.is_alive.lock(),
                claude_status: s.claude_status.lock().clone(),
            })
            .collect()
    }

    pub fn kill_session(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.remove(session_id) {
            *session.is_alive.lock() = false;
            // The reader thread will exit when it detects is_alive is false
            // or when the PTY is dropped
        }
        Ok(())
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse Claude Code status from terminal output
fn parse_claude_status(data: &[u8]) -> ClaudeStatus {
    let text = String::from_utf8_lossy(data);

    // Check for spinner characters (thinking)
    let spinner_chars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    if spinner_chars.iter().any(|c| text.contains(*c)) {
        return ClaudeStatus::Running;
    }

    // Check for thinking/working indicators
    if text.contains("Thinking")
        || text.contains("Analyzing")
        || text.contains("Reading")
        || text.contains("Writing")
        || text.contains("Searching")
    {
        return ClaudeStatus::Running;
    }

    // Check for permission/input prompts
    if text.contains("[Y/n]")
        || text.contains("[y/N]")
        || text.contains("Allow?")
        || text.contains("Approve?")
        || text.contains("Do you want")
        || text.contains("Should I")
    {
        return ClaudeStatus::WaitingInput;
    }

    // Check for errors
    if text.contains("Error:") || text.contains("Failed:") || text.contains("error:") {
        return ClaudeStatus::Error;
    }

    // Check for completion
    if text.contains("Done.") || text.contains("Completed") || text.contains("Successfully") {
        return ClaudeStatus::Completed;
    }

    ClaudeStatus::Idle
}
