//! Encrypted key store: embedded SQLite (data/omni.db) + DPAPI (Windows) or
//! AES-256-GCM with a local key file (non-Windows dev fallback).
use crate::state::ProviderKeys;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

pub const ENTROPY: &[u8] = b"OMNI-CODE/secrets/v1";

pub struct Store {
    conn: Mutex<Connection>,
    pub db_path: PathBuf,
    pub scheme: &'static str,
    dev_key: Option<[u8; 32]>,
}

pub const SECRET_FIELDS: &[&str] = &["minimax", "nvidia", "mcp_search_key", "mcp_computer_secret"];

impl Store {
    pub fn open(data_root: &Path) -> anyhow::Result<Self> {
        let dir = data_root.join("data");
        std::fs::create_dir_all(&dir)?;
        let db_path = dir.join("omni.db");
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY, blob BLOB NOT NULL, scheme TEXT NOT NULL, updated TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        #[cfg(windows)]
        let (scheme, dev_key) = ("dpapi-user", None);
        #[cfg(not(windows))]
        let (scheme, dev_key) = {
            let kf = dir.join(".dev-aesgcm.key");
            let key = if let Ok(b) = std::fs::read(&kf) {
                let mut k = [0u8; 32];
                if b.len() == 32 { k.copy_from_slice(&b); }
                k
            } else {
                use rand::RngCore;
                let mut k = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut k);
                std::fs::write(&kf, k)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&kf, std::fs::Permissions::from_mode(0o600));
                }
                k
            };
            tracing::warn!("secrets: non-Windows dev fallback (AES-GCM key file {}) — not DPAPI", kf.display());
            ("aesgcm-devkey", Some(key))
        };
        Ok(Self { conn: Mutex::new(conn), db_path, scheme, dev_key })
    }

    fn protect(&self, plain: &[u8]) -> anyhow::Result<Vec<u8>> {
        #[cfg(windows)]
        { return dpapi::protect(plain, ENTROPY); }
        #[cfg(not(windows))]
        {
            use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
            use rand::RngCore;
            let cipher = Aes256Gcm::new_from_slice(self.dev_key.as_ref().unwrap())?;
            let mut nonce = [0u8; 12];
            rand::thread_rng().fill_bytes(&mut nonce);
            let mut aad_plain = Vec::from(plain);
            let ct = cipher.encrypt(Nonce::from_slice(&nonce), aes_gcm::aead::Payload { msg: &aad_plain, aad: ENTROPY })
                .map_err(|_| anyhow::anyhow!("encrypt failed"))?;
            aad_plain.iter_mut().for_each(|b| *b = 0);
            let mut out = nonce.to_vec();
            out.extend(ct);
            Ok(out)
        }
    }

    fn unprotect(&self, blob: &[u8]) -> anyhow::Result<Vec<u8>> {
        #[cfg(windows)]
        { return dpapi::unprotect(blob, ENTROPY); }
        #[cfg(not(windows))]
        {
            use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
            if blob.len() < 13 { anyhow::bail!("blob too short"); }
            let cipher = Aes256Gcm::new_from_slice(self.dev_key.as_ref().unwrap())?;
            cipher.decrypt(Nonce::from_slice(&blob[..12]), aes_gcm::aead::Payload { msg: &blob[12..], aad: ENTROPY })
                .map_err(|_| anyhow::anyhow!("decrypt failed"))
        }
    }

    pub fn set_secret(&self, name: &str, value: &str) -> anyhow::Result<()> {
        let blob = self.protect(value.as_bytes())?;
        self.conn.lock().execute(
            "INSERT INTO secrets(name,blob,scheme,updated) VALUES(?1,?2,?3,datetime('now'))
             ON CONFLICT(name) DO UPDATE SET blob=excluded.blob, scheme=excluded.scheme, updated=excluded.updated",
            params![name, blob, self.scheme],
        )?;
        Ok(())
    }

    pub fn get_secret(&self, name: &str) -> Option<String> {
        let blob: Vec<u8> = self.conn.lock()
            .query_row("SELECT blob FROM secrets WHERE name=?1", params![name], |r| r.get(0)).ok()?;
        self.unprotect(&blob).ok().and_then(|b| String::from_utf8(b).ok())
    }

    pub fn raw_blobs(&self) -> Vec<(String, Vec<u8>, String)> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT name, blob, scheme FROM secrets ORDER BY name").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().filter_map(|x| x.ok()).collect()
    }

    pub fn put_raw_blob(&self, name: &str, blob: &[u8], scheme: &str) -> anyhow::Result<()> {
        // verify decryptable before accepting
        self.unprotect(blob)?;
        self.conn.lock().execute(
            "INSERT INTO secrets(name,blob,scheme,updated) VALUES(?1,?2,?3,datetime('now'))
             ON CONFLICT(name) DO UPDATE SET blob=excluded.blob, scheme=excluded.scheme, updated=excluded.updated",
            params![name, blob, scheme],
        )?;
        Ok(())
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.conn.lock().execute(
            "INSERT INTO settings(key,value,updated) VALUES(?1,?2,datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
            params![key, value.to_string()],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Option<serde_json::Value> {
        let s: String = self.conn.lock()
            .query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0)).ok()?;
        serde_json::from_str(&s).ok()
    }

    pub fn meta(&self, key: &str) -> Option<String> {
        self.conn.lock().query_row("SELECT value FROM meta WHERE key=?1", params![key], |r| r.get(0)).ok()
    }
    pub fn set_meta(&self, key: &str, v: &str) {
        let _ = self.conn.lock().execute(
            "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, v],
        );
    }

    /// Load ProviderKeys: secrets decrypted, non-secret config from settings.
    pub fn load_keys(&self) -> ProviderKeys {
        let mut k: ProviderKeys = self
            .get_setting("provider_config")
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        if k.max_agents == 0 { k.max_agents = 3; }
        k.minimax = self.get_secret("minimax");
        k.nvidia = self.get_secret("nvidia");
        k.mcp_search_key = self.get_secret("mcp_search_key");
        k.mcp_computer_secret = self.get_secret("mcp_computer_secret");
        k
    }

    pub fn save_keys(&self, k: &ProviderKeys) -> anyhow::Result<()> {
        for (name, v) in [
            ("minimax", &k.minimax),
            ("nvidia", &k.nvidia),
            ("mcp_search_key", &k.mcp_search_key),
            ("mcp_computer_secret", &k.mcp_computer_secret),
        ] {
            if let Some(v) = v.as_ref().filter(|s| !s.is_empty()) {
                self.set_secret(name, v)?;
            }
        }
        let mut cfg = k.clone();
        cfg.minimax = None;
        cfg.nvidia = None;
        cfg.mcp_search_key = None;
        cfg.mcp_computer_secret = None;
        self.set_setting("provider_config", &serde_json::to_value(cfg)?)?;
        Ok(())
    }
}

