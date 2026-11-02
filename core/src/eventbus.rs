//! Graph events the neural view listens to.

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const GRAPH_BUFFER: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GraphEvent {
    ToolCalled { tool: String, project: String },
    FileTouched { path: String, project: String },
    DriftFlagged { path: String },
    Intervention { source: String },
    StepStarted { step: String },
    StepFinished { step: String },
}

#[derive(Clone, Debug)]
pub struct EventBus {
    tx: broadcast::Sender<GraphEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(GRAPH_BUFFER);
        Self { tx }
    }

    pub fn emit(&self, event: GraphEvent) {
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GraphEvent> {
        self.tx.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
