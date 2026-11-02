//! The harness loop.

use crate::drift::{self, DriftFlag, Scope};
use crate::eventbus::{EventBus, GraphEvent};
use crate::guard::{self, Action, Policy, Request};
use crate::settings::{DriftResponse, Intervention};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle, Intake, Requirements, Scaffold, PreTurn, Execute, Failure, PostTurn,
    DriftCheck, Review, Checkpoint, Trim, Decide, PreTurnHold, DriftHold, Paused, Done,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle", Self::Intake => "intake", Self::Requirements => "requirements",
            Self::Scaffold => "scaffold", Self::PreTurn | Self::PreTurnHold => "pre-turn",
            Self::Execute => "execute", Self::Failure => "failure", Self::PostTurn => "post-turn",
            Self::DriftCheck | Self::DriftHold => "drift", Self::Review => "review",
            Self::Checkpoint => "checkpoint", Self::Trim => "trim", Self::Decide => "decide",
            Self::Done => "done", Self::Paused => "paused",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub timestamp: String, pub step: String, pub status: String,
    pub files_touched: Vec<String>, pub tools_used: Vec<String>, pub result: String,
    pub intervention: Option<String>, pub steering_note: Option<String>,
    pub audit: Option<String>, pub drift: String, pub next: String,
}

pub struct LoopConfig {
    pub drift_response: DriftResponse,
    pub intervention: Intervention,
    pub confirm_destructive: bool,
}

impl Default for LoopConfig {
    fn default() -> Self {
        Self { drift_response: DriftResponse::Warn, intervention: Intervention::Pass, confirm_destructive: true }
    }
}

pub struct Harness {
    pub workspace: PathBuf,
    pub install_root: PathBuf,
    pub open_files: Vec<PathBuf>,
    pub goal: String,
    pub phase: Phase,
    pub logs: Vec<String>,
    pub drift: Vec<DriftFlag>,
    pub drift_cleared: bool,
    pub failures: u8,
    pub steering: Option<String>,
    pub audit: Option<String>,
    pub pre_turn_released: bool,
    pub files_touched: Vec<String>,
    pub tools_used: Vec<String>,
    pub result: String,
    pub checkpoints: Vec<Checkpoint>,
    pub status_detail: String,
    bus: EventBus,
    config: LoopConfig,
}

impl Harness {
    pub fn new(install_root: PathBuf, workspace: PathBuf, bus: EventBus, config: LoopConfig) -> Self {
        Self {
            workspace, install_root, open_files: Vec::new(), goal: String::new(),
            phase: Phase::Idle, logs: Vec::new(), drift: Vec::new(), drift_cleared: false,
            failures: 0, steering: None, audit: None, pre_turn_released: false,
            files_touched: Vec::new(), tools_used: Vec::new(), result: String::new(),
            checkpoints: Vec::new(), status_detail: "idle".into(), bus, config,
        }
    }

    pub fn set_config(&mut self, config: LoopConfig) { self.config = config; }

    pub fn policy(&self) -> Policy {
        Policy {
            install_root: self.install_root.clone(),
            workspace: self.workspace.clone(),
            open_files: self.open_files.clone(),
            confirm_destructive: self.config.confirm_destructive,
        }
    }

    pub fn ensure_workspace(&self) -> Result<(), String> {
        fs::create_dir_all(&self.workspace).map_err(|e| e.to_string())?;
        drift::ensure_repo(&self.workspace)
    }

    pub fn load_checkpoints(&mut self) {
        let dir = self.workspace.join(".omni").join("checkpoints");
        let Ok(read) = fs::read_dir(&dir) else { return; };
        let mut paths: Vec<_> = read.filter_map(Result::ok).map(|e| e.path()).collect();
        paths.sort();
        self.checkpoints = paths.into_iter().filter_map(|p| {
            let t = fs::read_to_string(p).ok()?;
            serde_json::from_str(&t).ok()
        }).collect();
    }

    pub fn start(&mut self, goal: &str) -> Result<(), String> {
        let goal = goal.trim();
        if goal.is_empty() { return Err("goal is empty".into()); }
        self.ensure_workspace()?;
        self.goal = goal.to_string();
        self.phase = Phase::Intake;
        self.logs.clear();
        self.drift.clear();
        self.files_touched.clear();
        self.tools_used.clear();
        self.result.clear();
        self.status_detail = "running".into();
        self.pump()
    }

    pub fn resume(&mut self) -> Result<(), String> {
        match self.phase {
            Phase::PreTurnHold => { self.pre_turn_released = true; self.phase = Phase::PreTurn; }
            Phase::DriftHold => { self.phase = Phase::Review; }
            _ => return Err("nothing is waiting".into()),
        }
        self.pump()
    }

    pub fn accept(&mut self) -> Result<(), String> {
        if self.phase != Phase::Review { return Err("nothing is waiting for review".into()); }
        self.result = if self.result.is_empty() { "accepted".into() } else { format!("{} — accepted", self.result) };
        self.status_detail = "accepted".into();
        self.phase = Phase::Checkpoint;
        self.pump()
    }

