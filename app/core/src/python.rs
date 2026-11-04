//! Local Python runtime: Windows embeddable CPython 3.12 installed on first use
//! into <install>/tools/python, pip via get-pip, per-workspace venv, and
//! python_run / pip_install / python_test with timeouts, output caps and Stop.
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;

pub const PY_VERSION: &str = "3.12.10";
const OUT_CAP: usize = 64 * 1024;
type R = Result<Json<serde_json::Value>, (StatusCode, String)>;

fn tools_dir(st: &AppState) -> PathBuf { st.data_dir.join("tools").join("python") }

fn base_python(st: &AppState) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("OMNI_PYTHON") { if !p.is_empty() { return Some(PathBuf::from(p)); } }
    let embedded = tools_dir(st).join(if cfg!(windows) { "python.exe" } else { "bin/python3" });
    if embedded.exists() { return Some(embedded); }
    if !cfg!(windows) {
        for c in ["/usr/bin/python3", "/usr/local/bin/python3"] { if Path::new(c).exists() { return Some(c.into()); } }
    }
    None
}

fn workspace(st: &AppState) -> PathBuf {
    st.project_root.read().clone().unwrap_or_else(|| st.data_dir.join("sandbox"))
}

fn venv_python(ws: &Path) -> PathBuf {
    if cfg!(windows) { ws.join(".venv").join("Scripts").join("python.exe") } else { ws.join(".venv").join("bin").join("python") }
}

fn interpreter(st: &AppState) -> Option<PathBuf> {
    let v = venv_python(&workspace(st));
    if v.exists() { Some(v) } else { base_python(st) }
}

pub async fn status(State(st): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let ws = workspace(&st);
    Json(serde_json::json!({
        "installed": base_python(&st).is_some(),
        "base": base_python(&st),
        "venv": venv_python(&ws).exists().then(|| venv_python(&ws)),
        "tools_dir": tools_dir(&st),
        "version_target": PY_VERSION,
        "run_code": st.store.get_setting("run_code").unwrap_or(serde_json::json!("local")),
    }))
}

/// Install embeddable Python + pip (Windows). On Linux/macOS dev uses system python3.
pub async fn setup(State(st): State<Arc<AppState>>) -> R {
    if base_python(&st).is_some() {
        return Ok(Json(serde_json::json!({"ok": true, "detail": "already installed", "base": base_python(&st)})));
    }
    if !cfg!(windows) {
        return Err((StatusCode::NOT_IMPLEMENTED, "Non-Windows: install python3 or set OMNI_PYTHON".into()));
    }
    let dir = tools_dir(&st);
    std::fs::create_dir_all(&dir).map_err(ie)?;
    let zip = dir.join(format!("python-{PY_VERSION}-embed-amd64.zip"));
    let url = std::env::var("OMNI_PY_EMBED_URL").unwrap_or_else(|_| format!("https://www.python.org/ftp/python/{PY_VERSION}/python-{PY_VERSION}-embed-amd64.zip"));
    crate::update::download_file(&url, &zip).await?;
    extract_zip(&zip, &dir).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    if !dir.join(if cfg!(windows) { "python.exe" } else { "python" }).exists() && cfg!(windows) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "python.exe missing after extraction".into()));
    }
    let _ = std::fs::remove_file(&zip);
    // enable site-packages so pip works
    for e in std::fs::read_dir(&dir).map_err(ie)?.flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        if n.ends_with("._pth") {
            let t = std::fs::read_to_string(e.path()).unwrap_or_default().replace("#import site", "import site");
            let t = if t.contains("Lib\\site-packages") { t } else { format!("{t}\nLib\\site-packages\n") };
            std::fs::write(e.path(), t).map_err(ie)?;
        }
    }
    let getpip = dir.join("get-pip.py");
    crate::update::download_file("https://bootstrap.pypa.io/get-pip.py", &getpip).await?;
    let py = dir.join("python.exe");
    let out = exec(&st, &py, &[getpip.to_string_lossy().to_string(), "--no-warn-script-location".into()], &dir, 300_000, "python-setup").await?;
    let _ = exec(&st, &py, &["-m".into(), "pip".into(), "install".into(), "-q".into(), "virtualenv".into()], &dir, 300_000, "python-setup").await;
    Ok(Json(serde_json::json!({"ok": out["code"] == 0, "base": py, "pip": out})))
}

