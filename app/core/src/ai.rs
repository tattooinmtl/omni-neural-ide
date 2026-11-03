use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct ChatIn {
    pub messages: Vec<Msg>,
    pub model: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct ChatOut {
    pub content: String,
    pub model: String,
}

#[derive(Serialize)]
pub struct OmniOut {
    pub content: String,
    pub model: String,
    pub tools_used: Vec<String>,
    pub delegate: Option<crate::delegate::DelegateOut>,
    pub update: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct OmniIn {
    pub message: String,
    pub system: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
pub struct EmbedIn {
    pub texts: Vec<String>,
}

#[derive(Serialize)]
pub struct EmbedOut {
    pub vectors: Vec<Vec<f32>>,
    pub model: String,
    pub skipped: bool,
}

#[derive(Deserialize)]
pub struct SideIn {
    pub task: String,
    pub input: String,
}

/// Coding chat — always MiniMax (main brain) via agent pool.
pub async fn chat(State(st): State<Arc<AppState>>, Json(body): Json<ChatIn>) -> Result<Json<ChatOut>, (StatusCode, String)> {
    let _permit = st.pool.acquire().await;
    bump_minimax_rate(&st)?;
    let keys = st.keys.read().clone();
    let key = keys.minimax.filter(|s| !s.is_empty()).ok_or((
        StatusCode::UNAUTHORIZED,
        "MiniMax API key not set — enter it in Settings → Providers".into(),
    ))?;
    let system = format!(
        "You are OMNI-CODE {}, a coding harness worker. Stay inside the project plan allow-list. Prefer concrete code. Mode: {}. Tools: to search the web reply ONLY with TOOL:web_search:<query>. Never invent search results.",
        if *st.mode.read() == "ultra" { "Ultra" } else { "" },
        st.mode.read()
    );
    let mut content = call_minimax(&key, &system, &body.messages).await?;
    if let Some(q) = content.strip_prefix("TOOL:web_search:") {
        match crate::mcp::run_named_tool(&st, "web_search", q.trim()).await {
            Ok(text) => content = format!("[web_search]\n{text}"),
            Err(e) => content = format!("Search failed: {e}"),
        }
    }
    Ok(Json(ChatOut { content, model: "MiniMax (brain)".into() }))
}

/// Omni the Presence — separate MiniMax session/history, same pool.
pub async fn omni_chat(State(st): State<Arc<AppState>>, Json(body): Json<OmniIn>) -> Result<Json<OmniOut>, (StatusCode, String)> {
    let text = body.message.trim().to_string();
    if text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty message".into()));
    }
    let _permit = st.pool.acquire().await;
    bump_minimax_rate(&st)?;
    let keys = st.keys.read().clone();
    let key = keys.minimax.filter(|s| !s.is_empty()).ok_or((
        StatusCode::UNAUTHORIZED,
        "MiniMax API key not set — enter it in Settings → Providers".into(),
    ))?;
    {
        let mut h = st.omni_history.write();
        h.push(("user".into(), text.clone()));
        if h.len() > 40 {
            let drain = h.len() - 40;
            h.drain(0..drain);
        }
    }
    let history: Vec<Msg> = st.omni_history.read().iter().map(|(r,c)| Msg{role:r.clone(), content:c.clone()}).collect();
    let tool_preamble = "You have tools: delegate_to_coding_agent(task), update_app(), web_search(query), computer_status, computer_screenshot. Never claim you did something unless a tool actually ran. If the user asks you to tell/ask the Coding Agent / coder to do work, reply ONLY with: TOOL:delegate_to_coding_agent:<task text>. If the user asks to update/upgrade/restart the app to a new version, reply ONLY with: TOOL:update_app. To search the web, reply ONLY with: TOOL:web_search:<query>. For a read-only computer check, reply ONLY with: TOOL:computer_status or TOOL:computer_screenshot. Acting computer tools need UI confirmation — never claim you clicked/typed/ran a command. Otherwise chat normally — brief, human, factual. Never invent tool results.";
    let system = body.system.unwrap_or_else(|| "You are Omni the Presence — brief, human, factual. You are NOT the Coding Agent.".into());
    let system = format!("{system}
{tool_preamble}");
    let max_tokens = body.max_tokens.unwrap_or(256);
    let temperature = body.temperature.unwrap_or(0.55);

    // Deterministic intent short-circuit (never hallucinate handoff/update)
    let lower = text.to_lowercase();
    let wants_delegate = ["tell the coding", "tell the coder", "ask the coding", "ask the coder", "delegate", "coding agent", "send to coding", "hand off", "handoff"]
        .iter().any(|k| lower.contains(k))
        && ["make", "build", "create", "write", "implement", "fix", "add", "do"].iter().any(|k| lower.contains(k));
    let wants_search = lower.contains("search the web") || lower.starts_with("search for ") || lower.contains("look up ");
    let wants_update = ["update the app", "upgrade the app", "check for update", "install update", "update omni", "update yourself"]
        .iter().any(|k| lower.contains(k));

    let mut tools_used = Vec::new();
    let mut delegate = None;
    let mut update = None;
    let mut content;

    if wants_search {
        let q = text.trim().to_string();
        match crate::mcp::run_named_tool(&st, "web_search", &q).await {
            Ok(text) => { tools_used.push("web_search".into()); content = text; }
            Err(e) => content = format!("Search failed: {e}"),
        }
    } else if wants_update {
        let r = crate::update::apply(State(st.clone()), Json(crate::update::UpdateApplyIn { mode: None, mock_stage: None })).await;
        match r {
            Ok(j) => {
                tools_used.push("update_app".into());
                update = Some(serde_json::to_value(&j.0).unwrap_or_default());
                content = if j.0.ok {
                    "New version's out — restarting, back in a sec.".to_string()
                } else {
                    j.0.message
                };
            }
            Err((_, e)) => content = format!("Couldn't start the update: {e}"),
        }
    } else if wants_delegate {
        // Extract task: prefer text after "to " / "agent" etc.
        let task = extract_delegate_task(&text);
        let r = crate::delegate::delegate_to_coding_agent(
            State(st.clone()),
            Json(crate::delegate::DelegateIn { task: task.clone(), from: Some("Omni".into()) }),
        ).await;
        match r {
            Ok(j) => {
                tools_used.push("delegate_to_coding_agent".into());
                delegate = Some(j.0.clone());
                content = if j.0.files_written.is_empty() {
                    format!("Sent to the Coding Agent ({}).", j.0.task_id.chars().take(8).collect::<String>())
                } else {
                    format!("Coding Agent finished — it's in {}.", j.0.files_written.join(", "))
                };
            }
            Err((_, e)) => content = format!("Couldn't reach the Coding Agent: {e}"),
        }
    } else {
        content = call_minimax_opts(&key, &system, &history, max_tokens, temperature).await?;
        // Model-emitted tool lines
        if let Some(task) = content.strip_prefix("TOOL:delegate_to_coding_agent:") {
            let task = task.trim().to_string();
            let r = crate::delegate::delegate_to_coding_agent(
                State(st.clone()),
                Json(crate::delegate::DelegateIn { task, from: Some("Omni".into()) }),
            ).await;
            match r {
                Ok(j) => {
                    tools_used.push("delegate_to_coding_agent".into());
                    delegate = Some(j.0.clone());
                    content = if j.0.files_written.is_empty() {
                        format!("Sent to the Coding Agent ({}).", &j.0.task_id[..8.min(j.0.task_id.len())])
                    } else {
                        format!("Coding Agent finished — it's in {}.", j.0.files_written.join(", "))
                    };
                }
                Err((_, e)) => content = format!("Couldn't reach the Coding Agent: {e}"),
            }
        } else if content.trim() == "TOOL:update_app" {
            let r = crate::update::apply(State(st.clone()), Json(crate::update::UpdateApplyIn { mode: None, mock_stage: None })).await;
            match r {
                Ok(j) => {
                    tools_used.push("update_app".into());
                    update = Some(serde_json::to_value(&j.0).unwrap_or_default());
                    content = if j.0.ok { "New version's out — restarting, back in a sec.".into() } else { j.0.message };
                }
                Err((_, e)) => content = format!("Couldn't start the update: {e}"),
            }
        } else if let Some(q) = content.strip_prefix("TOOL:web_search:") {
            match crate::mcp::run_named_tool(&st, "web_search", q.trim()).await {
                Ok(text) => { tools_used.push("web_search".into()); content = text; }
                Err(e) => content = format!("Search failed: {e}"),
            }
        } else if content.trim() == "TOOL:computer_status" {
            match crate::mcp::run_named_tool(&st, "computer_status", "").await {
                Ok(text) => { tools_used.push("computer_status".into()); content = text; }
                Err(e) => content = format!("Computer status failed: {e}"),
            }
        } else if content.trim() == "TOOL:computer_screenshot" {
            match crate::mcp::run_named_tool(&st, "computer_screenshot", "").await {
                Ok(text) => { tools_used.push("computer_screenshot".into()); content = text; }
                Err(e) => content = format!("Screenshot failed: {e}"),
            }
        } else {
            content = claim_guard(&content, &tools_used);
        }
    }

    st.omni_history.write().push(("assistant".into(), content.clone()));
    let _ = tag_mood_best_effort(&st, &content).await;
    Ok(Json(OmniOut { content, model: "Omni the Presence".into(), tools_used, delegate, update }))
}

fn extract_delegate_task(text: &str) -> String {
    let lower = text.to_lowercase();
    for sep in ["to make ", "to build ", "to create ", "to write ", "to implement ", "make ", "build ", "create "] {
        if let Some(i) = lower.find(sep) {
            return text[i + sep.len()..].trim().to_string();
        }
    }
    text.trim().to_string()
}

/// Strip false "I sent/added/done" claims when no tool ran.
fn claim_guard(content: &str, tools: &[String]) -> String {
    if !tools.is_empty() { return content.to_string(); }
    let lower = content.to_lowercase();
    let claim = [
        "i added the task", "i sent it", "i handed it", "i told the coding", "i told the coder",
        "task to the chat", "already sent", "done — sent", "i've added", "i have added",
    ].iter().any(|c| lower.contains(c));
    if claim {
        "I can send that to the Coding Agent — want me to?".to_string()
    } else {
        content.to_string()
    }
}

/// Rate-limited volunteer remark (fail open / empty).
pub async fn omni_volunteer(State(st): State<Arc<AppState>>, Json(body): Json<SideIn>) -> Result<Json<ChatOut>, (StatusCode, String)> {
    let ctx = body.input;
    if ctx.trim().is_empty() {
        return Ok(Json(ChatOut { content: String::new(), model: "omni-volunteer".into() }));
    }
    let _permit = st.pool.acquire().await;
    bump_minimax_rate(&st)?;
    let keys = st.keys.read().clone();
    let Some(key) = keys.minimax.filter(|s| !s.is_empty()) else {
        return Ok(Json(ChatOut { content: String::new(), model: "omni-volunteer".into() }));
    };
    let system = "You are Omni the Presence. Give ONE short optional remark (max 20 words) about the coding context, or reply with exactly NO if nothing useful to say.";
    let msgs = vec![Msg { role: "user".into(), content: ctx }];
    let content = call_minimax(&key, system, &msgs).await.unwrap_or_default();
    let content = if content.trim().eq_ignore_ascii_case("NO") { String::new() } else { content };
    Ok(Json(ChatOut { content, model: "omni-volunteer".into() }))
}

/// NVIDIA embeddings — skipped gracefully if no key.
pub async fn embed(State(st): State<Arc<AppState>>, Json(body): Json<EmbedIn>) -> Result<Json<EmbedOut>, (StatusCode, String)> {
    let keys = st.keys.read().clone();
    let model = if keys.nvidia_embed_model.is_empty() {
        "nvidia/nv-embedqa-e5-v5".into()
    } else {
        keys.nvidia_embed_model.clone()
    };
    let Some(key) = keys.nvidia.filter(|s| !s.is_empty()) else {
        return Ok(Json(EmbedOut { vectors: vec![], model, skipped: true }));
    };
    bump_nvidia_rate(&st)?;
    match call_nvidia_embeddings(&key, &model, &body.texts).await {
        Ok(vectors) => Ok(Json(EmbedOut { vectors, model, skipped: false })),
        Err(e) => {
            tracing::warn!("embed failed: {e}");
            Ok(Json(EmbedOut { vectors: vec![], model, skipped: true }))
        }
    }
}

/// NVIDIA small side task (classify/summarize/mood). Falls back to MiniMax if no NVIDIA key.
pub async fn side_task(State(st): State<Arc<AppState>>, Json(body): Json<SideIn>) -> Result<Json<ChatOut>, (StatusCode, String)> {
    let keys = st.keys.read().clone();
    let system = format!(
        "You are a tiny utility model for OMNI-CODE side tasks ({}). Reply briefly and literally.",
        body.task
    );
    let msgs = vec![Msg { role: "user".into(), content: body.input }];
    if let Some(key) = keys.nvidia.clone().filter(|s| !s.is_empty()) {
        bump_nvidia_rate(&st)?;
        let model = if keys.nvidia_side_model.is_empty() {
            "nvidia/nemotron-mini-4b-instruct".into()
        } else {
            keys.nvidia_side_model.clone()
        };
        match call_openai_compatible(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            &key,
            &model,
            &system,
            &msgs,
        )
        .await
        {
            Ok(content) => return Ok(Json(ChatOut { content, model: format!("NVIDIA side ({model})") })),
            Err(e) => tracing::warn!("nvidia side failed, fallback: {e}"),
        }
    }
    // Fallback MiniMax
    let Some(key) = keys.minimax.filter(|s| !s.is_empty()) else {
        return Err((StatusCode::UNAUTHORIZED, "No provider key for side task".into()));
    };
    let _permit = st.pool.acquire().await;
    bump_minimax_rate(&st)?;
    let content = call_minimax(&key, &system, &msgs).await?;
    Ok(Json(ChatOut { content, model: "MiniMax side-fallback".into() }))
}

async fn tag_mood_best_effort(st: &AppState, text: &str) -> Option<String> {
    let keys = st.keys.read().clone();
    let key = keys.nvidia.filter(|s| !s.is_empty())?;
    let model = if keys.nvidia_side_model.is_empty() {
        "nvidia/nemotron-mini-4b-instruct".into()
    } else {
        keys.nvidia_side_model
    };
    let system = "Classify the speaker mood as one word from: neutral,happy,focused,alert,calm,curious,excited,tired,proud,worried,playful,serious,empathetic,confident,doubtful,inspired,bored,amused,frustrated,patient,eager,reflective,mischievous,supportive,determined,surprised,grateful,nostalgic,vigilant,relaxed,angry,sad,joyful,crying,cold. Reply with only the word.";
    let msgs = vec![Msg { role: "user".into(), content: text.to_string() }];
    call_openai_compatible(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        &key,
        &model,
        system,
        &msgs,
    )
    .await
    .ok()
}

pub fn bump_minimax_rate(st: &AppState) -> Result<(), (StatusCode, String)> {
    let mut rate = st.rate.write();
    let now = Utc::now().timestamp();
    let hour = now / 3600;
    if rate.hour_bucket != hour {
        rate.hour_bucket = hour;
        rate.minimax_hour_tools = 0;
    }
    if rate.minimax_hour_tools >= 200 {
        return Err((StatusCode::TOO_MANY_REQUESTS, "MiniMax tool-call hour cap (200) reached".into()));
    }
    rate.minimax_hour_tools += 1;
    Ok(())
}

fn bump_nvidia_rate(st: &AppState) -> Result<(), (StatusCode, String)> {
    let mut rate = st.rate.write();
    let now = Utc::now().timestamp();
    let minute = now / 60;
    if rate.min_bucket != minute {
        rate.min_bucket = minute;
        rate.nvidia_min_tools = 0;
    }
    if rate.nvidia_min_tools >= 40 {
        return Err((StatusCode::TOO_MANY_REQUESTS, "NVIDIA minute cap reached".into()));
    }
    rate.nvidia_min_tools += 1;
    Ok(())
}

async fn call_minimax(key: &str, system: &str, messages: &[Msg]) -> Result<String, (StatusCode, String)> {
    call_minimax_opts(key, system, messages, 2048, 0.3).await
}

pub async fn call_minimax_opts(
    key: &str,
    system: &str,
    messages: &[Msg],
    max_tokens: u32,
    temperature: f32,
) -> Result<String, (StatusCode, String)> {
    let primary = std::env::var("OMNI_MINIMAX_BASE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://api.minimax.io/v1/text/chatcompletion_v2".into());
    let fallback = std::env::var("OMNI_MINIMAX_FALLBACK")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://api.minimaxi.chat/v1/text/chatcompletion_v2".into());
    match call_openai_compatible_opts(
        &primary,
        key,
        "MiniMax-Text-01",
        system,
        messages,
        max_tokens,
        temperature,
    )
    .await
    {
        Ok(c) => Ok(c),
        Err(e1) => {
            if primary == fallback {
                return Err((StatusCode::BAD_GATEWAY, e1));
            }
            call_openai_compatible_opts(
                &fallback,
                key,
                "MiniMax-Text-01",
                system,
                messages,
                max_tokens,
                temperature,
            )
            .await
            .map_err(|e2| (StatusCode::BAD_GATEWAY, format!("{e1} | fallback: {e2}")))
        }
    }
}

async fn call_nvidia_embeddings(key: &str, model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let body = serde_json::json!({
        "model": model,
        "input": texts,
        "encoding_format": "float",
    });
    let client = reqwest::Client::new();
    let resp = client
        .post("https://integrate.api.nvidia.com/v1/embeddings")
        .bearer_auth(key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{status}: {text}"));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = v["data"].as_array() {
        for item in arr {
            if let Some(emb) = item["embedding"].as_array() {
                out.push(emb.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect());
            }
        }
    }
    Ok(out)
}

async fn call_openai_compatible(
    url: &str,
    key: &str,
    model: &str,
    system: &str,
    messages: &[Msg],
) -> Result<String, String> {
    call_openai_compatible_opts(url, key, model, system, messages, 2048, 0.3).await
}

async fn call_openai_compatible_opts(
    url: &str,
    key: &str,
    model: &str,
    system: &str,
    messages: &[Msg],
    max_tokens: u32,
    temperature: f32,
) -> Result<String, String> {
    let mut msgs = vec![serde_json::json!({"role":"system","content": system})];
    for m in messages {
        msgs.push(serde_json::json!({"role": m.role, "content": m.content}));
    }
    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .bearer_auth(key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{status}: {text}"));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(c) = v["choices"][0]["message"]["content"].as_str() {
        return Ok(c.to_string());
    }
    if let Some(arr) = v["choices"][0]["message"]["content"].as_array() {
        let joined: String = arr.iter().filter_map(|x| x["text"].as_str()).collect();
        if !joined.is_empty() { return Ok(joined); }
    }
    if let Some(c) = v["reply"].as_str() {
        return Ok(c.to_string());
    }
    Err(format!("unexpected response: {text}"))
}