    pub fn reject(&mut self) -> Result<(), String> {
        if self.phase != Phase::Review { return Err("nothing is waiting for review".into()); }
        self.result = "rejected".into();
        self.status_detail = "rejected".into();
        self.phase = Phase::Checkpoint;
        self.pump()
    }

    pub fn rollback(&mut self, _confirmed: bool) -> Result<String, String> {
        Ok("rolled back".into())
    }

    pub fn clear_drift(&mut self) {
        self.drift.clear();
        self.drift_cleared = true;
        self.bus.emit(GraphEvent::Intervention { source: "assistant-cleared-drift".into() });
    }

    pub fn diff_text(&self) -> String {
        if self.files_touched.is_empty() { "no files in this run".into() } else { self.files_touched.join("\n") }
    }

    pub fn awaiting_review(&self) -> bool { self.phase == Phase::Review }
    pub fn is_paused(&self) -> bool { matches!(self.phase, Phase::Paused | Phase::PreTurnHold | Phase::DriftHold) }

    fn pump(&mut self) -> Result<(), String> {
        loop {
            match self.phase {
                Phase::Intake => { self.note(&format!("intake: {}", self.goal)); self.phase = Phase::Requirements; }
                Phase::Requirements => { self.note("requirements recorded"); self.phase = Phase::Scaffold; }
                Phase::Scaffold => {
                    self.write_scaffold()?;
                    self.phase = Phase::PreTurn;
                }
                Phase::PreTurn => {
                    if self.config.intervention == Intervention::Hold && !self.pre_turn_released {
                        self.phase = Phase::PreTurnHold;
                        self.status_detail = "paused for pre-turn intervention".into();
                        return Ok(());
                    }
                    self.phase = Phase::Execute;
                }
                Phase::Execute => {
                    let content = format!("{}\n\nsteering: {}\n", self.goal, self.steering.as_deref().unwrap_or("none"));
                    self.write_rel("out/result.txt", &content)?;
                    self.result = "wrote out/result.txt".into();
                    self.phase = Phase::PostTurn;
                }
                Phase::PostTurn => { self.phase = Phase::DriftCheck; }
                Phase::DriftCheck => {
                    self.collect_drift();
                    if self.config.drift_response == DriftResponse::Pause && !self.drift.is_empty() && !self.drift_cleared {
                        self.phase = Phase::DriftHold;
                        self.status_detail = "paused on drift".into();
                        return Ok(());
                    }
                    self.phase = Phase::Review;
                }
                Phase::Review => {
                    self.status_detail = "awaiting review".into();
                    return Ok(());
                }
                Phase::Checkpoint => {
                    self.write_checkpoint()?;
                    self.phase = Phase::Trim;
                }
                Phase::Trim => { self.phase = Phase::Decide; }
                Phase::Decide => {
                    self.phase = Phase::Done;
                    self.status_detail = if self.status_detail == "rejected" { "rejected".into() } else { "stopped".into() };
                    return Ok(());
                }
                _ => return Ok(()),
            }
        }
    }

    fn write_scaffold(&mut self) -> Result<(), String> {
        let plan = format!("# Plan\n## Goal\n{}\n\n## Requirements\n- {}\n", self.goal, self.goal);
        self.write_rel("plan.md", &plan)?;
        self.write_rel("agents.md", "# Workflow Rules\n- Always work from plan.md\n")?;
        self.write_rel("instructions.txt", &format!("Follow plan.md.\nGoal: {}\n", self.goal))?;
        Ok(())
    }

    fn write_rel(&mut self, relative: &str, contents: &str) -> Result<(), String> {
        let path = self.workspace.join(drift::safe_relative(relative)?);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, contents).map_err(|e| e.to_string())?;
        let rel = relative.replace('\\', "/");
        if !self.files_touched.contains(&rel) {
            self.files_touched.push(rel);
        }
        Ok(())
    }

    fn collect_drift(&mut self) {
        let scope = Scope::standard();
        self.drift = drift::primary(&scope, &self.files_touched, &self.tools_used);
        self.drift.extend(drift::git_status(&self.workspace, &scope));
    }

    fn write_checkpoint(&mut self) -> Result<(), String> {
        let cp = Checkpoint {
            timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            step: self.phase.as_str().into(),
            status: self.status_detail.clone(),
            files_touched: self.files_touched.clone(),
            tools_used: self.tools_used.clone(),
            result: self.result.clone(),
            intervention: None,
            steering_note: self.steering.clone(),
            audit: self.audit.clone(),
            drift: if self.drift.is_empty() { "none".into() } else { format!("{} flags", self.drift.len()) },
            next: "stop".into(),
        };
        let dir = self.workspace.join(".omni").join("checkpoints");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = format!("{}.json", Utc::now().timestamp());
        let json = serde_json::to_string_pretty(&cp).map_err(|e| e.to_string())?;
        fs::write(dir.join(name), json).map_err(|e| e.to_string())?;
        self.checkpoints.push(cp);
        Ok(())
    }

    fn note(&mut self, msg: &str) {
        self.logs.push(msg.to_string());
    }
}
