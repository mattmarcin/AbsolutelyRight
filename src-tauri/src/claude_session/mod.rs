use crate::models::{ClaudeEvent, ClaudeSessionInfo, ClaudeStatus};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Active Claude session with process handle and stdin for follow-up messages
pub struct ClaudeSession {
    pub info: ClaudeSessionInfo,
    _process: Option<Child>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    shell_pid: Option<u32>,
    claude_pid: Option<u32>,
}

/// Manages Claude headless sessions
pub struct ClaudeSessionManager {
    sessions: HashMap<String, ClaudeSession>,
    app_handle: Option<AppHandle>,
}

impl ClaudeSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            app_handle: None,
        }
    }

    pub fn set_app_handle(&mut self, handle: AppHandle) {
        self.app_handle = Some(handle);
    }

    /// Start a new Claude session with headless mode
    pub fn start_session(
        &mut self,
        card_id: String,
        project_path: String,
        prompt: String,
        allowed_tools: Option<Vec<String>>,
        resume_session_id: Option<String>,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Get user's shell for proper PATH resolution
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        // Build the claude command with headless flags
        let mut claude_args = vec![
            "-p".to_string(),
            prompt.clone(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
        ];

        // Add resume flag if we have a Claude session ID
        if let Some(ref claude_sid) = resume_session_id {
            claude_args.push("--resume".to_string());
            claude_args.push(claude_sid.clone());
        }

        // Add allowed tools for auto-approval
        if let Some(tools) = &allowed_tools {
            if !tools.is_empty() {
                claude_args.push("--allowedTools".to_string());
                claude_args.push(tools.join(","));
            }
        }

        // Escape arguments for shell
        let escaped_args: Vec<String> = claude_args
            .iter()
            .map(|arg| {
                if arg.contains(' ') || arg.contains('"') || arg.contains('\'') {
                    format!("'{}'", arg.replace("'", "'\\''"))
                } else {
                    arg.clone()
                }
            })
            .collect();

        let claude_cmd = format!("claude {}", escaped_args.join(" "));

        println!("[ClaudeSession] Starting: {}", claude_cmd);
        println!("[ClaudeSession] Working directory: {}", project_path);

        // Spawn via login shell to get proper PATH
        // Add environment tags so we can identify and clean up our processes
        let mut child = Command::new(&shell)
            .arg("-l")
            .arg("-c")
            .arg(&claude_cmd)
            .current_dir(&project_path)
            .env("TERM", "xterm-256color")
            .env("COLORTERM", "truecolor")
            .env("ABSOLUTELY_RIGHT_SESSION", &session_id)
            .env("ABSOLUTELY_RIGHT_CARD", &card_id)
            .stdin(Stdio::null()) // Don't pipe stdin for now - causes Claude to hang
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let shell_pid = child.id();
        println!("[ClaudeSession] Shell PID: {}", shell_pid);

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        // Find the actual claude child process after a brief delay
        let session_id_for_pid = session_id.clone();
        let claude_pid = Self::find_claude_child_pid(shell_pid, &session_id_for_pid);

        // Create session info
        let info = ClaudeSessionInfo {
            id: session_id.clone(),
            card_id: card_id.clone(),
            project_path: project_path.clone(),
            claude_session_id: resume_session_id,
            status: ClaudeStatus::Running,
            is_alive: true,
            total_cost_usd: 0.0,
        };

        // Clone for threads
        let session_id_for_stdout = session_id.clone();
        let session_id_for_stderr = session_id.clone();
        let app_handle_stdout = self.app_handle.clone();
        let app_handle_stderr = self.app_handle.clone();

        // Shared state for tracking
        let claude_session_id: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let claude_session_id_clone = Arc::clone(&claude_session_id);

        // Track active tool blocks by index (index -> (tool_id, tool_name))
        let active_tools: Arc<Mutex<HashMap<u64, (String, String)>>> = Arc::new(Mutex::new(HashMap::new()));
        let active_tools_clone = Arc::clone(&active_tools);

        // Spawn stdout reader thread for streaming JSON
        thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        eprintln!("[ClaudeSession] Read error: {}", e);
                        break;
                    }
                };

                if line.trim().is_empty() {
                    continue;
                }

                // Try to parse as JSON
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    println!("[ClaudeSession] JSON received: {}", json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"));
                    if let Some(handle) = &app_handle_stdout {
                        let event = parse_claude_json(&session_id_for_stdout, &json, &claude_session_id_clone, &active_tools_clone);
                        if let Some(evt) = &event {
                            println!("[ClaudeSession] Emitting event: {:?}", evt);
                            let _ = handle.emit("claude-event", evt);
                        } else {
                            println!("[ClaudeSession] No event generated for type: {}", json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"));
                        }
                    }
                } else {
                    // Non-JSON line, emit as text chunk
                    if let Some(handle) = &app_handle_stdout {
                        let evt = ClaudeEvent::TextChunk {
                            session_id: session_id_for_stdout.clone(),
                            text: format!("{}\n", line),
                        };
                        let _ = handle.emit("claude-event", &evt);
                    }
                }
            }

            // Session ended
            if let Some(handle) = &app_handle_stdout {
                let evt = ClaudeEvent::StatusChanged {
                    session_id: session_id_for_stdout.clone(),
                    status: ClaudeStatus::Completed,
                };
                let _ = handle.emit("claude-event", &evt);
            }
        });

        // Spawn stderr reader thread
        thread::spawn(move || {
            let reader = BufReader::new(stderr);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };

                if !line.trim().is_empty() {
                    eprintln!("[ClaudeSession stderr] {}", line);

                    // Emit error text as well
                    if let Some(handle) = &app_handle_stderr {
                        let evt = ClaudeEvent::TextChunk {
                            session_id: session_id_for_stderr.clone(),
                            text: format!("\x1b[31m{}\x1b[0m\n", line),
                        };
                        let _ = handle.emit("claude-event", &evt);
                    }
                }
            }
        });

        let session = ClaudeSession {
            info,
            _process: Some(child),
            stdin: None, // Stdin disabled for now - piping causes Claude to hang
            shell_pid: Some(shell_pid),
            claude_pid,
        };

        if let Some(pid) = claude_pid {
            println!("[ClaudeSession] Claude PID: {}", pid);
        } else {
            println!("[ClaudeSession] Claude PID not found yet (will be tracked)");
        }

        self.sessions.insert(session_id.clone(), session);

        Ok(session_id)
    }

    /// Get session info
    pub fn get_session(&self, session_id: &str) -> Option<ClaudeSessionInfo> {
        self.sessions.get(session_id).map(|s| s.info.clone())
    }

    /// List all sessions
    pub fn list_sessions(&self) -> Vec<ClaudeSessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    /// Kill a session
    pub fn kill_session(&mut self, session_id: &str) -> Result<(), String> {
        println!("[ClaudeSession] Killing session: {}", session_id);

        if let Some(mut session) = self.sessions.remove(session_id) {
            // Kill the tracked Claude PID first (most reliable)
            if let Some(claude_pid) = session.claude_pid {
                println!("[ClaudeSession] Killing Claude PID: {}", claude_pid);
                #[cfg(unix)]
                {
                    let _ = Command::new("kill")
                        .args(["-TERM", &claude_pid.to_string()])
                        .output();
                }
            }

            // Kill children of the shell process
            if let Some(shell_pid) = session.shell_pid {
                println!("[ClaudeSession] Killing shell children, shell PID: {}", shell_pid);
                #[cfg(unix)]
                {
                    let _ = Command::new("pkill")
                        .args(["-TERM", "-P", &shell_pid.to_string()])
                        .output();
                }
            }

            // Kill the shell process itself
            if let Some(ref mut process) = session._process {
                let _ = process.kill();
            }

            // Fallback: kill by session tag (catches any orphaned processes)
            #[cfg(unix)]
            {
                let _ = Command::new("pkill")
                    .args(["-TERM", "-f", &format!("ABSOLUTELY_RIGHT_SESSION={}", session_id)])
                    .output();
            }
        }
        Ok(())
    }

    /// Kill all sessions for a specific card
    pub fn kill_sessions_by_card(&mut self, card_id: &str) -> Result<(), String> {
        println!("[ClaudeSession] Killing all sessions for card: {}", card_id);

        // Find all session IDs for this card
        let session_ids: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, s)| s.info.card_id == card_id)
            .map(|(id, _)| id.clone())
            .collect();

        // Kill each session
        for session_id in session_ids {
            self.kill_session(&session_id)?;
        }

        // Fallback: kill by card tag (catches any orphaned processes)
        #[cfg(unix)]
        {
            let _ = Command::new("pkill")
                .args(["-TERM", "-f", &format!("ABSOLUTELY_RIGHT_CARD={}", card_id)])
                .output();
        }

        Ok(())
    }

    /// Kill all tracked sessions
    pub fn kill_all_sessions(&mut self) {
        println!("[ClaudeSession] Killing all sessions");

        let session_ids: Vec<String> = self.sessions.keys().cloned().collect();
        for session_id in session_ids {
            let _ = self.kill_session(&session_id);
        }
    }

    /// Find the claude child process PID given the shell PID
    fn find_claude_child_pid(shell_pid: u32, _session_id: &str) -> Option<u32> {
        // Wait a moment for the child process to spawn
        std::thread::sleep(std::time::Duration::from_millis(100));

        #[cfg(unix)]
        {
            // Use pgrep to find child processes named "claude"
            let output = Command::new("pgrep")
                .args(["-P", &shell_pid.to_string()])
                .output()
                .ok()?;

            let pid_str = String::from_utf8_lossy(&output.stdout);
            for line in pid_str.lines() {
                if let Ok(pid) = line.trim().parse::<u32>() {
                    // Verify this is a claude process
                    let check = Command::new("ps")
                        .args(["-p", &pid.to_string(), "-o", "comm="])
                        .output()
                        .ok()?;
                    let comm = String::from_utf8_lossy(&check.stdout);
                    if comm.contains("claude") {
                        return Some(pid);
                    }
                }
            }
        }
        None
    }

    /// Send a follow-up message to a running session (currently disabled)
    pub fn send_to_session(&self, session_id: &str, message: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;

        let stdin = session
            .stdin
            .as_ref()
            .ok_or_else(|| "Session stdin not available (follow-up messages disabled)".to_string())?;

        let mut stdin_guard = stdin.lock();

        // Write the message followed by a newline to stdin
        stdin_guard
            .write_all(message.as_bytes())
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
        stdin_guard
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {}", e))?;
        stdin_guard
            .flush()
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;

        println!("[ClaudeSession] Sent follow-up message to session {}", session_id);
        Ok(())
    }
}

