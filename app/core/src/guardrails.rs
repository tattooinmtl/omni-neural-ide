use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct GuardError(pub String);
impl std::fmt::Display for GuardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for GuardError {}

/// Hard block: OS system directories (except read-only audit elsewhere).
pub fn assert_not_system(path: &Path) -> Result<(), GuardError> {
    let s = normalize(path);
    let blocked = [
        "/windows",
        "/winnt",
        "\\windows\\",
        "c:\\windows",
        "c:/windows",
        "/system32",
        "/sys/",
        "/proc/",
        "/dev/",
        "/boot/",
        "/usr/lib",
        "/library/preferences",
        "\\program files\\",
        "c:\\program files",
    ];
    let lower = s.to_lowercase();
    for b in blocked {
        if lower.contains(b) {
            return Err(GuardError(format!(
                "refusing system path access: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

pub fn assert_can_write(path: &Path, project_root: Option<&Path>, data_dir: &Path) -> Result<(), GuardError> {
    assert_not_system(path)?;
    let s = normalize(path);
    // Sandbox tester writes only under data_dir/sandbox
    if s.contains("sandbox") {
        let sandbox = normalize(&data_dir.join("sandbox"));
        if !s.starts_with(&sandbox) {
            return Err(GuardError("sandbox writes must stay under .omni-neural-ide/sandbox".into()));
        }
        return Ok(());
    }
    if let Some(root) = project_root {
        let root_n = normalize(root);
        if !s.starts_with(&root_n) && !s.starts_with(&normalize(data_dir)) {
            return Err(GuardError(format!(
                "write outside project/data dir blocked: {}",
                path.display()
            )));
        }
    }
    // No hex/binary editing by extension
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let e = ext.to_lowercase();
        if matches!(e.as_str(), "exe" | "dll" | "so" | "bin" | "o" | "obj" | "wasm" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "pdf" | "zip" | "7z" | "rar") {
            return Err(GuardError(format!("refusing binary/hex edit: .{e}")));
        }
    }
    Ok(())
}

pub fn assert_can_delete(path: &Path, confirm: bool) -> Result<(), GuardError> {
    assert_not_system(path)?;
    if !confirm {
        return Err(GuardError(
            "delete requires explicit confirm=true (guardrail)".into(),
        ));
    }
    Ok(())
}

fn normalize(path: &Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/").to_lowercase();
    // collapse
    let mut out = PathBuf::new();
    for c in Path::new(&p).components() {
        use std::path::Component::*;
        match c {
            RootDir => out.push("/"),
            Normal(s) => out.push(s),
            ParentDir => { out.pop(); }
            CurDir => {}
            Prefix(pre) => out.push(pre.as_os_str()),
        }
    }
    out.to_string_lossy().to_string()
}
