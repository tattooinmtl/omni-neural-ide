//! Built-in MCP connectors for GWN Search + Computer (OmniBots).
//!
//! Search: real Streamable-HTTP MCP at https://search.globalwarningnetworks.com/mcp
//! Computer: client-side adapter over https://computers.globalwarningnetworks.com REST
//!   (there is no computer MCP process on the VPS; computer.* TLS serves the wrong cert).

use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

type S = State<Arc<AppState>>;

pub const DEFAULT_SEARCH_URL: &str = "https://search.globalwarningnetworks.com/mcp";
pub const DEFAULT_COMPUTER_URL: &str = "https://computers.globalwarningnetworks.com";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusOut {
    pub search: ConnectorStatus,
    pub computer: ConnectorStatus,
    pub notes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    pub id: String,
    pub label: String,
    pub url: String,
    pub transport: String,
    pub configured: bool,
    pub ok: Option<bool>,
    pub detail: String,
    pub tools: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestIn {
    pub which: String, // "search" | "computer"
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallIn {
    pub tool: String,
    pub arguments: Option<Value>,
    /// Required for computer tools that act (click/type/exec/start/stop).
    pub confirm: Option<bool>,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .user_agent("OMNI-CODE-MCP/1.3.2")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn search_url(st: &AppState) -> String {
    let k = st.keys.read();
    k.mcp_search_url
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_SEARCH_URL.into())
}

fn computer_url(st: &AppState) -> String {
    let k = st.keys.read();
    k.mcp_computer_url
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_COMPUTER_URL.into())
}

fn search_key(st: &AppState) -> Option<String> {
    st.keys.read().mcp_search_key.clone().filter(|s| !s.is_empty())
}

fn computer_creds(st: &AppState) -> Option<(String, String)> {
    let k = st.keys.read();
    let bot = k.mcp_computer_bot.clone().filter(|s| !s.is_empty())?;
    let secret = k.mcp_computer_secret.clone().filter(|s| !s.is_empty())?;
    Some((bot, secret))
}

/// JSON-RPC POST to a Streamable-HTTP MCP endpoint.
async fn mcp_rpc(url: &str, bearer: &str, method: &str, params: Value, id: u64) -> Result<Value, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let resp = http()
        .post(url)
        .header("Authorization", format!("Bearer {bearer}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {}", text.chars().take(200).collect::<String>()));
    }
    // Prefer pure JSON; if SSE-ish, pick last data: line
    let json_text = if text.trim_start().starts_with('{') {
        text
    } else {
        text.lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|s| s.trim())
            .filter(|s| s.starts_with('{'))
            .last()
            .unwrap_or(text.trim())
            .to_string()
    };
    let v: Value = serde_json::from_str(&json_text).map_err(|e| format!("parse: {e}; body={}", json_text.chars().take(180).collect::<String>()))?;
    if let Some(err) = v.get("error") {
        return Err(err.to_string());
    }
    Ok(v.get("result").cloned().unwrap_or(v))
}

async fn computer_login(base: &str, bot: &str, secret: &str) -> Result<String, String> {
    let resp = http()
        .post(format!("{}/auth/login", base.trim_end_matches('/')))
        .json(&json!({ "bot": bot, "secret": secret }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(v.get("detail").and_then(|d| d.as_str()).unwrap_or("login failed").to_string());
    }
    v.get("token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "login response missing token".into())
}

async fn computer_get(base: &str, token: &str, path: &str) -> Result<Value, String> {
    let resp = http()
        .get(format!("{}{}", base.trim_end_matches('/'), path))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    // screenshot may be image bytes
    if path.contains("screenshot") {
        if !status.is_success() {
            let t = String::from_utf8_lossy(&bytes);
            return Err(format!("HTTP {status}: {}", t.chars().take(160).collect::<String>()));
        }
        let b64 = base64_encode(&bytes);
        return Ok(json!({
            "ok": true,
            "contentType": "image/png",
            "bytes": bytes.len(),
            "base64Prefix": format!("data:image/png;base64,{}", &b64[..b64.len().min(64)]),
            "base64": b64,
            "note": "Screenshot fetched (read-only)."
        }));
    }
    let v: Value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes) }));
    if !status.is_success() {
        return Err(v.get("detail").and_then(|d| d.as_str()).unwrap_or("request failed").to_string());
    }
    Ok(v)
}

