use serde::{Serialize, Deserialize};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GraphEvent {
    ToolCalled { tool: String, project: String },
    FileTouched { path: String, project: String },
    DriftFlagged { path: String },
    Intervention { source: String },
    StepStarted { step: String },
    StepFinished { step: String },
}

pub struct EventBus {
    tx: broadcast::Sender<GraphEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
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
    fn default() -> Self { Self::new() }
}
