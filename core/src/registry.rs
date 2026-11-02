//! Tool, skill, MCP, and hook registry.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub description: String,
    pub permission_tier: String,
    pub enabled: bool,
    pub kind: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Registry {
    pub tools: BTreeMap<String, Entry>,
    pub skills: BTreeMap<String, Entry>,
    pub mcps: BTreeMap<String, Entry>,
    pub hooks: BTreeMap<String, Entry>,
}

impl Registry {
    pub fn load(install_root: &Path) -> Self {
        let mut registry = Self::default();
        registry.scan_skills(&install_root.join("skills"));
        registry.scan_tools(&install_root.join("tools"));
        registry
    }

    pub fn apply_disabled(&mut self, disabled: &std::collections::BTreeSet<String>) {
        for map in [&mut self.tools, &mut self.skills, &mut self.mcps, &mut self.hooks] {
            for entry in map.values_mut() {
                entry.enabled = !disabled.contains(&format!("{}:{}", entry.kind, entry.name));
            }
        }
    }

    pub fn register(&mut self, entry: Entry) {
        let kind = entry.kind.clone();
        let name = entry.name.clone();
        match kind.as_str() {
            "skill" => { self.skills.insert(name, entry); }
            "mcp" => { self.mcps.insert(name, entry); }
            "hook" => { self.hooks.insert(name, entry); }
            _ => { self.tools.insert(name, entry); }
        }
    }

    pub fn create_skill(&mut self, install_root: &Path, name: &str, description: &str) -> Result<Entry, String> {
        let name = sanitize_name(name)?;
        let dir = install_root.join("skills").join(&name);
        fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        fs::write(dir.join("SKILL.md"), format!("# {name}\n\n{description}\n")).map_err(|err| err.to_string())?;
        let entry = Entry { name, description: description.into(), permission_tier: "project".into(), enabled: true, kind: "skill".into() };
        self.register(entry.clone());
        Ok(entry)
    }

    pub fn create_tool(&mut self, install_root: &Path, name: &str, description: &str) -> Result<Entry, String> {
        let name = sanitize_name(name)?;
        let dir = install_root.join("tools");
        fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        let entry = Entry { name: name.clone(), description: description.into(), permission_tier: "project".into(), enabled: true, kind: "tool".into() };
        let json = serde_json::to_string_pretty(&entry).map_err(|err| err.to_string())?;
        fs::write(dir.join(format!("{name}.json")), json).map_err(|err| err.to_string())?;
        self.register(entry.clone());
        Ok(entry)
    }

    fn scan_skills(&mut self, dir: &Path) {
        let Ok(read) = fs::read_dir(dir) else { return; };
        for entry in read.filter_map(Result::ok) {
            let skill = entry.path().join("SKILL.md");
            if skill.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                self.register(Entry { name: name.clone(), description: name, permission_tier: "project".into(), enabled: true, kind: "skill".into() });
            }
        }
    }

    fn scan_tools(&mut self, dir: &Path) {
        let Ok(read) = fs::read_dir(dir) else { return; };
        for entry in read.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(text) = fs::read_to_string(&path) {
                    if let Ok(parsed) = serde_json::from_str::<Entry>(&text) {
                        self.register(parsed);
                    }
                }
            }
        }
    }
}

fn sanitize_name(name: &str) -> Result<String, String> {
    let clean: String = name.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' { ch } else { '-' }).collect();
    let clean = clean.trim_matches('-').to_string();
    if clean.is_empty() { return Err("name is empty".into()); }
    Ok(clean.to_lowercase())
}
