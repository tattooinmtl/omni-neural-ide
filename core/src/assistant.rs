//! Floating assistant.
//!
//! Can steer the main agent, take notes, mark open files, edit open files,
//! run read-only audits (including system scan), copy/paste/rename within
//! workspace, create dirs, and surface browser/web search hints.
//! Writes always go through guardrails. System paths are scan-only.

use crate::app::Core;
use crate::drift::{self, Scope};
use crate::eventbus::GraphEvent;
use crate::guard::{self, Action, Request};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use std::fs;
use std::path::Path;

const TRANSCRIPT_LIMIT: usize = 80;

#[derive(Debug, Clone, Serialize)]
pub struct Line {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Mark {
    pub path: String,
    pub text: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Desk {
    pub voice: bool,
    pub muted: bool,
    pub lines: Vec<Line>,
    pub marks: Vec<Mark>,
}

impl Desk {
    pub fn new(voice: bool, muted: bool) -> Self {
        let mut desk = Self { voice, muted, lines: Vec::new(), marks: Vec::new() };
        desk.say(
            "assistant",
            "Assistant ready. I can steer, take notes, mark, edit open files, audit (scan-only on system), create dirs, and hint browser/search.",
        );
        desk
    }

    pub fn say(&mut self, role: &str, text: &str) {
        self.lines.push(Line { role: role.to_string(), text: text.to_string() });
        if self.lines.len() > TRANSCRIPT_LIMIT {
            let extra = self.lines.len() - TRANSCRIPT_LIMIT;
            self.lines.drain(0..extra);
        }
    }
}

impl Core {
    /// Queue a steering note for the main agent.
    pub fn steer(&mut self, text: &str) -> String {
        let text = text.trim();
        if text.is_empty() {
            return "usage: /steer <note>".into();
        }
        self.harness.steering = Some(text.to_string());
        self.desk.say("you", text);
        self.desk.say("assistant", "Steering queued for the main agent.");
        self.bus.emit(GraphEvent::Intervention { source: "steer".into() });
        "steering queued".into()
    }

    /// Append a note to notes.md.
    pub fn assistant_note(&mut self, text: &str) -> Result<String, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("usage: /note <text>".into());
        }
        self.append_notes(&format!("- {text}\n"))?;
        self.desk.say("you", text);
        self.desk.say("assistant", "Noted.");
        Ok("noted".into())
    }

    /// Mark a selection or line in the open file.
    pub fn assistant_mark(&mut self, path: &str, text: &str) -> Result<String, String> {
        let path = if path.trim().is_empty() {
            self.focus.clone().unwrap_or_else(|| "plan.md".into())
        } else {
            path.trim().to_string()
        };
        let text = {
            let trimmed = text.trim();
            if trimmed.is_empty() { "(empty selection)".to_string() } else { trimmed.to_string() }
        };
        let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.append_notes(&format!("- mark {path} @ {at}: {text}\n"))?;
        self.desk.marks.push(Mark { path: path.clone(), text: text.clone(), at });
        self.desk.say("assistant", &format!("Marked {path}: {text}"));
        self.bus.emit(GraphEvent::Intervention { source: "mark".into() });
        Ok("marked".into())
    }

    /// Read-only audit of workspace + optional system scan.
    pub fn assistant_audit(&mut self) -> String {
        let drift = if self.harness.drift.is_empty() {
            "drift: none".to_string()
        } else {
            self.harness.drift.iter().map(crate::drift::DriftFlag::label).collect::<Vec<_>>().join("\n")
        };
        let git = drift::git_status(&self.harness.workspace, &Scope::standard());
        let git_text = if git.is_empty() {
            "git: clean or in scope".to_string()
        } else {
            git.iter().map(crate::drift::DriftFlag::label).collect::<Vec<_>>().join("\n")
        };
        let text = format!(
            "audit (read-only)\n{drift}\n{git_text}\nopen files: {}\nphase: {}",
            self.harness.open_files.len(),
            self.harness.phase.as_str()
        );
        self.harness.audit = Some(text.clone());
        self.desk.say("assistant", &text);
        self.bus.emit(GraphEvent::Intervention { source: "audit".into() });
        text
    }

