//! MiniMax TTS (speech-2.8-turbo).
//!
//! Endpoint: POST https://api.minimax.io/v1/t2a_v2
//! Emotions: happy, sad, angry, fearful, disgusted, surprised, calm, fluent
//! Interjections (speech-2.8): (laughs) (sighs) (breath) etc.

use crate::emotion::Emotion;
use serde::Serialize;

#[derive(Serialize)]
struct TtsRequest<'a> {
    model: &'a str,
    text: &'a str,
    stream: bool,
    voice_setting: VoiceSetting<'a>,
    audio_setting: AudioSetting<'a>,
    output_format: &'a str,
}

#[derive(Serialize)]
struct VoiceSetting<'a> {
    voice_id: &'a str,
    speed: f32,
    vol: f32,
    pitch: i32,
    emotion: &'a str,
}

#[derive(Serialize)]
struct AudioSetting<'a> {
    sample_rate: u32,
    bitrate: u32,
    format: &'a str,
    channel: u32,
}

pub fn build_tts_body(text: &str, emotion: &Emotion, voice_id: &str) -> String {
    let body = TtsRequest {
        model: "speech-2.8-turbo",
        text,
        stream: false,
        voice_setting: VoiceSetting {
            voice_id,
            speed: 1.0,
            vol: 1.0,
            pitch: 0,
            emotion: emotion.tts_emotion(),
        },
        audio_setting: AudioSetting {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
        },
        output_format: "hex",
    };
    serde_json::to_string(&body).unwrap_or_else(|_| "{}".into())
}

pub fn endpoint() -> &'static str {
    "https://api.minimax.io/v1/t2a_v2"
}