pub fn mask(v: &Option<String>) -> String {
    match v.as_deref() {
        Some(s) if !s.is_empty() => {
            let tail: String = s.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            format!("••••{tail}")
        }
        _ => String::new(),
    }
}

pub fn is_masked(v: &str) -> bool { v.starts_with("••••") }

/// One-time migration of plaintext keys/providers.json (and legacy locations).
/// Returns path of the renamed original, if any.
pub fn migrate_plaintext(store: &Store, data_root: &Path) -> Option<PathBuf> {
    let mut candidates = vec![data_root.join("keys").join("providers.json")];
    if let Some(local) = dirs::data_local_dir() {
        candidates.push(local.join("Programs").join("OMNI-CODE").join("keys").join("providers.json"));
    }
    for src in candidates {
        if !src.exists() { continue; }
        let Ok(text) = std::fs::read_to_string(&src) else { continue };
        let Ok(old) = serde_json::from_str::<ProviderKeys>(&text) else {
            tracing::warn!("migrate: {} unreadable, left in place", src.display());
            continue;
        };
        // Merge: DB values win only if old one is empty (never clobber newer DB data)
        let mut cur = store.load_keys();
        macro_rules! fill { ($f:ident) => { if cur.$f.as_deref().unwrap_or("").is_empty() { cur.$f = old.$f.clone(); } } }
        fill!(minimax); fill!(nvidia); fill!(mcp_search_key); fill!(mcp_computer_secret);
        fill!(mcp_search_url); fill!(mcp_computer_bot); fill!(mcp_computer_url);
        if cur.max_agents == 0 { cur.max_agents = old.max_agents; }
        if cur.nvidia_embed_model.is_empty() { cur.nvidia_embed_model = old.nvidia_embed_model.clone(); }
        if cur.nvidia_side_model.is_empty() { cur.nvidia_side_model = old.nvidia_side_model.clone(); }
        if store.save_keys(&cur).is_err() { continue; }
        // verify every secret round-trips
        let back = store.load_keys();
        let ok = [ (&old.minimax,&back.minimax), (&old.nvidia,&back.nvidia), (&old.mcp_search_key,&back.mcp_search_key), (&old.mcp_computer_secret,&back.mcp_computer_secret) ]
            .iter().all(|(a,b)| a.as_deref().unwrap_or("").is_empty() || b.is_some());
        if !ok {
            tracing::error!("migrate: verification failed; {} kept as-is", src.display());
            continue;
        }
        let dest = src.with_file_name(format!("providers.json.migrated-{}", chrono::Local::now().format("%Y%m%d-%H%M%S")));
        if std::fs::rename(&src, &dest).is_ok() {
            store.set_meta("migrated_from", &dest.to_string_lossy());
            tracing::info!("migrate: imported {} → omni.db; original renamed {}", src.display(), dest.display());
            return Some(dest);
        }
    }
    None
}

/// Overwrite with zeros/random then delete.
pub fn secure_wipe(path: &Path) -> std::io::Result<()> {
    use std::io::{Seek, SeekFrom, Write};
    let len = std::fs::metadata(path)?.len() as usize;
    let mut f = std::fs::OpenOptions::new().write(true).open(path)?;
    for pass in 0..3u8 {
        f.seek(SeekFrom::Start(0))?;
        let buf: Vec<u8> = if pass == 1 { (0..len).map(|_| rand::random()).collect() } else { vec![0u8; len] };
        f.write_all(&buf)?;
        f.sync_all()?;
    }
    drop(f);
    std::fs::remove_file(path)
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};

    fn blob(b: &[u8]) -> CRYPT_INTEGER_BLOB { CRYPT_INTEGER_BLOB { cbData: b.len() as u32, pbData: b.as_ptr() as *mut u8 } }

    pub fn protect(plain: &[u8], entropy: &[u8]) -> anyhow::Result<Vec<u8>> {
        let inb = blob(plain);
        let ent = blob(entropy);
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptProtectData(&inb, std::ptr::null(), &ent, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        if ok == 0 { anyhow::bail!("CryptProtectData failed"); }
        let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as _) };
        Ok(v)
    }
    pub fn unprotect(enc: &[u8], entropy: &[u8]) -> anyhow::Result<Vec<u8>> {
        let inb = blob(enc);
        let ent = blob(entropy);
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptUnprotectData(&inb, std::ptr::null_mut(), &ent, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        if ok == 0 { anyhow::bail!("CryptUnprotectData failed"); }
        let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as _) };
        Ok(v)
    }
}
