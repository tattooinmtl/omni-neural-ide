//! Graph events the neural view listens to.
//!
//! The harness emits one event per step, file write, tool call, drift flag,
//! and assistant intervention. The HTTP server forwards them as server-sent events.

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// How many events a slow subscriber can miss before the channel drops them.
///
/// 256 covers a burst of step and file events from one run. A smaller buffer
/// drops pulses while the window is hidden.
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
