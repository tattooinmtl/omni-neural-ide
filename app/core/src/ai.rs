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
        "You are OMNI-CODE {}, a coding harness worker. Stay inside the project plan allow-list. Prefer concrete code. Mode: {}.",
        if *st.mode.read() == "ultra" { "Ultra" } else { "" },
        st.mode.read()
    );
    let content = call_minimax(&key, &system, &body.messages).await?;
    Ok(Json(ChatOut { content, model: "MiniMax (brain)".into() }))
}

/// Omni the Presence — separate MiniMax session/history, same pool.
pub async fn omni_chat(State(st): State<Arc<AppState>>, Json(body): Json<OmniIn>) -> Result<Json<ChatOut>, (StatusCode, String)> {
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
    let system = body.system.unwrap_or_else(|| "You are Omni the Presence — brief, human, factual. You are NOT the coding agent. Never output chain-of-thought, code fences, or meta narration. If code is needed, say you put it in the chat. 1–2 short sentences unless asked for detail.".into());
    let max_tokens = body.max_tokens.unwrap_or(256);
    let temperature = body.temperature.unwrap_or(0.55);
    let content = call_minimax_opts(&key, &system, &history, max_tokens, temperature).await?;
    st.omni_history.write().push(("assistant".into(), content.clone()));
    // Optional mood tag via NVIDIA side model (fail open)
    let _ = tag_mood_best_effort(&st, &content).await;
    Ok(Json(ChatOut { content, model: "Omni the Presence".into() }))
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

fn bump_minimax_rate(st: &AppState) -> Result<(), (StatusCode, String)> {
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

async fn call_minimax_opts(
    key: &str,
    system: &str,
    messages: &[Msg],
    max_tokens: u32,
    temperature: f32,
) -> Result<String, (StatusCode, String)> {
    match call_openai_compatible_opts(
        "https://api.minimax.io/v1/text/chatcompletion_v2",
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
        Err(e1) => call_openai_compatible_opts(
            "https://api.minimaxi.chat/v1/text/chatcompletion_v2",
            key,
            "MiniMax-Text-01",
            system,
            messages,
            max_tokens,
            temperature,
        )
        .await
        .map_err(|e2| (StatusCode::BAD_GATEWAY, format!("{e1} | fallback: {e2}"))),
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