async fn computer_post(base: &str, token: &str, path: &str, body: Value) -> Result<Value, String> {
    let resp = http()
        .post(format!("{}{}", base.trim_end_matches('/'), path))
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(v.get("detail").and_then(|d| d.as_str()).unwrap_or("request failed").to_string());
    }
    Ok(v)
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.encode(bytes)
}

pub async fn status(State(st): S) -> Json<McpStatusOut> {
    let search_cfg = search_key(&st).is_some();
    let computer_cfg = computer_creds(&st).is_some();
    Json(McpStatusOut {
        search: ConnectorStatus {
            id: "search".into(),
            label: "GWN Search MCP".into(),
            url: search_url(&st),
            transport: "streamable-http".into(),
            configured: search_cfg,
            ok: None,
            detail: if search_cfg {
                "Key saved — click Test".into()
            } else {
                "Paste the MCP Bearer key from your GWN admin".into()
            },
            tools: vec!["web_search".into()],
        },
        computer: ConnectorStatus {
            id: "computer".into(),
            label: "GWN Computer (OmniBots adapter)".into(),
            url: computer_url(&st),
            transport: "rest-adapter".into(),
            configured: computer_cfg,
            ok: None,
            detail: if computer_cfg {
                "Bot credentials saved — click Test".into()
            } else {
                "Uses computers.globalwarningnetworks.com REST (client adapter). Enter bot + secret.".into()
            },
            tools: vec![
                "computer_status".into(),
                "computer_screenshot".into(),
                "computer_start".into(),
                "computer_stop".into(),
                "computer_exec".into(),
                "computer_input".into(),
            ],
        },
        notes: vec![
            "search.globalwarningnetworks.com/mcp is the live Streamable-HTTP MCP (Bearer key).".into(),
            "computer.globalwarningnetworks.com has broken public TLS (wrong/default cert); the app targets computers.globalwarningnetworks.com via a client-side REST→tools adapter. No VPS changes.".into(),
            "Acting computer tools (exec/input/start/stop) require confirm=true from the UI.".into(),
        ],
    })
}

