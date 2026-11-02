use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
    pub version_style: String,
    pub voice_mode: bool,
    pub performance_mode: String,
    pub neural_graph: bool,
    pub particles: bool,
    pub animation_enabled: bool,
    pub sound_enabled: bool,
    pub drift_response: String,
    pub step_size: String,
    pub node_toggles: HashMap<String, bool>,
}

impl Default for Settings {
    fn default() -> Self {
        let mut nodes = HashMap::new();
        for t in ["projects", "files", "tools", "skills", "mcps", "hooks", "workers"] {
            nodes.insert(t.to_string(), true);
        }
        Self {
            theme: "dark".into(),
            version_style: "ultra".into(),
            voice_mode: false,
            performance_mode: "balanced".into(),
            neural_graph: true,
            particles: true,
            animation_enabled: true,
            sound_enabled: false,
            drift_response: "warn".into(),
            step_size: "batch".into(),
            node_toggles: nodes,
        }
    }
}

impl Settings {
    pub async fn load(path: &std::path::Path) -> Self {
        match fs::read_to_string(path).await {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub async fn save(&self, path: &std::path::Path) {
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, json).await;
        }
    }
}
