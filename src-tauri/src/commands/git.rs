use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct WorktreeResult {
    pub worktree_path: String,
    pub branch_name: String,
    pub base_branch: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitInfo {
    pub default_branch: String,
    pub remote_url: Option<String>,
    pub is_git_repo: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffStats {
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PrResult {
    pub pr_url: String,
    pub pr_number: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhStatus {
    pub installed: bool,
    pub authenticated: bool,
}

/// Generate a slug from a card title (lowercase, hyphenated)
fn slugify(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(30)
        .collect()
}

/// Get the worktrees directory path (inside the project)
fn get_worktrees_dir(project_path: &str) -> String {
    let path = Path::new(project_path);
    path.join(".worktrees")
        .to_string_lossy()
        .to_string()
}

/// Ensure .worktrees is in .gitignore
fn ensure_worktrees_ignored(project_path: &str) {
    let gitignore_path = Path::new(project_path).join(".gitignore");

    // Read existing .gitignore content
    let existing_content = std::fs::read_to_string(&gitignore_path).unwrap_or_default();

    // Check if .worktrees is already ignored
    if existing_content.lines().any(|line| line.trim() == ".worktrees" || line.trim() == ".worktrees/") {
        return;
    }

    // Append .worktrees to .gitignore
    let new_content = if existing_content.is_empty() {
        ".worktrees/\n".to_string()
    } else if existing_content.ends_with('\n') {
        format!("{}.worktrees/\n", existing_content)
    } else {
        format!("{}\n.worktrees/\n", existing_content)
    };

    let _ = std::fs::write(&gitignore_path, new_content);
}

/// Initialize a new git repository
#[tauri::command]
pub fn init_git_repo(project_path: String) -> Result<(), String> {
    // Initialize git repo with main as the default branch
    let init_output = Command::new("git")
        .args(["-C", &project_path, "init", "-b", "main"])
        .output()
        .map_err(|e| format!("Failed to run git init: {}", e))?;

    if !init_output.status.success() {
        let stderr = String::from_utf8_lossy(&init_output.stderr);
        return Err(format!("Failed to initialize git: {}", stderr));
    }

    // Stage all files
    let _ = Command::new("git")
        .args(["-C", &project_path, "add", "-A"])
        .output();

    // Create initial commit (--allow-empty ensures it works even if no files)
    let commit_output = Command::new("git")
        .args(["-C", &project_path, "commit", "-m", "Initial commit", "--allow-empty"])
        .output()
        .map_err(|e| format!("Failed to create initial commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        // If it's just "nothing to commit", that's fine - but we need at least one commit
        // for worktrees to work, so try with --allow-empty explicitly
        if !stderr.contains("nothing to commit") {
            println!("[Git] Note: Initial commit message: {}", stderr);
        }
    }

    // Verify we have at least one commit (required for worktrees)
    let has_commits = Command::new("git")
        .args(["-C", &project_path, "rev-parse", "HEAD"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !has_commits {
        // Force create an empty commit
        let _ = Command::new("git")
            .args(["-C", &project_path, "commit", "--allow-empty", "-m", "Initial commit"])
            .output();
    }

    Ok(())
}

/// Get basic git info for a repository
#[tauri::command]
pub fn get_git_info(project_path: String) -> Result<GitInfo, String> {
    // Check if it's a git repo
    let status = Command::new("git")
        .args(["-C", &project_path, "rev-parse", "--git-dir"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !status.status.success() {
        return Ok(GitInfo {
            default_branch: "main".to_string(),
            remote_url: None,
            is_git_repo: false,
        });
    }

    // Get default branch
    let default_branch = Command::new("git")
        .args(["-C", &project_path, "symbolic-ref", "refs/remotes/origin/HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| {
            s.trim()
                .strip_prefix("refs/remotes/origin/")
                .unwrap_or("main")
                .to_string()
        })
        .unwrap_or_else(|| "main".to_string());

    // Get remote URL
    let remote_url = Command::new("git")
        .args(["-C", &project_path, "remote", "get-url", "origin"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            }
        });

    Ok(GitInfo {
        default_branch,
        remote_url,
        is_git_repo: true,
    })
}

/// Create a new worktree for a card
#[tauri::command]
pub fn create_worktree(
    project_path: String,
    card_id: String,
    card_title: String,
    card_type: String,
    base_branch: Option<String>,
) -> Result<WorktreeResult, String> {
    // Get git info to determine base branch
    let git_info = get_git_info(project_path.clone())?;
    if !git_info.is_git_repo {
        return Err("Not a git repository".to_string());
    }

    // Determine if we have a remote
    let has_remote = git_info.remote_url.is_some();

    // Get the current branch name (fallback for repos without remote)
    let current_branch = Command::new("git")
        .args(["-C", &project_path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "main".to_string());

    // Use provided base_branch, or default branch, or current branch
    let base = base_branch.unwrap_or_else(|| {
        if has_remote {
            git_info.default_branch.clone()
        } else {
            current_branch.clone()
        }
    });

    // Generate branch name and worktree path
    let slug = slugify(&card_title);
    let short_id = &card_id[..8.min(card_id.len())];
    let prefix = match card_type.as_str() {
        "bug" => "bugfix",
        "chore" => "chore",
        _ => "feature",
    };
    let branch_name = format!("{}/{}-{}", prefix, slug, short_id);

    let worktrees_dir = get_worktrees_dir(&project_path);
    let worktree_path = format!("{}/{}-{}-{}", worktrees_dir, prefix, slug, short_id);

    // Create worktrees directory if it doesn't exist
    std::fs::create_dir_all(&worktrees_dir)
        .map_err(|e| format!("Failed to create worktrees directory: {}", e))?;

    // Ensure .worktrees is in .gitignore
    ensure_worktrees_ignored(&project_path);

    // Try to fetch from remote if available
    if has_remote {
        let _ = Command::new("git")
            .args(["-C", &project_path, "fetch", "origin", &base])
            .output();
    }

    // Try to create the branch - order of attempts:
    // 1. From origin/base (if remote exists)
    // 2. From local base branch
    // 3. From HEAD
    let mut branch_created = false;

    if has_remote {
        let branch_output = Command::new("git")
            .args(["-C", &project_path, "branch", &branch_name, &format!("origin/{}", base)])
            .output();

        if let Ok(output) = branch_output {
            if output.status.success() {
                branch_created = true;
            }
        }
    }

    if !branch_created {
        // Try local base branch
        let branch_output = Command::new("git")
            .args(["-C", &project_path, "branch", &branch_name, &base])
            .output()
            .map_err(|e| format!("Failed to create branch: {}", e))?;

        if branch_output.status.success() {
            branch_created = true;
        } else {
            let stderr = String::from_utf8_lossy(&branch_output.stderr);
            // If branch already exists, that's OK
            if stderr.contains("already exists") {
                branch_created = true;
            } else {
                // Last resort: try from HEAD
                let branch_output_head = Command::new("git")
                    .args(["-C", &project_path, "branch", &branch_name, "HEAD"])
                    .output()
                    .map_err(|e| format!("Failed to create branch: {}", e))?;

                if branch_output_head.status.success() {
                    branch_created = true;
                } else {
                    let stderr_head = String::from_utf8_lossy(&branch_output_head.stderr);
                    if stderr_head.contains("already exists") {
                        branch_created = true;
                    } else {
                        return Err(format!("Failed to create branch: {}. Make sure the repository has at least one commit.", stderr_head));
                    }
                }
            }
        }
    }

    if !branch_created {
        return Err("Failed to create branch from any source".to_string());
    }

    // Create the worktree
    let worktree_output = Command::new("git")
        .args(["-C", &project_path, "worktree", "add", &worktree_path, &branch_name])
        .output()
        .map_err(|e| format!("Failed to create worktree: {}", e))?;

    if !worktree_output.status.success() {
        let stderr = String::from_utf8_lossy(&worktree_output.stderr);
        return Err(format!("Failed to create worktree: {}", stderr));
    }

    Ok(WorktreeResult {
        worktree_path,
        branch_name,
        base_branch: base,
    })
}

/// Remove a worktree
#[tauri::command]
pub fn remove_worktree(
    project_path: String,
    worktree_path: String,
) -> Result<(), String> {
    // Remove the worktree
    let output = Command::new("git")
        .args(["-C", &project_path, "worktree", "remove", &worktree_path, "--force"])
        .output()
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If worktree doesn't exist, that's OK
        if !stderr.contains("is not a working tree") {
            return Err(format!("Failed to remove worktree: {}", stderr));
        }
    }

    // Also try to remove the directory if it still exists
    let _ = std::fs::remove_dir_all(&worktree_path);

    Ok(())
}

/// Get diff stats between worktree and base branch
#[tauri::command]
pub fn get_diff_stats(
    worktree_path: String,
    base_branch: String,
) -> Result<DiffStats, String> {
    let output = Command::new("git")
        .args([
            "-C", &worktree_path,
            "diff", "--stat", &format!("origin/{}", base_branch)
        ])
        .output()
        .map_err(|e| format!("Failed to get diff: {}", e))?;

    if !output.status.success() {
        // Try without origin/ prefix
        let output2 = Command::new("git")
            .args(["-C", &worktree_path, "diff", "--stat", &base_branch])
            .output()
            .map_err(|e| format!("Failed to get diff: {}", e))?;

        if !output2.status.success() {
            return Ok(DiffStats {
                files_changed: 0,
                insertions: 0,
                deletions: 0,
            });
        }
    }

    // Parse numstat for accurate counts
    let numstat_output = Command::new("git")
        .args([
            "-C", &worktree_path,
            "diff", "--numstat", &format!("origin/{}", base_branch)
        ])
        .output()
        .unwrap_or_else(|_| {
            Command::new("git")
                .args(["-C", &worktree_path, "diff", "--numstat", &base_branch])
                .output()
                .unwrap()
        });

    let stdout = String::from_utf8_lossy(&numstat_output.stdout);
    let mut files_changed = 0u32;
    let mut insertions = 0u32;
    let mut deletions = 0u32;

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            files_changed += 1;
            insertions += parts[0].parse::<u32>().unwrap_or(0);
            deletions += parts[1].parse::<u32>().unwrap_or(0);
        }
    }

    Ok(DiffStats {
        files_changed,
        insertions,
        deletions,
    })
}

/// Check if GitHub CLI is installed and authenticated
#[tauri::command]
pub fn check_gh_cli() -> Result<GhStatus, String> {
    // Check if gh is installed
    let installed = Command::new("gh")
        .args(["--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !installed {
        return Ok(GhStatus {
            installed: false,
            authenticated: false,
        });
    }

    // Check if authenticated
    let authenticated = Command::new("gh")
        .args(["auth", "status"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    Ok(GhStatus {
        installed,
        authenticated,
    })
}

/// Create a pull request using GitHub CLI
#[tauri::command]
pub fn create_pull_request(
    worktree_path: String,
    title: String,
    body: String,
    base_branch: String,
    is_draft: bool,
) -> Result<PrResult, String> {
    // First push the branch
    let push_output = Command::new("git")
        .args(["-C", &worktree_path, "push", "-u", "origin", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to push: {}", e))?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err(format!("Failed to push branch: {}", stderr));
    }

    // Create the PR
    let mut args = vec![
        "pr", "create",
        "--title", &title,
        "--body", &body,
        "--base", &base_branch,
    ];

    if is_draft {
        args.push("--draft");
    }

    let pr_output = Command::new("gh")
        .args(&args)
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to create PR: {}", e))?;

    if !pr_output.status.success() {
        let stderr = String::from_utf8_lossy(&pr_output.stderr);
        return Err(format!("Failed to create PR: {}", stderr));
    }

    // Parse the PR URL from output
    let stdout = String::from_utf8_lossy(&pr_output.stdout);
    let pr_url = stdout.trim().to_string();

    // Extract PR number from URL
    let pr_number = pr_url
        .split('/')
        .last()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    Ok(PrResult {
        pr_url,
        pr_number,
    })
}
