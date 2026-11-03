use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

/// MiniMax concurrent agent pool (default 3, max 4). Queues when full.
#[derive(Clone)]
pub struct AgentPool {
    inner: Arc<Inner>,
}

struct Inner {
    sem: Mutex<Arc<Semaphore>>,
    max: Mutex<usize>,
}

impl AgentPool {
    pub fn new(max: usize) -> Self {
        let max = max.clamp(1, 4);
        Self {
            inner: Arc::new(Inner {
                sem: Mutex::new(Arc::new(Semaphore::new(max))),
                max: Mutex::new(max),
            }),
        }
    }

    pub async fn set_max(&self, max: usize) {
        let max = max.clamp(1, 4);
        let mut m = self.inner.max.lock().await;
        if *m == max {
            return;
        }
        *m = max;
        *self.inner.sem.lock().await = Arc::new(Semaphore::new(max));
    }

    pub async fn max(&self) -> usize {
        *self.inner.max.lock().await
    }

    /// Acquire a permit (queues until one is free).
    pub async fn acquire(&self) -> tokio::sync::OwnedSemaphorePermit {
        let sem = self.inner.sem.lock().await.clone();
        sem.acquire_owned().await.expect("semaphore closed")
    }
}
