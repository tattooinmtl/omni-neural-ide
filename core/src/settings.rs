//! User settings for appearance, the harness, and the neural graph.
//!
//! Missing keys load as defaults so an older `settings.json` still opens.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DriftResponse {
    Warn,
    Pause,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Intervention {
    Pass,
    Hold,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
    pub version_style: String,
    pub voice_mode: bool,
    pub muted: bool,
    pub performance_mode: String,
    pub neural_graph: bool,
    pub particles: bool,
    pub animation_enabled: bool,
    pub sound_enabled: bool,
    pub drift_response: DriftResponse,
    pub intervention: Intervention,
    pub step_size: String,
    pub font_size: u8,
    pub tab_size: u8,
    pub node_toggles: NodeToggles,
    pub skills_enabled: bool,
    pub plugins_enabled: bool,
    pub dnd_until: Option<String>,
    pub confirm_destructive: bool,
    pub disabled_entries: BTreeSet<String>,
    pub keybindings: Keybindings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeToggles {
    pub projects: bool,
    pub files: bool,
    pub tools: bool,
    pub skills: bool,
    pub mcps: bool,
    pub hooks: bool,
    pub workers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keybindings {
    pub palette: String,
    pub run: String,
    pub accept: String,
    pub reject: String,
}

impl Default for NodeToggles {
    fn default() -> Self {
        Self {
            projects: true,
            files: true,
            tools: true,
            skills: true,
            mcps: true,
            hooks: true,
            workers: true,
        }
    }
}

impl Default for Keybindings {
    fn default() -> Self {
        Self {
            palette: "Ctrl+Shift+P".into(),
            run: "Ctrl+Enter".into(),
            accept: "Ctrl+Enter".into(),
            reject: "Ctrl+Backspace".into(),
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            version_style: "ultra".into(),
            voice_mode: false,
            muted: false,
            performance_mode: "balanced".into(),
            neural_graph: true,
            particles: true,
            animation_enabled: true,
            sound_enabled: false,
            drift_response: DriftResponse::Warn,
            intervention: Intervention::Pass,
            step_size: "batch".into(),
            // 13px matches the shell type size. Smaller than 11px becomes unreadable.
            font_size: 13,
            tab_size: 2,
            node_toggles: NodeToggles::default(),
            skills_enabled: true,
            plugins_enabled: true,
            dnd_until: None,
            confirm_destructive: true,
            disabled_entries: BTreeSet::new(),
            keybindings: Keybindings::default(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        let Ok(text) = fs::read_to_string(path) else {
            return Self::default();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|err| err.to_string())?;
        fs::write(path, json).map_err(|err| err.to_string())
    }

    pub fn dnd_active(&self) -> bool {
        let Some(until) = &self.dnd_until else {
            return false;
        };
        let Ok(deadline) = chrono::DateTime::parse_from_rfc3339(until) else {
            return false;
        };
        chrono::Utc::now() < deadline.with_timezone(&chrono::Utc)
    }
}
