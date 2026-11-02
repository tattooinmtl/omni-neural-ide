//! Tool, skill, MCP, and hook registry.
//!
//! Creators write a file under `skills/`, `tools/`, or `plugins/` and the
//! entry is registered from that file. Disabled names live in settings.

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
        registry.scan_plugins(&install_root.join("plugins"));
        registry
    }

    pub fn apply_disabled(&mut self, disabled: &std::collections::BTreeSet<String>) {
        for (kind, map) in self.maps_mut() {
            for entry in map.values_mut() {
                entry.enabled = !disabled.contains(&format!("{kind}:{}", entry.name));
            }
        }
    }

    pub fn register(&mut self, entry: Entry) {
        let kind = entry.kind.clone();
        let name = entry.name.clone();
        self.map_mut(&kind).insert(name, entry);
    }

    pub fn create_skill(&mut self, install_root: &Path, name: &str, description: &str) -> Result<Entry, String> {
        let name = sanitize_name(name)?;
        let dir = install_root.join("skills").join(&name);
        fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        let body = format!("# {name}\n\n{description}\n");
        fs::write(dir.join("SKILL.md"), body).map_err(|err| err.to_string())?;
        let entry = Entry {
            name,
            description: description.into(),
            permission_tier: "project".into(),
            enabled: true,
            kind: "skill".into(),
        };
        self.register(entry.clone());
        Ok(entry)
    }

    pub fn create_tool(&mut self, install_root: &Path, name: &str, description: &str) -> Result<Entry, String> {
        let name = sanitize_name(name)?;
        let dir = install_root.join("tools");
        fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        let entry = Entry {
            name: name.clone(),
            description: description.into(),
            permission_tier: "project".into(),
            enabled: true,
            kind: "tool".into(),
        };
        let json = serde_json::to_string_pretty(&entry).map_err(|err| err.to_string())?;
        fs::write(dir.join(format!("{name}.json")), json).map_err(|err| err.to_string())?;
        self.register(entry.clone());
        Ok(entry)
    }

    /// Re-read a creator file the editor just saved.
    pub fn reload_saved(&mut self, install_root: &Path, path: &Path) {
        let Ok(rel) = path.strip_prefix(install_root) else {
            return;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if rel.starts_with("skills/") && rel.ends_with("/SKILL.md") {
            self.scan_skills(&install_root.join("skills"));
        } else if rel.starts_with("tools/") && rel.ends_with(".json") {
            self.scan_tools(&install_root.join("tools"));
        } else if rel.starts_with("plugins/") {
            self.scan_plugins(&install_root.join("plugins"));
        }
    }

    fn scan_skills(&mut self, dir: &Path) {
        let Ok(read) = fs::read_dir(dir) else {
            return;
        };
        for entry in read.filter_map(Result::ok) {
            let skill = entry.path().join("SKILL.md");
            if !skill.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let description = first_paragraph(&skill).unwrap_or_else(|| name.clone());
            self.register(Entry {
                name,
                description,
                permission_tier: "project".into(),
                enabled: true,
                kind: "skill".into(),
            });
        }
    }

    fn scan_tools(&mut self, dir: &Path) {
        let Ok(read) = fs::read_dir(dir) else {
            return;
        };
        for entry in read.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            if let Ok(parsed) = serde_json::from_str::<Entry>(&text) {
                self.register(parsed);
            }
        }
    }

    fn scan_plugins(&mut self, dir: &Path) {
        let Ok(read) = fs::read_dir(dir) else {
            return;
        };
        for entry in read.filter_map(Result::ok) {
            let manifest = entry.path().join("plugin.json");
            if manifest.is_file() {
                if let Ok(text) = fs::read_to_string(&manifest) {
                    if let Ok(mut parsed) = serde_json::from_str::<Entry>(&text) {
                        parsed.kind = "plugin".into();
                        // Plugins sit beside hooks in the registry until a plugin runner exists.
                        self.hooks.insert(format!("plugin:{}", parsed.name), parsed);
                    }
                }
            }
            let hooks = entry.path().join("hooks");
            if hooks.is_dir() {
                if let Ok(files) = fs::read_dir(&hooks) {
                    for hook in files.filter_map(Result::ok) {
                        let name = hook.file_name().to_string_lossy().to_string();
                        self.register(Entry {
                            name,
                            description: hook.path().to_string_lossy().to_string(),
                            permission_tier: "project".into(),
                            enabled: true,
                            kind: "hook".into(),
                        });
                    }
                }
            }
        }
    }

    fn map_mut(&mut self, kind: &str) -> &mut BTreeMap<String, Entry> {
        match kind {
            "skill" => &mut self.skills,
            "mcp" => &mut self.mcps,
            "hook" | "plugin" => &mut self.hooks,
            _ => &mut self.tools,
        }
    }

    fn maps_mut(&mut self) -> [(&str, &mut BTreeMap<String, Entry>); 4] {
        [
            ("tool", &mut self.tools),
            ("skill", &mut self.skills),
            ("mcp", &mut self.mcps),
            ("hook", &mut self.hooks),
        ]
    }
}

pub fn sanitize_name(name: &str) -> Result<String, String> {
    let clean: String = name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' { ch } else { '-' })
        .collect();
    let clean = clean.trim_matches('-').to_string();
    if clean.is_empty() {
        return Err("name is empty".into());
    }
    Ok(clean.to_lowercase())
}

fn first_paragraph(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))?;
    Some(line.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_file_registers_on_create() {
        let root = std::env::temp_dir().join(format!("omni-reg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let mut registry = Registry::default();
        let entry = registry.create_skill(&root, "Mark This", "mark the open line").unwrap();
        assert_eq!(entry.name, "mark-this");
        assert!(root.join("skills/mark-this/SKILL.md").is_file());
        let reloaded = Registry::load(&root);
        assert!(reloaded.skills.contains_key("mark-this"));
        let _ = fs::remove_dir_all(&root);
    }
}
