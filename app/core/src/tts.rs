use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct TtsIn { pub text: String }

pub async fn tts(State(st): State<Arc<AppState>>, Json(body): Json<TtsIn>) -> Result<axum::response::Response, (StatusCode, String)> {
    let key = st.keys.read().minimax.clone().filter(|s| !s.is_empty())
        .ok_or((StatusCode::UNAUTHORIZED, "MiniMax key required for TTS".into()))?;
    // MiniMax TTS (speech-01) — returns binary audio when available
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "model": "speech-01-turbo",
        "text": body.text,
        "voice_setting": { "voice_id": "male-qn-qingse", "speed": 1.0, "vol": 1.0, "pitch": 0 }
    });
    let resp = client.post("https://api.minimax.io/v1/t2a_v2")
        .bearer_auth(&key)
        .json(&payload)
        .send().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if !status.is_success() {
        return Err((StatusCode::BAD_GATEWAY, format!("{status}: {}", String::from_utf8_lossy(&bytes))));
    }
    // If JSON with audio URL/base64, pass through empty to trigger client fallback
    if bytes.starts_with(b"{") {
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        if let Some(b64) = v["data"]["audio"].as_str().or_else(|| v["audio_file"].as_str()) {
            use axum::body::Body;
            use axum::http::{header, Response};
            // may be hex-encoded for minimax; try decode hex then base64
            if let Ok(raw) = hex_decode(b64) {
                return Ok(Response::builder().header(header::CONTENT_TYPE, "audio/mpeg").body(Body::from(raw)).unwrap());
            }
        }
        return Ok(axum::response::Response::builder()
            .status(204)
            .body(axum::body::Body::empty())
            .unwrap());
    }
    Ok(axum::response::Response::builder()
        .header(axum::http::header::CONTENT_TYPE, "audio/mpeg")
        .body(axum::body::Body::from(bytes))
        .unwrap())
}

fn hex_decode(s: &str) -> Result<Vec<u8>, ()> {
    if s.len() % 2 != 0 { return Err(()); }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i+2], 16).map_err(|_|())).collect()
}
