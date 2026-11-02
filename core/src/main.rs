mod drift;
mod harness;
mod registry;

use harness::Harness;
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    println!("OMNI-CODE core — harness online");

    let root = PathBuf::from(r"C:\Users\ThePa\.omni-neural-ide");
    let harness = Harness::new(root);

    harness.ensure_scaffold().await;

    let scope = drift::StepScope {
        expected_files: Default::default(),
        allowed_globs: vec!["src/**".into()],
        allowed_tools: ["write_file".into(), "read_file".into()]
            .into_iter()
            .collect(),
    };

    let cp = harness
        .execute_step("1. Initial scaffold", &scope, &["write_file".into()], None)
        .await;

    println!("Checkpoint written: {:?}", cp.step);
    println!("Drift: {}", cp.drift);
}
