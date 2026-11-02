//! Process state: settings, registry, harness, and the assistant desk.

use crate::assistant::Desk;
use crate::drift::{self, DriftFlag};
use crate::emotion::{Emotion, EmotionState};
use crate::eventbus::EventBus;
use crate::guard::{self, Action, Request};
use crate::harness::{Checkpoint, Harness, LoopConfig};
use crate::registry::Registry;
use crate::settings::Settings;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct RunDto {
    pub goal: String,
    pub phase: String,
    pub detail: String,
    pub logs: Vec<String>,
    pub drift: Vec<String>,
    pub files_touched: Vec<String>,
    pub awaiting_review: bool,
    pub paused: bool,
    pub result: String,
}

#[derive(Serialize)]
pub struct StateDto {
    pub settings: Settings,
    pub registry: Registry,
    pub run: RunDto,
    pub assistant: Desk,
    pub emotion: EmotionState,
    pub files: Vec<String>,
    pub focus: Option<String>,
    pub problems: Vec<String>,
    pub checkpoints: Vec<Checkpoint>,
}

pub struct Core {
    pub install_root: PathBuf,
    pub settings_path: PathBuf,
    pub settings: Settings,
    pub registry: Registry,
    pub bus: EventBus,
    pub harness: Harness,
    pub desk: Desk,
    pub emotion: EmotionState,
    pub focus: Option<String>,
    pub username: String,
}

impl Core {
    pub fn boot(install_root: PathBuf) -> Self {
        let install_root = install_root.canonicalize().unwrap_or(install_root);
        let settings_path = install_root.join("settings.json");
        let settings = Settings::load(&settings_path);
        let mut registry = Registry::load(&install_root);
        registry.apply_disabled(&settings.disabled_entries);
        let workspace = install_root.join("workspace");
        let bus = EventBus::new();
        let harness = Harness::new(install_root.clone(), workspace, bus.clone(), config_from(&settings));
        if let Err(err) = harness.ensure_workspace() {
            tracing::warn!(error = %err, "workspace was not created");
        }
        let mut harness = harness;
        harness.load_checkpoints();
        let desk = Desk::new(settings.voice_mode, settings.muted);
        let username = std::env::var("USERNAME").unwrap_or_else(|_| "there".into());
        Self {
            install_root,
            settings_path,
            settings,
            registry,
            bus,
            harness,
            desk,
            emotion: EmotionState::default(),
            focus: None,
            username,
        }
    }

    pub fn view(&self) -> StateDto {
        let mut problems: Vec<String> = self.harness.drift.iter().map(DriftFlag::label).collect();
        if self.harness.is_paused() {
            problems.insert(0, self.harness.status_detail.clone());
        }
        if problems.is_empty() {
            problems.push("drift: none".into());
        }
        let mut checkpoints = self.harness.checkpoints.clone();
        if checkpoints.len() > 20 {
            checkpoints.drain(0..checkpoints.len() - 20);
        }
        StateDto {
            settings: self.settings.clone(),
            registry: self.registry.clone(),
            run: RunDto {
                goal: self.harness.goal.clone(),
                phase: self.harness.phase.as_str().to_string(),
                detail: self.harness.status_detail.clone(),
                logs: self.harness.logs.clone(),
                drift: self.harness.drift.iter().map(DriftFlag::label).collect(),
                files_touched: self.harness.files_touched.clone(),
                awaiting_review: self.harness.awaiting_review(),
                paused: self.harness.is_paused(),
                result: self.harness.result.clone(),
            },
            assistant: self.desk.clone(),
            emotion: self.emotion.clone(),
            files: workspace_files(&self.harness.workspace),
            focus: self.focus.clone(),
            problems,
            checkpoints,
        }
    }

    pub fn intake(&mut self, goal: &str) -> Result<(), String> {
        if self.settings.dnd_active() {
            return Err("do not disturb is on".into());
        }
        self.push_config();
        self.harness.start(goal)?;
        self.emotion.user_talked();
        self.desk.say("you", goal.trim());
        let phase = self.harness.phase.as_str();
        self.desk.say("assistant", &format!("Main agent is at {phase}."));
        Ok(())
    }