pub async fn test_connector(State(st): S, Json(body): Json<McpTestIn>) -> Result<Json<Value>, (StatusCode, String)> {
    match body.which.as_str() {
        "search" => {
            let key = search_key(&st).ok_or((StatusCode::BAD_REQUEST, "Search MCP key not set".into()))?;
            let url = search_url(&st);
            let init = mcp_rpc(
                &url,
                &key,
                "initialize",
                json!({"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"OMNI-CODE","version":"1.3.2"}}),
                1,
            )
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            let tools = mcp_rpc(&url, &key, "tools/list", json!({}), 2)
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            let names: Vec<String> = tools
                .get("tools")
                .and_then(|t| t.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(Json(json!({
                "ok": true,
                "which": "search",
                "serverInfo": init.get("serverInfo"),
                "tools": names,
                "detail": "Search MCP reachable"
            })))
        }
        "computer" => {
            let (bot, secret) = computer_creds(&st).ok_or((StatusCode::BAD_REQUEST, "Computer bot/secret not set".into()))?;
            let base = computer_url(&st);
            let token = computer_login(&base, &bot, &secret)
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            let stv = computer_get(&base, &token, "/computer")
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            Ok(Json(json!({
                "ok": true,
                "which": "computer",
                "bot": bot,
                "status": stv,
                "detail": "Computer REST adapter login OK"
            })))
        }
        _ => Err((StatusCode::BAD_REQUEST, "which must be search|computer".into())),
    }
}

pub async fn list_tools(State(st): S) -> Json<Value> {
    let mut tools = vec![];
    if search_key(&st).is_some() {
        tools.push(json!({
            "name": "web_search",
            "connector": "search",
            "description": "Search the web via GWN Search MCP",
            "destructive": false
        }));
    }
    if computer_creds(&st).is_some() {
        for (name, desc, destructive) in [
            ("computer_status", "Read-only status of the bot computer", false),
            ("computer_screenshot", "Capture a screenshot (read-only)", false),
            ("computer_start", "Start the bot computer container", true),
            ("computer_stop", "Stop the bot computer container", true),
            ("computer_exec", "Run a shell command on the bot computer", true),
            ("computer_input", "Send keyboard/mouse input to the bot computer", true),
        ] {
            tools.push(json!({ "name": name, "connector": "computer", "description": desc, "destructive": destructive }));
        }
    }
    Json(json!({ "tools": tools }))
}

pub async fn call_tool(State(st): S, Json(body): Json<McpCallIn>) -> Result<Json<Value>, (StatusCode, String)> {
    let args = body.arguments.unwrap_or(json!({}));
    match body.tool.as_str() {
        "web_search" => {
            let key = search_key(&st).ok_or((StatusCode::BAD_REQUEST, "Search MCP key not set".into()))?;
            let url = search_url(&st);
            // ensure session
            let _ = mcp_rpc(
                &url,
                &key,
                "initialize",
                json!({"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"OMNI-CODE","version":"1.3.2"}}),
                10,
            )
            .await;
            let result = mcp_rpc(
                &url,
                &key,
                "tools/call",
                json!({"name":"web_search","arguments": args}),
                11,
            )
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            Ok(Json(json!({ "ok": true, "tool": "web_search", "ran": true, "result": result })))
        }
        "computer_status" | "computer_screenshot" | "computer_start" | "computer_stop" | "computer_exec" | "computer_input" => {
            let destructive = matches!(body.tool.as_str(), "computer_start" | "computer_stop" | "computer_exec" | "computer_input");
            if destructive && body.confirm != Some(true) {
                return Err((
                    StatusCode::FORBIDDEN,
                    "This computer action requires user confirmation (confirm=true).".into(),
                ));
            }
            let (bot, secret) = computer_creds(&st).ok_or((StatusCode::BAD_REQUEST, "Computer bot/secret not set".into()))?;
            let base = computer_url(&st);
            let token = computer_login(&base, &bot, &secret)
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            let result = match body.tool.as_str() {
                "computer_status" => computer_get(&base, &token, "/computer").await,
                "computer_screenshot" => computer_get(&base, &token, "/computer/screenshot").await,
                "computer_start" => computer_post(&base, &token, "/computer/start", json!({})).await,
                "computer_stop" => computer_post(&base, &token, "/computer/stop", json!({})).await,
                "computer_exec" => {
                    let cmd = args.get("cmd").cloned().unwrap_or(json!([]));
                    computer_post(&base, &token, "/computer/exec", json!({ "cmd": cmd })).await
                }
                "computer_input" => computer_post(&base, &token, "/computer/input", args).await,
                _ => unreachable!(),
            }
            .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            Ok(Json(json!({ "ok": true, "tool": body.tool, "ran": true, "result": result })))
        }
        other => Err((StatusCode::BAD_REQUEST, format!("Unknown tool: {other}"))),
    }
}

/// Helper used by Omni / Coding Agent tool lines.
pub async fn run_named_tool(st: &Arc<AppState>, tool: &str, arg: &str) -> Result<String, String> {
    match tool {
        "web_search" => {
            let key = search_key(st).ok_or_else(|| "Search MCP key not set in Settings".to_string())?;
            let url = search_url(st);
            let _ = mcp_rpc(
                &url,
                &key,
                "initialize",
                json!({"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"OMNI-CODE","version":"1.3.2"}}),
                20,
            )
            .await;
            let result = mcp_rpc(
                &url,
                &key,
                "tools/call",
                json!({"name":"web_search","arguments":{"query": arg, "limit": 5}}),
                21,
            )
            .await?;
            let text = result
                .pointer("/content/0/text")
                .and_then(|t| t.as_str())
                .unwrap_or("Search finished (no text).");
            Ok(text.to_string())
        }
        "computer_status" => {
            let (bot, secret) = computer_creds(st).ok_or_else(|| "Computer credentials not set".to_string())?;
            let base = computer_url(st);
            let token = computer_login(&base, &bot, &secret).await?;
            let v = computer_get(&base, &token, "/computer").await?;
            Ok(v.to_string())
        }
        "computer_screenshot" => {
            let (bot, secret) = computer_creds(st).ok_or_else(|| "Computer credentials not set".to_string())?;
            let base = computer_url(st);
            let token = computer_login(&base, &bot, &secret).await?;
            let v = computer_get(&base, &token, "/computer/screenshot").await?;
            let n = v.get("bytes").and_then(|b| b.as_u64()).unwrap_or(0);
            Ok(format!("Screenshot captured ({n} bytes)."))
        }
        _ => Err(format!("Tool {tool} must be invoked via /api/mcp/call with confirmation")),
    }
}
