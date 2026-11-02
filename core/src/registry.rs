use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub description: String,
    pub permission_tier: String,
    pub enabled: bool,
    pub kind: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Registry {
    pub tools: HashMap<String, Entry>,
    pub skills: HashMap<String, Entry>,
    pub mcps: HashMap<String, Entry>,
    pub hooks: HashMap<String, Entry>,
}

impl Registry {
    pub fn register(&mut self, entry: Entry) {
        let map = match entry.kind.as_str() {
            "skill" => &mut self.skills,
            "mcp" => &mut self.mcps,
            "hook" => &mut self.hooks,
            _ => &mut self.tools,
        };
        map.insert(entry.name.clone(), entry);
    }

    pub fn create_skill(&mut self, name: &str, description: &str) -> Entry {
        let e = Entry {
            name: name.into(),
            description: description.into(),
            permission_tier: "project".into(),
            enabled: true,
            kind: "skill".into(),
        };
        self.register(e.clone());
        e
    }

    pub fn create_tool(&mut self, name: &str, description: &str) -> Entry {
        let e = Entry {
            name: name.into(),
            description: description.into(),
            permission_tier: "project".into(),
            enabled: true,
            kind: "tool".into(),
        };
        self.register(e.clone());
        e
    }
}
