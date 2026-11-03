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

pub async fn chat(State(st): State<Arc<AppState>>, Json(body): Json<ChatIn>) -> Result<Json<ChatOut>, (StatusCode, String)> {
    let keys = st.keys.read().clone();
    let model = body.model.to_lowercase();
    let use_nvidia = model.contains("nvidia") || model.contains("nemotron");

    {
        let mut rate = st.rate.write();
        let now = Utc::now().timestamp();
        let hour = now / 3600;
        let minute = now / 60;
        if rate.hour_bucket != hour {
            rate.hour_bucket = hour;
            rate.minimax_hour_tools = 0;
        }
        if rate.min_bucket != minute {
            rate.min_bucket = minute;
            rate.nvidia_min_tools = 0;
        }
        if use_nvidia {
            if rate.nvidia_min_tools >= 20 {
                return Err((StatusCode::TOO_MANY_REQUESTS, "NVIDIA tool-call minute cap (20) reached".into()));
            }
            rate.nvidia_min_tools += 1;
        } else {
            if rate.minimax_hour_tools >= 200 {
                return Err((StatusCode::TOO_MANY_REQUESTS, "MiniMax tool-call hour cap (200) reached".into()));
            }
            rate.minimax_hour_tools += 1;
        }
    }

    let system = format!(
        "You are OMNI-CODE {}, a coding harness worker. Stay inside the project plan allow-list. Prefer concrete code. Mode: {}.",
        if *st.mode.read() == "ultra" { "Ultra" } else { "" },
        st.mode.read()
    );

    if use_nvidia {
        let key = keys.nvidia.filter(|s| !s.is_empty()).ok_or((
            StatusCode::UNAUTHORIZED,
            "NVIDIA API key not set — enter it in the launcher".into(),
        ))?;
        let content = call_openai_compatible(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            &key,
            "nvidia/nemotron-3-nano-3b-instruct",
            &system,
            &body.messages,
        )
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
        return Ok(Json(ChatOut { content, model: body.model }));
    }

    let key = keys.minimax.filter(|s| !s.is_empty()).ok_or((
        StatusCode::UNAUTHORIZED,
        "MiniMax API key not set — enter it in the launcher".into(),
    ))?;

    let content = match call_openai_compatible(
        "https://api.minimax.io/v1/text/chatcompletion_v2",
        &key,
        "MiniMax-Text-01",
        &system,
        &body.messages,
    )
    .await
    {
        Ok(c) => c,
        Err(e1) => call_openai_compatible(
            "https://api.minimaxi.chat/v1/text/chatcompletion_v2",
            &key,
            "MiniMax-Text-01",
            &system,
            &body.messages,
        )
        .await
        .map_err(|e2| (StatusCode::BAD_GATEWAY, format!("{e1} | fallback: {e2}")))?,
    };
    Ok(Json(ChatOut { content, model: body.model }))
}

async fn call_openai_compatible(
    url: &str,
    key: &str,
    model: &str,
    system: &str,
    messages: &[Msg],
) -> Result<String, String> {
    let mut msgs = vec![serde_json::json!({"role":"system","content": system})];
    for m in messages {
        msgs.push(serde_json::json!({"role": m.role, "content": m.content}));
    }
    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "temperature": 0.3,
        "max_tokens": 2048,
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