/// Cleanup any orphaned AbsolutelyRight Claude processes from previous runs
pub fn cleanup_orphaned_processes() {
    println!("[ClaudeSession] Cleaning up orphaned processes from previous runs");
    #[cfg(unix)]
    {
        let _ = Command::new("pkill")
            .args(["-TERM", "-f", "ABSOLUTELY_RIGHT_SESSION"])
            .output();
    }
}

impl Default for ClaudeSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse Claude's streaming JSON output into events
fn parse_claude_json(
    session_id: &str,
    json: &serde_json::Value,
    claude_session_id: &Arc<Mutex<Option<String>>>,
    active_tools: &Arc<Mutex<HashMap<u64, (String, String)>>>,
) -> Option<ClaudeEvent> {
    let msg_type = json.get("type")?.as_str()?;

    match msg_type {
        "system" => {
            // System messages may contain session ID
            if let Some(subtype) = json.get("subtype").and_then(|v| v.as_str()) {
                if subtype == "init" {
                    if let Some(sid) = json.get("session_id").and_then(|v| v.as_str()) {
                        *claude_session_id.lock() = Some(sid.to_string());
                        return Some(ClaudeEvent::SessionStarted {
                            session_id: session_id.to_string(),
                            claude_session_id: sid.to_string(),
                        });
                    }
                }
            }
            None
        }

        "assistant" => {
            // Assistant message with content
            if let Some(message) = json.get("message") {
                if let Some(content) = message.get("content").and_then(|v| v.as_array()) {
                    for block in content {
                        if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                            return Some(ClaudeEvent::TextChunk {
                                session_id: session_id.to_string(),
                                text: text.to_string(),
                            });
                        }
                    }
                }
            }
            None
        }

        "content_block_start" => {
            let index = json.get("index").and_then(|v| v.as_u64()).unwrap_or(0);

            if let Some(block) = json.get("content_block") {
                let block_type = block.get("type").and_then(|v| v.as_str())?;

                if block_type == "tool_use" {
                    let tool_id = block.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let tool_name = block.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let tool_input = block.get("input").cloned().unwrap_or(serde_json::Value::Null);

                    // Track this tool block for later ToolEnd emission
                    active_tools.lock().insert(index, (tool_id.to_string(), tool_name.to_string()));

                    return Some(ClaudeEvent::ToolStart {
                        session_id: session_id.to_string(),
                        tool_name: tool_name.to_string(),
                        tool_id: tool_id.to_string(),
                        tool_input,
                    });
                } else if block_type == "text" {
                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                        return Some(ClaudeEvent::TextChunk {
                            session_id: session_id.to_string(),
                            text: text.to_string(),
                        });
                    }
                }
            }
            None
        }

        "content_block_delta" => {
            if let Some(delta) = json.get("delta") {
                let delta_type = delta.get("type").and_then(|v| v.as_str())?;

                if delta_type == "text_delta" {
                    if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                        return Some(ClaudeEvent::TextChunk {
                            session_id: session_id.to_string(),
                            text: text.to_string(),
                        });
                    }
                }
            }
            None
        }

        "content_block_stop" => {
            // Check if this was a tool block and emit ToolEnd
            let index = json.get("index").and_then(|v| v.as_u64()).unwrap_or(0);

            if let Some((tool_id, tool_name)) = active_tools.lock().remove(&index) {
                return Some(ClaudeEvent::ToolEnd {
                    session_id: session_id.to_string(),
                    tool_id,
                    tool_name,
                    success: true,
                    output: None,
                });
            }
            None
        }

        "result" => {
            let subtype = json.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
            let result = json.get("result").and_then(|v| v.as_str()).map(|s| s.to_string());
            let cost = json.get("cost_usd").and_then(|v| v.as_f64()).unwrap_or(0.0);

            if subtype == "success" || subtype == "error" {
                return Some(ClaudeEvent::SessionCompleted {
                    session_id: session_id.to_string(),
                    result,
                    cost_usd: cost,
                });
            }
            None
        }

        _ => None,
    }
}
