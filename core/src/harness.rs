use crate::drift::{Drift, DriftDetector, StepScope};
use crate::registry::Registry;
use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

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

pub struct Harness {
    pub registry: Registry,
    pub settings: Settings,
    pub project_root: PathBuf,
    pub plan_path: PathBuf,
    pub instructions_path: PathBuf,
    pub settings_path: PathBuf,
}

impl Harness {
    pub async fn new(project_root: PathBuf) -> Self {
        let settings_path = project_root.join("settings.json");
        let settings = Settings::load(&settings_path).await;
        Self {
            registry: Registry::default(),
            settings,
            project_root: project_root.clone(),
            plan_path: project_root.join("plan.md"),
            instructions_path: project_root.join("instructions.txt"),
            settings_path,
        }
    }

    pub async fn execute_step(
        &mut self,
        step_name: &str,
        scope: &StepScope,
        tools_used: &[String],
        steering_note: Option<String>,
    ) -> Checkpoint {
        println!("[harness] step: {} (size={})", step_name, self.settings.step_size);

        let drifts = DriftDetector::from_workdir(&self.project_root, scope, tools_used);
        let has_drift = drifts.iter().any(|d| !matches!(d, Drift::None));
        let drift_str = if has_drift {
            format!("flagged: {:?}", drifts)
        } else {
            "none".into()
        };

        if has_drift && self.settings.drift_response == "pause" {
            println!("[harness] drift pause");
        }

        let checkpoint = Checkpoint {
            timestamp: chrono_lite(),
            step: step_name.to_string(),
            status: "completed".into(),
            files_touched: scope.expected_files.iter().map(|p| p.display().to_string()).collect(),
            tools_used: tools_used.to_vec(),
            result: "step finished".into(),
            intervention: None,
            steering_note,
            audit: None,
            drift: drift_str,
            next: "continue".into(),
        };

        self.write_checkpoint(&checkpoint).await;
        let _ = self.settings.save(&self.settings_path).await;
        checkpoint
    }

    pub async fn ensure_scaffold(&self) {
        let _ = fs::create_dir_all(&self.project_root).await;
        if !self.plan_path.exists() {
            let _ = fs::write(&self.plan_path, "# Plan\n## Goal\n\n## Steps\n").await;
        }
        if !self.instructions_path.exists() {
            let _ = fs::write(&self.instructions_path, "Follow plan.md\n").await;
        }
    }

    async fn write_checkpoint(&self, cp: &Checkpoint) {
        let dir = self.project_root.join("checkpoints");
        let _ = fs::create_dir_all(&dir).await;
        let path = dir.join(format!("{}.json", cp.timestamp));
        if let Ok(json) = serde_json::to_string_pretty(cp) {
            let _ = fs::write(path, json).await;
        }
    }

    pub fn slash_command(&mut self, cmd: &str) -> String {
        match cmd {
            "/status" => format!("theme={} voice={}", self.settings.theme, self.settings.voice_mode),
            "/plan" => "plan.md".into(),
            "/tools" => format!("{} tools", self.registry.tools.len()),
            "/skills" => format!("{} skills", self.registry.skills.len()),
            _ => format!("unknown: {}", cmd),
        }
    }
}

fn chrono_lite() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
}