    /// Scan a system path (read-only). Refuses writes.
    pub fn assistant_scan(&mut self, path: &str) -> String {
        let p = Path::new(path);
        let verdict = guard::judge(
            &self.harness.policy(),
            Request { action: Action::Read, path: p, confirmed: false, assistant: false },
        );
        if !verdict.allowed() {
            let msg = format!("scan denied: {}", verdict.message());
            self.desk.say("assistant", &msg);
            return msg;
        }
        let info = if p.is_dir() {
            format!("dir: {} entries", fs::read_dir(p).map(|r| r.count()).unwrap_or(0))
        } else if p.is_file() {
            format!("file: {} bytes", fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        } else {
            "not found".into()
        };
        let text = format!("scan {path}: {info}");
        self.desk.say("assistant", &text);
        text
    }

    /// Edit an open file (assistant may only write open files).
    pub fn assistant_edit(&mut self, relative: &str, content: &str) -> Result<String, String> {
        let path = self.workspace_path(relative)?;
        let verdict = guard::judge(
            &self.harness.policy(),
            Request { action: Action::Write, path: &path, confirmed: false, assistant: true },
        );
        if !verdict.allowed() {
            let message = verdict.message().to_string();
            self.desk.say("assistant", &message);
            return Err(message);
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, content).map_err(|e| e.to_string())?;
        self.desk.say("assistant", &format!("Edited {relative}."));
        self.bus.emit(GraphEvent::FileTouched { path: relative.replace('\\', "/"), project: "workspace".into() });
        Ok("edited".into())
    }

    /// Create a directory inside the workspace.
    pub fn assistant_mkdir(&mut self, relative: &str) -> Result<String, String> {
        let path = self.workspace_path(relative)?;
        let verdict = guard::judge(
            &self.harness.policy(),
            Request { action: Action::Write, path: &path, confirmed: false, assistant: false },
        );
        if !verdict.allowed() {
            return Err(verdict.message().into());
        }
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        self.desk.say("assistant", &format!("Created dir {relative}"));
        Ok("created".into())
    }

    /// Hint for browser / web search (does not execute).
    pub fn assistant_search_hint(&mut self, query: &str) -> String {
        let text = format!("search hint: {query} (open browser or use web tool)");
        self.desk.say("assistant", &text);
        text
    }

    pub fn set_voice(&mut self, on: bool) -> Result<String, String> {
        self.settings.voice_mode = on;
        self.desk.voice = on;
        self.settings.save(&self.settings_path)?;
        let message = if on { "Voice on." } else { "Voice off." };
        self.desk.say("assistant", message);
        Ok(message.into())
    }

    pub fn set_muted(&mut self, muted: bool) -> Result<String, String> {
        self.settings.muted = muted;
        self.desk.muted = muted;
        self.settings.save(&self.settings_path)?;
        let message = if muted { "Muted." } else { "Unmuted." };
        self.desk.say("assistant", message);
        Ok(message.into())
    }

    pub fn clear_drift_flag(&mut self) -> String {
        self.harness.clear_drift();
        self.desk.say("assistant", "Drift flags cleared.");
        "drift cleared".into()
    }

    fn append_notes(&mut self, line: &str) -> Result<(), String> {
        let path = self.harness.workspace.join("notes.md");
        let verdict = guard::judge(
            &self.harness.policy(),
            Request { action: Action::Write, path: &path, confirmed: false, assistant: false },
        );
        if !verdict.allowed() {
            return Err(verdict.message().into());
        }
        let mut body = fs::read_to_string(&path).unwrap_or_else(|_| "# Notes\n".into());
        if !body.ends_with('\n') {
            body.push('\n');
        }
        body.push_str(line);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(path, body).map_err(|e| e.to_string())
    }
}
