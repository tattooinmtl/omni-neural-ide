//! Slash commands shared by the palette and the assistant.

use crate::app::Core;
use crate::eventbus::GraphEvent;
use std::fs;

impl Core {
    pub fn slash(&mut self, line: &str) -> String {
        let line = line.trim();
        if line.is_empty() {
            return "type a / command".into();
        }
        let (cmd, rest) = split_cmd(line);
        let message = match cmd {
            "/plan" => self.read_project_file("plan.md").unwrap_or_else(|| "no plan yet".into()),
            "/checkpoint" => self.latest_checkpoint(),
            "/steer" => self.steer(rest),
            "/note" => self.assistant_note(rest).unwrap_or_else(|err| err),
            "/audit" => self.assistant_audit(),
            "/rollback" => self
                .harness
                .rollback(rest == "confirm")
                .unwrap_or_else(|err| err),
            "/eval" => self.eval_text(),
            "/diff" => self.harness.diff_text(),
            "/accept" => self
                .harness
                .accept()
                .map(|()| "accepted".to_string())
                .unwrap_or_else(|err| err),
            "/reject" => self
                .harness
                .reject()
                .map(|()| "rejected".to_string())
                .unwrap_or_else(|err| err),
            "/tools" => names_or_empty("tools", self.registry.tools.keys()),
            "/skills" => names_or_empty("skills", self.registry.skills.keys()),
            "/status" => self.status_line(),
            "/create-skill" => self.create_entry("skill", rest),
            "/create-tool" => self.create_entry("tool", rest),
            other => format!("unknown: {other}"),
        };
        if !matches!(cmd, "/steer" | "/note" | "/audit" | "/create-skill" | "/create-tool") {
            self.desk.say("assistant", &message);
        }
        message
    }

    fn latest_checkpoint(&self) -> String {
        match self.harness.checkpoints.last() {
            Some(checkpoint) => serde_json::to_string_pretty(checkpoint).unwrap_or_else(|err| err.to_string()),
            None => "no checkpoint yet".into(),
        }
    }

    fn eval_text(&self) -> String {
        let drift = if self.harness.drift.is_empty() {
            "none".to_string()
        } else {
            self.harness.drift.len().to_string()
        };
        format!(
            "phase: {}\nresult: {}\ndrift: {drift}",
            self.harness.phase.as_str(),
            if self.harness.result.is_empty() {
                "none"
            } else {
                &self.harness.result
            }
        )
    }

    fn status_line(&self) -> String {
        format!(
            "theme={} style={} voice={} muted={} phase={} drift={}",
            self.settings.theme,
            self.settings.version_style,
            self.settings.voice_mode,
            self.settings.muted,
            self.harness.phase.as_str(),
            self.harness.drift.len()
        )
    }

    fn create_entry(&mut self, kind: &str, rest: &str) -> String {
        if kind == "skill" && !self.settings.skills_enabled {
            return "skills are disabled in settings".into();
        }
        let Some((name, description)) = split_name(rest) else {
            return format!("usage: /create-{kind} <name> <description>");
        };
        let description = description.trim();
        if description.is_empty() {
            return format!("usage: /create-{kind} <name> <description>");
        }
        let created = if kind == "skill" {
            self.registry.create_skill(&self.install_root, name, description)
        } else {
            self.registry.create_tool(&self.install_root, name, description)
        };
        match created {
            Ok(entry) => {
                self.bus.emit(GraphEvent::ToolCalled {
                    tool: format!("create-{}", entry.kind),
                    project: entry.name.clone(),
                });
                format!("registered {} {}", entry.kind, entry.name)
            }
            Err(err) => err,
        }
    }

    fn read_project_file(&self, relative: &str) -> Option<String> {
        fs::read_to_string(self.harness.workspace.join(relative)).ok()
    }
}

fn split_name(rest: &str) -> Option<(&str, &str)> {
    let rest = rest.trim();
    let index = rest.find(|ch: char| ch.is_whitespace() || ch == ':')?;
    let (name, description) = rest.split_at(index);
    let description = description.trim_start_matches([' ', ':']).trim();
    if name.is_empty() || description.is_empty() {
        None
    } else {
        Some((name, description))
    }
}

fn split_cmd(line: &str) -> (&str, &str) {
    line.split_once(char::is_whitespace)
        .map_or((line, ""), |(cmd, rest)| (cmd, rest.trim()))
}

fn names_or_empty<'a>(label: &str, names: impl Iterator<Item = &'a String>) -> String {
    let names: Vec<_> = names.cloned().collect();
    if names.is_empty() {
        format!("no {label} yet")
    } else {
        names.join(", ")
    }
}
