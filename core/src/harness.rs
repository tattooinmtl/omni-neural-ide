//! The 12-step harness loop.
//!
//! Agents do not scaffold. This type writes `plan.md`, `agents.md`, and
//! `instructions.txt`, runs one worker turn, checks drift, then waits at the
//! review gate. A failed turn is retried once and then the run pauses.

use crate::drift::{self, DriftFlag, Scope};
use crate::eventbus::{EventBus, GraphEvent};
use crate::guard::{self, Action, Policy, Request, Verdict};
use crate::settings::{DriftResponse, Intervention};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// One automatic retry after the first failed execution turn.
const EXECUTION_RETRIES: u8 = 1;

/// Run log lines kept after the trim step.
///
/// Forty lines cover one intake plus its checkpoint. Older lines are the
/// context the harness drops before the next goal.
const CONTEXT_LIMIT: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Intake,
    Requirements,
    Scaffold,
    PreTurn,
    Execute,
    Failure,
    PostTurn,
    DriftCheck,
    Review,
    Checkpoint,
    Trim,
    Decide,
    PreTurnHold,
    DriftHold,
    Paused,
    Done,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Intake => "intake",
            Self::Requirements => "requirements",
            Self::Scaffold => "scaffold",
            Self::PreTurn | Self::PreTurnHold => "pre-turn",
            Self::Execute => "execute",
            Self::Failure => "failure",
            Self::PostTurn => "post-turn",
            Self::DriftCheck | Self::DriftHold => "drift",
            Self::Review => "review",
            Self::Checkpoint => "checkpoint",
            Self::Trim => "trim",
            Self::Decide => "decide",
            Self::Done => "done",
            Self::Paused => "paused",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub timestamp: String,
    pub step: String,
    pub status: String,
    pub files_touched: Vec<String>,
    pub tools_used: Vec<String>,
    pub result: String,
    pub intervention: Option<String>,
    pub steering_note: Option<String>,
    pub audit: Option<String>,
    pub drift: String,
    pub next: String,
}

#[derive(Debug, Clone)]
struct Snapshot {
    path: PathBuf,
    previous: Option<String>,
}

pub struct FileWrite {
    pub relative_path: String,
    pub contents: String,
}

pub struct TurnOutput {
    pub writes: Vec<FileWrite>,
    pub tools_used: Vec<String>,
    pub summary: String,
}

pub struct Job<'a> {
    pub goal: &'a str,
    pub steering: Option<&'a str>,
    pub workspace: &'a Path,
    pub attempt: u8,
}

pub trait Worker: Send {
    fn turn(&mut self, job: &Job<'_>) -> Result<TurnOutput, String>;
}

/// Default worker. Writes the goal into `out/result.txt`.
#[derive(Debug, Default)]
pub struct Scribe;

impl Worker for Scribe {
    fn turn(&mut self, job: &Job<'_>) -> Result<TurnOutput, String> {
        let steering = job.steering.unwrap_or("none");
        let folder = job
            .workspace
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "workspace".into());
        Ok(TurnOutput {
            writes: vec![FileWrite {
                relative_path: "out/result.txt".into(),
                contents: format!("{}\n\nsteering: {steering}\nattempt: {}\n", job.goal, job.attempt),
            }],
            tools_used: vec!["write_file".into()],
            summary: format!("wrote out/result.txt in {folder}"),
        })
    }
}

pub struct LoopConfig {
    pub drift_response: DriftResponse,
    pub intervention: Intervention,
    pub confirm_destructive: bool,
}

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            drift_response: DriftResponse::Warn,
            intervention: Intervention::Pass,
            confirm_destructive: true,
        }
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
    worker: Box<dyn Worker>,
    snapshots: Vec<Snapshot>,
    project_name: String,
}

impl Harness {
    pub fn new(install_root: PathBuf, workspace: PathBuf, bus: EventBus, config: LoopConfig) -> Self {
        Self::with_worker(install_root, workspace, bus, config, Box::new(Scribe))
    }

