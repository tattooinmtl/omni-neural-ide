use crate::drift::{Drift, DriftDetector, StepScope};
use crate::registry::Registry;
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

#[derive(Debug)]
pub struct Harness {
    pub registry: Registry,
    pub project_root: PathBuf,
    pub plan_path: PathBuf,
    pub instructions_path: PathBuf,
}

impl Harness {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            registry: Registry::default(),
            project_root: project_root.clone(),
            plan_path: project_root.join("plan.md"),
            instructions_path: project_root.join("instructions.txt"),
        }
    }

    pub async fn execute_step(
        &self,
        step_name: &str,
        scope: &StepScope,
        tools_used: &[String],
        steering_note: Option<String>,
    ) -> Checkpoint {
        println!("Executing step: {}", step_name);

        let drifts = DriftDetector::from_workdir(&self.project_root, scope, tools_used);
        let drift_str = if drifts.iter().any(|d| !matches!(d, Drift::None)) {
            format!("flagged: {:?}", drifts)
        } else {
            "none".to_string()
        };

        let checkpoint = Checkpoint {
            timestamp: chrono_lite(),
            step: step_name.to_string(),
            status: "completed".to_string(),
            files_touched: scope
                .expected_files
                .iter()
                .map(|p| p.display().to_string())
                .collect(),
            tools_used: tools_used.to_vec(),
            result: "step finished (skeleton)".to_string(),
            intervention: None,
            steering_note,
            audit: None,
            drift: drift_str,
            next: "next step".to_string(),
        };

        self.write_checkpoint(&checkpoint).await;
        checkpoint
    }

    async fn write_checkpoint(&self, cp: &Checkpoint) {
        let dir = self.project_root.join("checkpoints");
        let _ = fs::create_dir_all(&dir).await;
        let path = dir.join(format!("{}.json", cp.timestamp.replace(':', "-")));
        if let Ok(json) = serde_json::to_string_pretty(cp) {
            let _ = fs::write(path, json).await;
        }
    }

    pub async fn ensure_scaffold(&self) {
        let _ = fs::create_dir_all(&self.project_root).await;
        if !self.plan_path.exists() {
            let _ = fs::write(&self.plan_path, "# Plan\n## Goal\n\n## Steps\n").await;
        }
        if !self.instructions_path.exists() {
            let _ = fs::write(&self.instructions_path, "Harness instructions\n").await;
        }
    }
}

fn chrono_lite() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", d.as_secs())
}
