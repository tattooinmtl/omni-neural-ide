//! Floating assistant.

use crate::app::Core;
use crate::drift;
use crate::eventbus::GraphEvent;
use crate::guard::{self, Action, Request};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use std::fs;

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
        desk.say("assistant", "Floating assistant ready.");
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
    pub fn steer(&mut self, text: &str) -> String {
        let text = text.trim();
        if text.is_empty() { return "usage: /steer <note>".into(); }
        self.harness.steering = Some(text.to_string());
        self.desk.say("you", text);
        self.desk.say("assistant", "Steering queued for the main agent.");
        self.bus.emit(GraphEvent::Intervention { source: "steer".into() });
        "steering queued".into()
    }

    pub fn assistant_note(&mut self, text: &str) -> Result<String, String> {
        let text = text.trim();
        if text.is_empty() { return Err("usage: /note <text>".into()); }
        self.append_notes(&format!("- {text}\n"))?;
        self.desk.say("assistant", "Noted.");
        Ok("noted".into())
    }

    pub fn assistant_mark(&mut self, path: &str, text: &str) -> Result<String, String> {
        let path = if path.trim().is_empty() { self.focus.clone().unwrap_or_else(|| "plan.md".into()) } else { path.trim().to_string() };
        let text = if text.trim().is_empty() { "(empty selection)".to_string() } else { text.trim().to_string() };
        let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.append_notes(&format!("- mark {path} @ {at}: {text}\n"))?;
        self.desk.marks.push(Mark { path: path.clone(), text: text.clone(), at });
        self.desk.say("assistant", &format!("Marked {path}"));
        Ok("marked".into())
    }

    pub fn assistant_audit(&mut self) -> String {
        let drift = if self.harness.drift.is_empty() { "drift: none".to_string() } else { self.harness.drift.iter().map(crate::drift::DriftFlag::label).collect::<Vec<_>>().join("\n") };
        let text = format!("audit (read-only)\n{drift}\nphase: {}", self.harness.phase.as_str());
        self.desk.say("assistant", &text);
        text
    }

    pub fn assistant_edit(&mut self, relative: &str, content: &str) -> Result<String, String> {
        let path = self.workspace_path(relative)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::write(&path, content).map_err(|err| err.to_string())?;
        self.desk.say("assistant", &format!("Edited {relative}."));
        Ok("edited".into())
    }

    pub fn set_voice(&mut self, on: bool) -> Result<String, String> {
        self.settings.voice_mode = on;
        self.desk.voice = on;
        self.settings.save(&self.settings_path)?;
        Ok(if on { "Voice on.".into() } else { "Voice off.".into() })
    }

    pub fn set_muted(&mut self, muted: bool) -> Result<String, String> {
        self.settings.muted = muted;
        self.desk.muted = muted;
        self.settings.save(&self.settings_path)?;
        Ok(if muted { "Muted.".into() } else { "Unmuted.".into() })
    }

    pub fn clear_drift_flag(&mut self) -> String {
        self.harness.clear_drift();
        self.desk.say("assistant", "Drift flags cleared.");
        "drift cleared".into()
    }

    fn append_notes(&mut self, line: &str) -> Result<(), String> {
        let path = self.harness.workspace.join("notes.md");
        let mut body = fs::read_to_string(&path).unwrap_or_else(|_| "# Notes\n".into());
        if !body.ends_with('\n') { body.push('\n'); }
        body.push_str(line);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::write(path, body).map_err(|err| err.to_string())
    }
}