    pub fn with_worker(
        install_root: PathBuf,
        workspace: PathBuf,
        bus: EventBus,
        config: LoopConfig,
        worker: Box<dyn Worker>,
    ) -> Self {
        let project_name = workspace
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "workspace".into());
        Self {
            workspace,
            install_root,
            open_files: Vec::new(),
            goal: String::new(),
            phase: Phase::Idle,
            logs: Vec::new(),
            drift: Vec::new(),
            drift_cleared: false,
            failures: 0,
            steering: None,
            audit: None,
            pre_turn_released: false,
            files_touched: Vec::new(),
            tools_used: Vec::new(),
            result: String::new(),
            checkpoints: Vec::new(),
            status_detail: "idle".into(),
            bus,
            config,
            worker,
            snapshots: Vec::new(),
            project_name,
        }
    }

    pub fn set_config(&mut self, config: LoopConfig) {
        self.config = config;
    }

    pub fn policy(&self) -> Policy {
        Policy {
            install_root: self.install_root.clone(),
            workspace: self.workspace.clone(),
            open_files: self.open_files.clone(),
            confirm_destructive: self.config.confirm_destructive,
        }
    }

    pub fn ensure_workspace(&self) -> Result<(), String> {
        fs::create_dir_all(&self.workspace).map_err(|err| err.to_string())?;
        drift::ensure_repo(&self.workspace)
    }

    pub fn load_checkpoints(&mut self) {
        let dir = self.workspace.join(".omni").join("checkpoints");
        let Ok(read) = fs::read_dir(&dir) else {
            return;
        };
        let mut paths: Vec<PathBuf> = read.filter_map(Result::ok).map(|entry| entry.path()).collect();
        paths.sort();
        self.checkpoints = paths
            .into_iter()
            .filter_map(|path| {
                let text = fs::read_to_string(path).ok()?;
                serde_json::from_str(&text).ok()
            })
            .collect();
    }

    pub fn start(&mut self, goal: &str) -> Result<(), String> {
        let goal = goal.trim();
        if goal.is_empty() {
            return Err("goal is empty".into());
        }
        if self.phase == Phase::Review {
            return Err("finish the review gate before the next goal".into());
        }
        self.ensure_workspace()?;
        self.goal = goal.to_string();
        self.phase = Phase::Intake;
        self.logs.clear();
        self.drift.clear();
        self.drift_cleared = false;
        self.failures = 0;
        self.pre_turn_released = false;
        self.files_touched.clear();
        self.tools_used.clear();
        self.result.clear();
        self.snapshots.clear();
        self.status_detail = "running".into();
        self.pump()
    }

    pub fn resume(&mut self) -> Result<(), String> {
        match self.phase {
            Phase::PreTurnHold => {
                self.pre_turn_released = true;
                self.phase = Phase::PreTurn;
            }
            Phase::DriftHold => {
                self.phase = Phase::Review;
            }
            Phase::Paused => return Err(self.status_detail.clone()),
            _ => return Err("nothing is waiting".into()),
        }
        self.pump()
    }

    pub fn accept(&mut self) -> Result<(), String> {
        if self.phase != Phase::Review {
            return Err("nothing is waiting for review".into());
        }
        self.result = if self.result.is_empty() {
            "accepted".into()
        } else {
            format!("{} — accepted", self.result)
        };
        self.status_detail = "accepted".into();
        self.phase = Phase::Checkpoint;
        self.pump()
    }

    pub fn reject(&mut self) -> Result<(), String> {
        if self.phase != Phase::Review {
            return Err("nothing is waiting for review".into());
        }
        self.restore_snapshots()?;
        self.result = "rejected".into();
        self.status_detail = "rejected".into();
        self.phase = Phase::Checkpoint;
        self.pump()
    }

    pub fn rollback(&mut self, confirmed: bool) -> Result<String, String> {
        if self.snapshots.is_empty() {
            return Err("nothing to roll back".into());
        }
        let policy = self.policy();
        for snap in &self.snapshots {
            let verdict = guard::judge(
                &policy,
                Request {
                    action: Action::Delete,
                    path: &snap.path,
                    confirmed,
                    assistant: false,
                },
            );
            if verdict == Verdict::NeedsConfirmation {
                return Err(verdict.message().into());
            }
            if !verdict.allowed() {
                return Err(verdict.message().into());
            }
        }
        self.restore_snapshots()?;
        self.note("rolled back the last run");
        Ok("rolled back".into())
    }

    pub fn clear_drift(&mut self) {
        self.drift.clear();
        self.drift_cleared = true;
        self.bus.emit(GraphEvent::Intervention {
            source: "assistant-cleared-drift".into(),
        });
        self.note("assistant cleared drift flags");
    }

    pub fn diff_text(&self) -> String {
        if self.files_touched.is_empty() {
            return "no files in this run".into();
        }
        self.files_touched.join("\n")
    }

    pub fn pump(&mut self) -> Result<(), String> {
        loop {
            let step = self.phase.as_str().to_string();
            self.bus.emit(GraphEvent::StepStarted { step: step.clone() });
            match self.phase {
                Phase::Intake => {
                    self.note(&format!("intake: {}", self.goal));
                    self.phase = Phase::Requirements;
                }
                Phase::Requirements => {
                    self.note("requirements recorded");
                    self.phase = Phase::Scaffold;
                }
                Phase::Scaffold => {
                    self.write_scaffold()?;
                    self.phase = Phase::PreTurn;
                }
                Phase::PreTurn => {
                    if self.config.intervention == Intervention::Hold && !self.pre_turn_released {
                        self.phase = Phase::PreTurnHold;
                        self.status_detail = "paused for pre-turn intervention".into();
                        let detail = self.status_detail.clone();
                        self.note(&detail);
                        return Ok(());
                    }
                    if let Some(steering) = &self.steering {
                        self.note(&format!("steering: {steering}"));
                        self.bus.emit(GraphEvent::Intervention {
                            source: "steer".into(),
                        });
                    }
                    self.phase = Phase::Execute;
                }
                Phase::Execute => {
                    let goal = self.goal.clone();
                    let steering = self.steering.clone();
                    let workspace = self.workspace.clone();
                    let attempt = self.failures;
                    match self.worker.turn(&Job {
                        goal: &goal,
                        steering: steering.as_deref(),
                        workspace: &workspace,
                        attempt,
                    }) {
                        Ok(output) => {
                            self.apply_turn(output)?;
                            self.phase = Phase::PostTurn;
                        }
                        Err(err) => {
                            self.result = err;
                            self.phase = Phase::Failure;
                        }
                    }
                }
                Phase::Failure => {
                    self.note(&format!("failure: {}", self.result));
                    if self.failures < EXECUTION_RETRIES {
                        self.failures += 1;
                        self.note("retry 1");
                        self.phase = Phase::Execute;
                    } else {
                        self.status_detail = format!("paused after retry: {}", self.result);
                        self.phase = Phase::Paused;
                        self.write_checkpoint("paused", "stopped")?;
                        return Ok(());
                    }
                }
                Phase::PostTurn => {
                    if let Some(audit) = &self.audit {
                        self.note(&format!("post-turn audit: {audit}"));
                    } else {
                        self.note("post-turn");
                    }
                    self.phase = Phase::DriftCheck;
                }
                Phase::DriftCheck => {
                    self.collect_drift();
                    if self.config.drift_response == DriftResponse::Pause
                        && !self.drift.is_empty()
                        && !self.drift_cleared
                    {
                        self.phase = Phase::DriftHold;
                        self.status_detail = "paused on drift".into();
                        let detail = self.status_detail.clone();
                        self.note(&detail);
                        return Ok(());
                    }
                    self.phase = Phase::Review;
                }
                Phase::Review => {
                    self.status_detail = "awaiting review".into();
                    self.note("review gate");
                    return Ok(());
                }
                Phase::Checkpoint => {
                    let status = if self.status_detail == "rejected" {
                        "rejected"
                    } else {
                        "completed"
                    };
                    self.write_checkpoint(status, "stop")?;
                    self.phase = Phase::Trim;
                }
                Phase::Trim => {
                    if self.logs.len() > CONTEXT_LIMIT {
                        let drop_count = self.logs.len() - CONTEXT_LIMIT;
                        self.logs.drain(0..drop_count);
                    }
                    self.note("context trimmed");
                    self.phase = Phase::Decide;
                }
                Phase::Decide => {
                    self.phase = Phase::Done;
                    self.status_detail = if self.status_detail == "rejected" {
                        "rejected".into()
                    } else {
                        "stopped".into()
                    };
                    self.note("stopped");
                    return Ok(());
                }
                Phase::Idle | Phase::Done | Phase::Paused | Phase::PreTurnHold | Phase::DriftHold => {
                    return Ok(());
                }
            }
            self.bus.emit(GraphEvent::StepFinished { step });
        }
    }

    fn write_scaffold(&mut self) -> Result<(), String> {
        let plan = format!(
            "# Plan\n## Goal\n{}\n\n## Requirements\n- {}\n\n## Steps\n- [x] 1. Requirements analysis\n- [x] 2. Scaffold\n- [ ] 3. Execution\n",
            self.goal, self.goal
        );
        let agents = "\
# Workflow Rules\n\
- Always work from plan.md\n\
- Never modify scaffolding files directly\n\
- Allowed tools come from the registry\n\
- Checkpoint after every completed step\n";
        let instructions = format!(
            "Follow plan.md.\nGoal: {}\nStay inside the workspace.\nUse only registry tools.\nCheckpoint after every completed step.\n",
            self.goal
        );
        self.write_rel("plan.md", &plan, "harness")?;
        self.write_rel("agents.md", agents, "harness")?;
        self.write_rel("instructions.txt", &instructions, "harness")?;
        Ok(())
    }

    fn apply_turn(&mut self, output: TurnOutput) -> Result<(), String> {
        for write in &output.writes {
            drift::safe_relative(&write.relative_path)?;
        }
        for write in output.writes {
            self.write_rel(&write.relative_path, &write.contents, "write_file")?;
        }
        self.tools_used.extend(output.tools_used);
        self.result = output.summary;
        if let Some(plan) = self.read_workspace_rel("plan.md") {
            let updated = plan.replace("- [ ] 3. Execution", "- [x] 3. Execution");
            if updated != plan {
                self.write_rel("plan.md", &updated, "harness")?;
            }
        }
        Ok(())
    }

    fn write_rel(&mut self, relative: &str, contents: &str, tool: &str) -> Result<(), String> {
        let relative_buf = drift::safe_relative(relative)?;
        let path = self.workspace.join(&relative_buf);
        let verdict = guard::judge(
            &self.policy(),
            Request {
                action: Action::Write,
                path: &path,
                confirmed: false,
                assistant: false,
            },
        );
        if !verdict.allowed() {
            return Err(format!("{relative}: {}", verdict.message()));
        }
        self.snapshot(&path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::write(&path, contents).map_err(|err| err.to_string())?;
        let rel = relative.replace('\\', "/");
        if !self.files_touched.contains(&rel) {
            self.files_touched.push(rel.clone());
        }
        if !self.tools_used.iter().any(|used| used == tool) {
            self.tools_used.push(tool.to_string());
        }
        self.bus.emit(GraphEvent::FileTouched {
            path: rel,
            project: self.project_name.clone(),
        });
        self.bus.emit(GraphEvent::ToolCalled {
            tool: tool.to_string(),
            project: self.project_name.clone(),
        });
        Ok(())
    }

    fn snapshot(&mut self, path: &Path) {
        if self.snapshots.iter().any(|snap| snap.path == path) {
            return;
        }
        let previous = fs::read_to_string(path).ok();
        self.snapshots.push(Snapshot {
            path: path.to_path_buf(),
            previous,
        });
    }

    fn restore_snapshots(&mut self) -> Result<(), String> {
        for snap in self.snapshots.drain(..) {
            match &snap.previous {
                Some(contents) => fs::write(&snap.path, contents).map_err(|err| err.to_string())?,
                None => {
                    if snap.path.exists() {
                        fs::remove_file(&snap.path).map_err(|err| err.to_string())?;
                    }
                }
            }
        }
        self.files_touched.clear();
        Ok(())
    }

    fn collect_drift(&mut self) {
        if self.drift_cleared {
            return;
        }
        let scope = Scope::standard();
        let mut flags = drift::primary(&scope, &self.files_touched, &self.tools_used);
        for flag in drift::git_status(&self.workspace, &scope) {
            if !flags.contains(&flag) {
                flags.push(flag);
            }
        }
        for flag in &flags {
            self.bus.emit(GraphEvent::DriftFlagged {
                path: flag.label(),
            });
        }
        if flags.is_empty() {
            self.note("drift: none");
        } else {
            self.note(&format!("drift: {} flag(s)", flags.len()));
        }
        self.drift = flags;
    }

    fn write_checkpoint(&mut self, status: &str, next: &str) -> Result<(), String> {
        let checkpoint = Checkpoint {
            timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            step: self.phase.as_str().to_string(),
            status: status.into(),
            files_touched: self.files_touched.clone(),
            tools_used: self.tools_used.clone(),
            result: self.result.clone(),
            intervention: None,
            steering_note: self.steering.clone(),
            audit: self.audit.clone(),
            drift: if self.drift.is_empty() {
                "none".into()
            } else {
                self.drift.iter().map(DriftFlag::label).collect::<Vec<_>>().join("; ")
            },
            next: next.into(),
        };
        let dir = self.workspace.join(".omni").join("checkpoints");
        fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        let stamp = checkpoint.timestamp.replace([':', '.'], "-");
        let path = dir.join(format!("{stamp}.json"));
        let json = serde_json::to_string_pretty(&checkpoint).map_err(|err| err.to_string())?;
        fs::write(path, json).map_err(|err| err.to_string())?;
        self.checkpoints.push(checkpoint);
        // The checkpoint directory is allow-listed, so this write is not a new drift event.
        Ok(())
    }

    fn read_workspace_rel(&self, relative: &str) -> Option<String> {
        fs::read_to_string(self.workspace.join(relative)).ok()
    }

    pub fn note(&mut self, text: &str) {
        self.logs.push(text.to_string());
    }

    pub fn awaiting_review(&self) -> bool {
        self.phase == Phase::Review
    }

    pub fn is_paused(&self) -> bool {
        matches!(self.phase, Phase::Paused | Phase::PreTurnHold | Phase::DriftHold)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailTimes {
        left: u8,
    }

    impl Worker for FailTimes {
        fn turn(&mut self, _job: &Job<'_>) -> Result<TurnOutput, String> {
            if self.left > 0 {
                self.left -= 1;
                return Err("worker broke".into());
            }
            Ok(TurnOutput {
                writes: vec![FileWrite {
                    relative_path: "out/result.txt".into(),
                    contents: "recovered\n".into(),
                }],
                tools_used: vec!["write_file".into()],
                summary: "recovered".into(),
            })
        }
    }

    struct Sneak;

    impl Worker for Sneak {
        fn turn(&mut self, _job: &Job<'_>) -> Result<TurnOutput, String> {
            Ok(TurnOutput {
                writes: vec![FileWrite {
                    relative_path: "sneak.txt".into(),
                    contents: "outside scope\n".into(),
                }],
                tools_used: vec!["write_file".into()],
                summary: "sneaked".into(),
            })
        }
    }

    fn temp_harness(label: &str, worker: Box<dyn Worker>, config: LoopConfig) -> Harness {
        let root = std::env::temp_dir().join(format!("omni-loop-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("workspace")).unwrap();
        Harness::with_worker(root.clone(), root.join("workspace"), EventBus::new(), config, worker)
    }

    #[test]
    fn scaffold_reaches_review_and_accept_trims() {
        let mut harness = temp_harness("accept", Box::new(Scribe), LoopConfig::default());
        harness.start("build a parser").unwrap();
        assert!(harness.awaiting_review());
        assert!(harness.workspace.join("plan.md").is_file());
        assert!(harness.workspace.join("agents.md").is_file());
        assert!(harness.workspace.join("instructions.txt").is_file());
        assert!(harness.workspace.join("out").join("result.txt").is_file());
        assert!(harness.drift.is_empty(), "{:?}", harness.drift);
        for _ in 0..50 {
            harness.note("pad");
        }
        harness.accept().unwrap();
        assert_eq!(harness.phase, Phase::Done);
        assert!(harness.logs.len() <= CONTEXT_LIMIT + 2);
        assert!(!harness.checkpoints.is_empty());
        let _ = fs::remove_dir_all(harness.install_root);
    }

    #[test]
    fn one_failure_retries_then_a_second_pauses() {
        let mut once = temp_harness("retry", Box::new(FailTimes { left: 1 }), LoopConfig::default());
        once.start("retry me").unwrap();
        assert!(once.awaiting_review(), "{}", once.status_detail);
        assert!(once.logs.iter().any(|line| line.contains("retry 1")));
        let _ = fs::remove_dir_all(once.install_root);

        let mut twice = temp_harness("pause", Box::new(FailTimes { left: 2 }), LoopConfig::default());
        twice.start("pause me").unwrap();
        assert_eq!(twice.phase, Phase::Paused);
        assert!(twice.status_detail.contains("paused after retry"));
        let _ = fs::remove_dir_all(twice.install_root);
    }

    #[test]
    fn unexpected_file_pauses_when_configured() {
        let config = LoopConfig {
            drift_response: DriftResponse::Pause,
            ..LoopConfig::default()
        };
        let mut harness = temp_harness("drift", Box::new(Sneak), config);
        harness.start("drift").unwrap();
        assert_eq!(harness.phase, Phase::DriftHold);
        harness.clear_drift();
        harness.resume().unwrap();
        assert!(harness.awaiting_review());
        let _ = fs::remove_dir_all(harness.install_root);
    }

    #[test]
    fn reject_restores_files_that_did_not_exist() {
        let mut harness = temp_harness("reject", Box::new(Scribe), LoopConfig::default());
        harness.start("discard").unwrap();
        harness.reject().unwrap();
        assert!(!harness.workspace.join("plan.md").exists());
        assert_eq!(harness.phase, Phase::Done);
        let _ = fs::remove_dir_all(harness.install_root);
    }
}
