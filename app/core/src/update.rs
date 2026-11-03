use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::io::Read;

const GITHUB_LATEST: &str = "https://api.github.com/repos/tattooinmtl/omni-neural-ide/releases/latest";

#[derive(Serialize)]
pub struct UpdateCheckOut {
    pub current: String,
    pub latest: Option<String>,
    pub available: bool,
    pub asset: Option<String>,
    pub asset_url: Option<String>,
    pub sha256: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateApplyIn {
    pub mode: Option<String>,
    /// When set (tests), use this staged dir instead of downloading.
    pub mock_stage: Option<String>,
}

#[derive(Serialize)]
pub struct UpdateApplyOut {
    pub ok: bool,
    pub message: String,
    pub plan_path: Option<String>,
}

pub async fn check(State(st): State<Arc<AppState>>) -> Result<Json<UpdateCheckOut>, (StatusCode, String)> {
    let current = read_current_version(&st);
    let client = reqwest::Client::new();
    let resp = client
        .get(GITHUB_LATEST)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", format!("OMNI-CODE/{}", current))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if !resp.status().is_success() {
        return Ok(Json(UpdateCheckOut {
            current,
            latest: None,
            available: false,
            asset: None,
            asset_url: None,
            sha256: None,
            notes: Some(format!("GitHub status {}", resp.status())),
        }));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let tag = v["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let notes = v["body"].as_str().map(|s| s.chars().take(400).collect());
    let assets = v["assets"].as_array().cloned().unwrap_or_default();
    let mut asset_name = None;
    let mut asset_url = None;
    let mut sha_url = None;
    for a in &assets {
        let name = a["name"].as_str().unwrap_or("");
        let url = a["browser_download_url"].as_str().unwrap_or("");
        if name.starts_with("omni-update-") && name.ends_with(".zip") {
            asset_name = Some(name.to_string());
            asset_url = Some(url.to_string());
        } else if name == "omni-code-windows-x86_64.zip" && asset_name.is_none() {
            asset_name = Some(name.to_string());
            asset_url = Some(url.to_string());
        } else if name == "SHA256SUMS.txt" || name.starts_with("SHA256SUMS") {
            sha_url = Some(url.to_string());
        }
    }
    let available = !tag.is_empty() && version_less(&current, &tag);
    let sha256 = if let Some(u) = sha_url {
        fetch_sha_for(&client, &u, asset_name.as_deref().unwrap_or("")).await.ok()
    } else {
        None
    };
    Ok(Json(UpdateCheckOut {
        current,
        latest: if tag.is_empty() { None } else { Some(tag) },
        available,
        asset: asset_name,
        asset_url,
        sha256,
        notes,
    }))
}

pub async fn apply(State(st): State<Arc<AppState>>, Json(body): Json<UpdateApplyIn>) -> Result<Json<UpdateApplyOut>, (StatusCode, String)> {
    let install = st.data_dir.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| st.data_dir.clone());
    // Prefer OMNI_HOME / install beside data_dir: data is %USERPROFILE%\.omni-neural-ide\...
    let install = std::env::var("OMNI_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or(install);

    let stage = if let Some(mock) = body.mock_stage {
        std::path::PathBuf::from(mock)
    } else {
        let info = check(State(st.clone())).await?.0;
        if !info.available {
            return Ok(Json(UpdateApplyOut {
                ok: false,
                message: "Already up to date.".into(),
                plan_path: None,
            }));
        }
        let url = info.asset_url.ok_or((StatusCode::BAD_GATEWAY, "no update asset".into()))?;
        let name = info.asset.unwrap_or_else(|| "update.zip".into());
        let updates = install.join("updates");
        std::fs::create_dir_all(&updates).ok();
        let zip_path = updates.join(&name);
        download_file(&url, &zip_path).await?;
        if let Some(want) = info.sha256 {
            let got = sha256_file(&zip_path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            if !got.eq_ignore_ascii_case(&want) {
                return Err((StatusCode::BAD_REQUEST, format!("SHA256 mismatch: got {got} want {want}")));
            }
        }
        let stage = updates.join(format!("stage-{}", info.latest.unwrap_or_else(|| "next".into())));
        let _ = std::fs::remove_dir_all(&stage);
        std::fs::create_dir_all(&stage).ok();
        unzip_portable(&zip_path, &stage).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        stage
    };

    let mode = body.mode.unwrap_or_else(|| st.mode.read().clone());
    let plan_dir = install.join("updates");
    std::fs::create_dir_all(&plan_dir).ok();
    let plan_path = plan_dir.join("pending-plan.json");
    let pids = current_pids();
    let relaunch = install.join("bin").join("launcher.exe");
    let plan = serde_json::json!({
        "install_dir": install,
        "stage_dir": stage,
        "wait_pids": pids,
        "mode": mode,
        "relaunch": relaunch,
        "backup_dir": plan_dir.join(format!("backup-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S"))),
    });
    std::fs::write(&plan_path, serde_json::to_vec_pretty(&plan).unwrap())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Spawn updater helper (Windows) or linux test binary
    let updater = install.join("bin").join(if cfg!(windows) { "omni-updater.exe" } else { "omni-updater" });
    if updater.exists() {
        let mut cmd = std::process::Command::new(&updater);
        cmd.arg("-plan").arg(&plan_path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x00000008); // DETACHED
        }
        let _ = cmd.spawn();
    }

    Ok(Json(UpdateApplyOut {
        ok: true,
        message: "Update staged — restarting.".into(),
        plan_path: Some(plan_path.display().to_string()),
    }))
}

fn read_current_version(st: &AppState) -> String {
    let candidates = [
        st.data_dir.join("version"),
        st.data_dir.parent().unwrap_or(&st.data_dir).join("version"),
    ];
    for c in candidates {
        if let Ok(s) = std::fs::read_to_string(c) {
            let t = s.trim().to_string();
            if !t.is_empty() {
                return t;
            }
        }
    }
    env!("CARGO_PKG_VERSION").to_string()
}

fn version_less(a: &str, b: &str) -> bool {
    let pa = parse_ver(a);
    let pb = parse_ver(b);
    pa < pb
}

fn parse_ver(s: &str) -> (u32, u32, u32) {
    let s = s.trim().trim_start_matches('v');
    let mut parts = s.split('.');
    let a = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let b = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let c = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    (a, b, c)
}

async fn fetch_sha_for(client: &reqwest::Client, url: &str, asset: &str) -> Result<String, String> {
    let text = client.get(url).header("User-Agent", "OMNI-CODE").send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let mut sp = line.split_whitespace();
        let hash = sp.next().unwrap_or("");
        let name = sp.next().unwrap_or("").trim_start_matches('*');
        if name.ends_with(asset) || asset.ends_with(name) {
            return Ok(hash.to_string());
        }
    }
    Err("sha not found".into())
}

async fn download_file(url: &str, dest: &std::path::Path) -> Result<(), (StatusCode, String)> {
    let client = reqwest::Client::new();
    let bytes = client.get(url).header("User-Agent", "OMNI-CODE").send().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?
        .bytes().await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent).ok(); }
    std::fs::write(dest, &bytes).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn unzip_portable(zip_path: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    // Prefer `unzip` / PowerShell; fallback to zip crate if available — use std Command
    #[cfg(windows)]
    {
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &format!(
                "Expand-Archive -Force -Path '{}' -DestinationPath '{}'",
                zip_path.display(), dest.display()
            )])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() { return Err("Expand-Archive failed".into()); }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let status = std::process::Command::new("python3")
            .args(["-c", &format!(
                "import zipfile; zipfile.ZipFile(r'{z}').extractall(r'{d}')",
                z = zip_path.display(), d = dest.display()
            )])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() { return Err("python unzip failed".into()); }
        Ok(())
    }
}

fn current_pids() -> Vec<u32> {
    vec![std::process::id()]
}
