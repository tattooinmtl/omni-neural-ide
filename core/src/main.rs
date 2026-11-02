mod drift;
mod harness;
mod registry;
mod settings;

use harness::Harness;
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    println!("OMNI-CODE core — full harness");

    let root = PathBuf::from(r"C:\Users\ThePa\.omni-neural-ide");
    let mut harness = Harness::new(root).await;

    harness.ensure_scaffold().await;
    println!("Settings: theme={}", harness.settings.theme);

    let scope = drift::StepScope {
        expected_files: Default::default(),
        allowed_globs: vec!["**".into()],
        allowed_tools: ["write_file".into(), "read_file".into()].into_iter().collect(),
    };

    let cp = harness.execute_step("scaffold", &scope, &["write_file".into()], None).await;
    println!("Drift: {}", cp.drift);
    println!("{}", harness.slash_command("/status"));
}