    pub fn resume_run(&mut self) -> Result<(), String> {
        self.harness.resume()
    }

    pub fn apply_settings(&mut self, mut settings: Settings) -> Result<(), String> {
        if settings.theme != "light" && settings.theme != "dark" {
            settings.theme = "dark".into();
        }
        if settings.version_style != "plain" && settings.version_style != "ultra" {
            settings.version_style = "ultra".into();
        }
        settings.font_size = settings.font_size.clamp(11, 22);
        settings.tab_size = settings.tab_size.clamp(1, 8);
        settings.save(&self.settings_path)?;
        self.settings = settings;
        self.registry.apply_disabled(&self.settings.disabled_entries);
        self.push_config();
        self.desk.voice = self.settings.voice_mode;
        self.desk.muted = self.settings.muted;
        Ok(())
    }

    pub fn open_project_file(&mut self, relative: &str) -> Result<String, String> {
        let path = self.workspace_path(relative)?;
        let text = fs::read_to_string(&path).unwrap_or_default();
        self.focus = Some(relative.replace('\\', "/"));
        Ok(text)
    }

    pub fn save_project_file(&mut self, relative: &str, content: &str) -> Result<(), String> {
        let path = self.workspace_path(relative)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::write(&path, content).map_err(|err| err.to_string())?;
        self.focus = Some(relative.replace('\\', "/"));
        Ok(())
    }

    pub fn workspace_path(&self, relative: &str) -> Result<PathBuf, String> {
        let relative = drift::safe_relative(relative)?;
        Ok(self.harness.workspace.join(relative))
    }

    /// Check idle/AFK and emit a line if needed.
    pub fn tick_emotion(&mut self) -> Option<String> {
        if self.emotion.should_call_afk() {
            self.emotion.last_idle_call = now_secs();
            let line = self.emotion.idle_line(&self.username);
            self.desk.say("assistant", &line);
            self.write_diary(&line);
            return Some(line);
        }
        if self.emotion.should_check_in() {
            self.emotion.last_idle_call = now_secs();
            let line = self.emotion.check_in_line(&self.username);
            self.desk.say("assistant", &line);
            self.write_diary(&line);
            return Some(line);
        }
        None
    }

    pub fn write_diary(&mut self, note: &str) {
        let path = self.harness.workspace.join("nim_diary.md");
        let entry = self.emotion.diary_entry(note);
        let mut body = fs::read_to_string(&path).unwrap_or_else(|_| "# NIM Diary\n".into());
        if !body.ends_with('\n') {
            body.push('\n');
        }
        body.push_str(&entry);
        let _ = fs::write(path, body);
    }

    pub fn set_emotion(&mut self, emotion: Emotion) {
        self.emotion.shift_toward(emotion);
        self.desk.say("assistant", &format!("(mood: {})", emotion.name()));
    }

    fn push_config(&mut self) {
        self.harness.set_config(config_from(&self.settings));
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn locate_install_root() -> PathBuf {
    if let Ok(home) = std::env::var("OMNI_HOME") {
        return PathBuf::from(home);
    }
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors().take(6) {
            if ancestor.join("DESIGN.md").is_file() && ancestor.join("ui").is_dir() {
                return ancestor.to_path_buf();
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn config_from(settings: &Settings) -> LoopConfig {
    LoopConfig {
        drift_response: settings.drift_response,
        intervention: settings.intervention,
        confirm_destructive: settings.confirm_destructive,
    }
}

fn workspace_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
    const FILE_CAP: usize = 200;
    if out.len() >= FILE_CAP { return; }
    let Ok(read) = fs::read_dir(dir) else { return; };
    let mut entries: Vec<_> = read.filter_map(Result::ok).collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" || name == ".omni" || name == "target" || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            walk(&path, root, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
        if out.len() >= FILE_CAP { return; }
    }
}
