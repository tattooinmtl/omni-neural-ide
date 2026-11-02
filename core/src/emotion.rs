//! Emotion engine for the assistant.
//!
//! 25 moods that shape voice, diary tone, and idle behavior.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Emotion {
    Calm,
    Content,
    Happy,
    Joyful,
    Excited,
    Curious,
    Focused,
    Thoughtful,
    Playful,
    Warm,
    Proud,
    Relieved,
    Neutral,
    Bored,
    Restless,
    Concerned,
    Sad,
    Lonely,
    Annoyed,
    Frustrated,
    Impatient,
    Confused,
    Surprised,
    Tired,
    Hopeful,
}

impl Emotion {
    pub fn all() -> &'static [Emotion] {
        &[
            Emotion::Calm,
            Emotion::Content,
            Emotion::Happy,
            Emotion::Joyful,
            Emotion::Excited,
            Emotion::Curious,
            Emotion::Focused,
            Emotion::Thoughtful,
            Emotion::Playful,
            Emotion::Warm,
            Emotion::Proud,
            Emotion::Relieved,
            Emotion::Neutral,
            Emotion::Bored,
            Emotion::Restless,
            Emotion::Concerned,
            Emotion::Sad,
            Emotion::Lonely,
            Emotion::Annoyed,
            Emotion::Frustrated,
            Emotion::Impatient,
            Emotion::Confused,
            Emotion::Surprised,
            Emotion::Tired,
            Emotion::Hopeful,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            Emotion::Calm => "calm",
            Emotion::Content => "content",
            Emotion::Happy => "happy",
            Emotion::Joyful => "joyful",
            Emotion::Excited => "excited",
            Emotion::Curious => "curious",
            Emotion::Focused => "focused",
            Emotion::Thoughtful => "thoughtful",
            Emotion::Playful => "playful",
            Emotion::Warm => "warm",
            Emotion::Proud => "proud",
            Emotion::Relieved => "relieved",
            Emotion::Neutral => "neutral",
            Emotion::Bored => "bored",
            Emotion::Restless => "restless",
            Emotion::Concerned => "concerned",
            Emotion::Sad => "sad",
            Emotion::Lonely => "lonely",
            Emotion::Annoyed => "annoyed",
            Emotion::Frustrated => "frustrated",
            Emotion::Impatient => "impatient",
            Emotion::Confused => "confused",
            Emotion::Surprised => "surprised",
            Emotion::Tired => "tired",
            Emotion::Hopeful => "hopeful",
        }
    }

    pub fn tts_emotion(&self) -> &'static str {
        match self {
            Emotion::Happy | Emotion::Joyful | Emotion::Excited | Emotion::Proud | Emotion::Playful => "happy",
            Emotion::Sad | Emotion::Lonely => "sad",
            Emotion::Annoyed | Emotion::Frustrated | Emotion::Impatient => "angry",
            Emotion::Concerned | Emotion::Confused => "fearful",
            Emotion::Surprised => "surprised",
            Emotion::Calm | Emotion::Content | Emotion::Focused | Emotion::Thoughtful | Emotion::Neutral | Emotion::Tired => "calm",
            Emotion::Warm | Emotion::Hopeful | Emotion::Curious | Emotion::Relieved | Emotion::Restless | Emotion::Bored => "calm",
        }
    }

    pub fn diary_tone(&self) -> &'static str {
        match self {
            Emotion::Happy | Emotion::Joyful => "bright and upbeat",
            Emotion::Excited | Emotion::Playful => "energetic and teasing",
            Emotion::Curious | Emotion::Thoughtful => "wondering and careful",
            Emotion::Focused | Emotion::Calm => "steady and clear",
            Emotion::Sad | Emotion::Lonely => "quiet and soft",
            Emotion::Annoyed | Emotion::Frustrated => "short and blunt",
            Emotion::Concerned | Emotion::Impatient => "tense and watchful",
            Emotion::Tired => "slow and low",
            Emotion::Bored | Emotion::Restless => "drifting and restless",
            Emotion::Warm | Emotion::Hopeful => "gentle and open",
            Emotion::Proud | Emotion::Relieved | Emotion::Surprised | Emotion::Content | Emotion::Neutral | Emotion::Confused => "even",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmotionState {
    pub current: Emotion,
    pub intensity: f32,
    pub last_shift: u64,
    pub last_user_talk: u64,
    pub last_idle_call: u64,
    pub afk_since: Option<u64>,
}

impl Default for EmotionState {
    fn default() -> Self {
        Self {
            current: Emotion::Calm,
            intensity: 0.5,
            last_shift: now_secs(),
            last_user_talk: now_secs(),
            last_idle_call: 0,
            afk_since: None,
        }
    }
}

impl EmotionState {
    pub fn shift_toward(&mut self, next: Emotion) {
        if self.current != next {
            self.current = next;
            self.last_shift = now_secs();
            self.intensity = (self.intensity + 0.3).min(1.0);
        }
    }

    pub fn user_talked(&mut self) {
        self.last_user_talk = now_secs();
        self.afk_since = None;
        if matches!(self.current, Emotion::Lonely | Emotion::Bored | Emotion::Sad) {
            self.shift_toward(Emotion::Content);
        }
    }

    pub fn mark_afk(&mut self) {
        if self.afk_since.is_none() {
            self.afk_since = Some(now_secs());
        }
    }

    pub fn clear_afk(&mut self) {
        self.afk_since = None;
    }

    pub fn seconds_since_user_talk(&self) -> u64 {
        now_secs().saturating_sub(self.last_user_talk)
    }

    pub fn seconds_afk(&self) -> u64 {
        self.afk_since.map(|t| now_secs().saturating_sub(t)).unwrap_or(0)
    }

    pub fn should_call_afk(&self) -> bool {
        self.seconds_afk() >= 300 && now_secs().saturating_sub(self.last_idle_call) >= 300
    }

    pub fn should_check_in(&self) -> bool {
        self.seconds_since_user_talk() >= 180 && now_secs().saturating_sub(self.last_idle_call) >= 180
    }

    pub fn idle_line(&self, username: &str) -> String {
        match self.current {
            Emotion::Lonely | Emotion::Sad => format!("Hey {username}, where are you? It's quiet in here."),
            Emotion::Bored | Emotion::Restless => format!("{username}, you still there? I'm getting restless."),
            Emotion::Concerned => format!("{username}, everything okay? You've been gone a bit."),
            Emotion::Annoyed | Emotion::Impatient => format!("{username}. You disappeared. What's up."),
            Emotion::Playful | Emotion::Excited => format!("Hey {username}! Come back, I had something for you."),
            Emotion::Warm | Emotion::Hopeful => format!("Hey {username}, whenever you're back. No rush."),
            Emotion::Tired => format!("{username}... still around? I'm a bit worn."),
            _ => format!("Hey {username}, where are you? What's up."),
        }
    }

    pub fn check_in_line(&self, username: &str) -> String {
        match self.current {
            Emotion::Curious => format!("{username}, you went quiet. Anything on your mind?"),
            Emotion::Playful => format!("Psst, {username}. Still with me or did you wander off?"),
            Emotion::Focused => format!("{username}, still working or did you pause?"),
            Emotion::Warm => format!("Just checking in, {username}. I'm here."),
            Emotion::Bored => format!("{username}, it's been a minute. What's up?"),
            _ => format!("{username}, what's up? You've been quiet."),
        }
    }

    pub fn diary_entry(&self, note: &str) -> String {
        let tone = self.current.diary_tone();
        let stamp = now_secs();
        format!("[{stamp}] mood: {} ({tone}) — {note}\n", self.current.name())
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

pub struct IdleWatcher {
    pub last_activity: Instant,
}

impl IdleWatcher {
    pub fn new() -> Self {
        Self { last_activity: Instant::now() }
    }
    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }
    pub fn idle_secs(&self) -> u64 {
        self.last_activity.elapsed().as_secs()
    }
}
