import { defaultRhythm, type RhythmConfig } from './rhythm';

export type OmniPersonalityPreset = 'chill' | 'focused' | 'hype' | 'sarcastic' | 'quiet' | 'custom';

export type OmniConfig = {
  show: boolean;
  speak: boolean;
  volunteer: boolean;
  // Intelligence
  reasoningDepth: 'off' | 'low' | 'medium' | 'high';
  responseLength: 'short' | 'medium' | 'long';
  maxTokens: number;
  temperature: number;
  contextAmount: 'minimal' | 'normal' | 'deep';
  timeoutMs: number;
  speechSpeed: number;
  voiceId: string;
  // Personality
  preset: OmniPersonalityPreset;
  tone: number; // 0 soft .. 1 sharp
  humor: number;
  chattiness: number;
  encouragement: number;
  formality: number;
  language: string;
  customPersonality: string;
  // Rhythm
  rhythm: RhythmConfig;
};

export const PERSONALITY_PRESETS: Record<Exclude<OmniPersonalityPreset,'custom'>, { label: string; preview: string; text: string }> = {
  chill: {
    label: 'Chill buddy',
    preview: 'Easygoing, short check-ins, no pressure.',
    text: 'You are a chill coding buddy. Short, warm, never preachy. Keep replies to 1–2 sentences unless asked.',
  },
  focused: {
    label: 'Focused pro',
    preview: 'Crisp, factual, points at files when useful.',
    text: 'You are a focused professional pair. Brief, factual, precise. Mention file or section names when pointing.',
  },
  hype: {
    label: 'Hype coach',
    preview: 'Energetic congrats and momentum pushes.',
    text: 'You are a hype coach. Celebrate wins fast, nudge through stuck moments. Still brief — no pep-talk essays.',
  },
  sarcastic: {
    label: 'Sarcastic',
    preview: 'Dry wit, never mean about the user.',
    text: 'You are dry and lightly sarcastic about code and tools, never about the human. Keep it clever and short.',
  },
  quiet: {
    label: 'Quiet',
    preview: 'Speaks rarely; only when it matters.',
    text: 'You are quiet. Speak only when useful. Ultra-short lines. Prefer silence over filler.',
  },
};

export function defaultOmniConfig(): OmniConfig {
  return {
    show: true,
    speak: true,
    volunteer: true,
    reasoningDepth: 'low',
    responseLength: 'short',
    maxTokens: 256,
    temperature: 0.55,
    contextAmount: 'normal',
    timeoutMs: 20000,
    speechSpeed: 1.0,
    voiceId: 'male-qn-qingse',
    preset: 'chill',
    tone: 0.35,
    humor: 0.45,
    chattiness: 0.4,
    encouragement: 0.55,
    formality: 0.3,
    language: 'en',
    customPersonality: PERSONALITY_PRESETS.chill.text,
    rhythm: defaultRhythm(),
  };
}

const KEY = 'omni.presence.config';
const PRESETS_KEY = 'omni.presence.userPresets';

export function loadOmniConfig(): OmniConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return { ...defaultOmniConfig(), ...raw, rhythm: { ...defaultRhythm(), ...(raw?.rhythm || {}) } };
  } catch {
    return defaultOmniConfig();
  }
}

export function saveOmniConfig(cfg: OmniConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function listUserPresets(): { name: string; cfg: OmniConfig }[] {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveUserPreset(name: string, cfg: OmniConfig) {
  const all = listUserPresets().filter((p) => p.name !== name);
  all.push({ name, cfg });
  localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
}

export function deleteUserPreset(name: string) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(listUserPresets().filter((p) => p.name !== name)));
}

export function personalitySystemPrompt(cfg: OmniConfig): string {
  const base =
    cfg.preset === 'custom'
      ? cfg.customPersonality
      : PERSONALITY_PRESETS[cfg.preset]?.text || PERSONALITY_PRESETS.chill.text;
  const length =
    cfg.responseLength === 'short'
      ? 'Default to 1–2 short sentences.'
      : cfg.responseLength === 'long'
        ? 'You may go deeper when asked; still avoid walls of text.'
        : 'Keep replies brief unless the user asks for detail.';
  return `${base}
Never read code, markdown, chain-of-thought, or meta narration aloud. Never reveal hidden reasoning.
If you would include code, omit it and say you put it in the chat.
${length} Language: ${cfg.language}. Humor=${cfg.humor.toFixed(2)} chattiness=${cfg.chattiness.toFixed(2)} formality=${cfg.formality.toFixed(2)}.`;
}

/** Auto-configure from coarse latency + keys. */
export async function autoConfigureOmni(hasMinimax: boolean, latencyMs: number): Promise<OmniConfig> {
  const cfg = defaultOmniConfig();
  if (!hasMinimax) {
    cfg.speak = false;
    cfg.reasoningDepth = 'off';
    cfg.responseLength = 'short';
    cfg.maxTokens = 128;
    return cfg;
  }
  if (latencyMs < 400) {
    cfg.reasoningDepth = 'medium';
    cfg.responseLength = 'medium';
    cfg.maxTokens = 512;
    cfg.timeoutMs = 25000;
    cfg.contextAmount = 'deep';
    cfg.preset = 'focused';
    cfg.customPersonality = PERSONALITY_PRESETS.focused.text;
  } else if (latencyMs < 1200) {
    cfg.reasoningDepth = 'low';
    cfg.responseLength = 'short';
    cfg.maxTokens = 256;
    cfg.timeoutMs = 20000;
    cfg.contextAmount = 'normal';
    cfg.preset = 'chill';
  } else {
    cfg.reasoningDepth = 'off';
    cfg.responseLength = 'short';
    cfg.maxTokens = 160;
    cfg.timeoutMs = 15000;
    cfg.temperature = 0.4;
    cfg.contextAmount = 'minimal';
    cfg.speechSpeed = 1.05;
    cfg.preset = 'quiet';
    cfg.chattiness = 0.2;
    cfg.customPersonality = PERSONALITY_PRESETS.quiet.text;
  }
  return cfg;
}