async fn ensure_venv(st: &Arc<AppState>) -> Result<PathBuf, (StatusCode, String)> {
    let ws = workspace(st);
    let vp = venv_python(&ws);
    if vp.exists() { return Ok(vp); }
    let base = base_python(st).ok_or((StatusCode::PRECONDITION_REQUIRED, "Python not installed — Settings → Run code → Install Python".into()))?;
    let target = ws.join(".venv").to_string_lossy().to_string();
    let args: Vec<String> = if cfg!(windows) { vec!["-m".into(), "virtualenv".into(), target] } else { vec!["-m".into(), "venv".into(), target] };
    let r = exec(st, &base, &args, &ws, 180_000, "venv").await?;
    if !vp.exists() { return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("venv failed: {}", r["stderr"]))); }
    Ok(vp)
}

#[derive(Deserialize)]
pub struct RunIn { pub code: Option<String>, pub script: Option<String>, #[serde(default)] pub args: Vec<String>, pub timeout_ms: Option<u64> }

pub async fn run(State(st): State<Arc<AppState>>, Json(b): Json<RunIn>) -> R {
    Ok(Json(run_inner(&st, b).await?))
}

pub async fn run_inner(st: &Arc<AppState>, b: RunIn) -> Result<serde_json::Value, (StatusCode, String)> {
    let py = interpreter(st).ok_or((StatusCode::PRECONDITION_REQUIRED, "Python not installed — Settings → Run code → Install Python".into()))?;
    let ws = workspace(st);
    let mut args = vec!["-u".to_string()];
    if let Some(code) = b.code.filter(|c| !c.trim().is_empty()) {
        let dir = st.data_dir.join("sandbox").join("py");
        std::fs::create_dir_all(&dir).map_err(ie)?;
        let f = dir.join(format!("snippet-{}.py", uuid::Uuid::new_v4()));
        std::fs::write(&f, code).map_err(ie)?;
        args.push(f.to_string_lossy().to_string());
    } else if let Some(s) = b.script {
        let p = if Path::new(&s).is_absolute() { PathBuf::from(&s) } else { ws.join(&s) };
        args.push(p.to_string_lossy().to_string());
    } else {
        return Err((StatusCode::BAD_REQUEST, "code or script required".into()));
    }
    args.extend(b.args);
    exec(st, &py, &args, &ws, b.timeout_ms.unwrap_or(60_000).clamp(1_000, 600_000), "python").await
}

#[derive(Deserialize)]
pub struct PipIn { pub packages: Vec<String>, #[serde(default)] pub confirm: bool }

pub async fn pip_install(State(st): State<Arc<AppState>>, Json(b): Json<PipIn>) -> R {
    if !b.confirm {
        return Err((StatusCode::PRECONDITION_REQUIRED, format!("pip install {} needs confirmation", b.packages.join(" "))));
    }
    let re = regex::Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._\-\[\],<>=!~]*$").unwrap();
    if b.packages.is_empty() || b.packages.iter().any(|p| !re.is_match(p)) {
        return Err((StatusCode::BAD_REQUEST, "invalid package spec".into()));
    }
    let vp = ensure_venv(&st).await?;
    let mut args = vec!["-m".into(), "pip".into(), "install".into(), "--disable-pip-version-check".into()];
    args.extend(b.packages);
    Ok(Json(exec(&st, &vp, &args, &workspace(&st), 600_000, "pip").await?))
}

#[derive(Deserialize, Default)]
pub struct TestIn { pub path: Option<String>, pub timeout_ms: Option<u64> }

pub async fn test(State(st): State<Arc<AppState>>, Json(b): Json<TestIn>) -> R {
    Ok(Json(test_inner(&st, b).await?))
}

pub async fn test_inner(st: &Arc<AppState>, b: TestIn) -> Result<serde_json::Value, (StatusCode, String)> {
    let py = interpreter(st).ok_or((StatusCode::PRECONDITION_REQUIRED, "Python not installed".into()))?;
    let mut args = vec!["-m".to_string(), "pytest".into(), "-q".into()];
    if let Some(p) = b.path { args.push(p); }
    let v = exec(st, &py, &args, &workspace(st), b.timeout_ms.unwrap_or(120_000), "pytest").await?;
    if v["stderr"].as_str().unwrap_or("").contains("No module named pytest") {
        return Ok(serde_json::json!({"ok": false, "needs": "pip_install pytest (confirm)", "result": v}));
    }
    Ok(v)
}

/// Spawn with cwd, cancel via RunRegistry (Stop/Esc), wall timeout, output caps.
async fn exec(st: &AppState, prog: &Path, args: &[String], cwd: &Path, timeout_ms: u64, label: &str) -> Result<serde_json::Value, (StatusCode, String)> {
    let run = st.runs.start(label);
    let started = Instant::now();
    let mut cmd = tokio::process::Command::new(prog);
    cmd.args(args).current_dir(cwd).stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8").env("PYTHONUNBUFFERED", "1").kill_on_drop(true);
    #[cfg(windows)]
    { cmd.creation_flags(0x08000000); } // CREATE_NO_WINDOW
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => { st.runs.finish(&run.id); return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("spawn {}: {e}", prog.display()))); }
    };
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let r1 = run.clone();
    let out_t = tokio::spawn(async move { read_capped(&mut so, &r1).await });
    let r2 = run.clone();
    let err_t = tokio::spawn(async move { read_capped(&mut se, &r2).await });
    let deadline = Duration::from_millis(timeout_ms);
    let (mut stopped, mut timed_out) = (false, false);
    let code = loop {
        tokio::select! {
            s = child.wait() => break s.ok().and_then(|s| s.code()).unwrap_or(-1),
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if run.is_cancelled() { stopped = true; }
                else if started.elapsed() > deadline { timed_out = true; }
                if stopped || timed_out { let _ = child.kill().await; break -1; }
            }
        }
    };
    let (stdout, t1) = out_t.await.unwrap_or_default();
    let (stderr, t2) = err_t.await.unwrap_or_default();
    st.runs.finish(&run.id);
    if stopped { crate::agent_run::log_event(&st.data_dir, &format!("{label} run {} stopped by user", run.id)); }
    if timed_out { crate::agent_run::log_event(&st.data_dir, &format!("{label} run {} timeout {timeout_ms}ms", run.id)); }
    Ok(serde_json::json!({
        "ok": code == 0 && !stopped && !timed_out, "code": code, "stdout": stdout, "stderr": stderr,
        "truncated": t1 || t2, "stopped": stopped, "timed_out": timed_out,
        "elapsed_ms": started.elapsed().as_millis() as u64, "run_id": run.id, "interpreter": prog,
    }))
}

async fn read_capped<Rd: tokio::io::AsyncRead + Unpin>(r: &mut Rd, run: &crate::agent_run::RunHandle) -> (String, bool) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut trunc = false;
    loop {
        match r.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                run.bump_tokens(0);
                if buf.len() < OUT_CAP { buf.extend_from_slice(&chunk[..n.min(OUT_CAP - buf.len())]); }
                if buf.len() >= OUT_CAP { trunc = true; }
            }
        }
    }
    let mut s = String::from_utf8_lossy(&buf).to_string();
    if trunc { s.push_str("\n…[output truncated at 64 KB]"); }
    (s, trunc)
}

fn ie<E: ToString>(e: E) -> (StatusCode, String) { (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()) }

/// In-process unzip (no PowerShell/tar dependency; works under Wine too).
fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut a = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..a.len() {
        let mut e = a.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = e.enclosed_name() else { continue };
        let out = dest.join(rel);
        if e.is_dir() { std::fs::create_dir_all(&out).map_err(|e| e.to_string())?; continue; }
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut e, &mut w).map_err(|e| e.to_string())?;
    }
    Ok(())
}
