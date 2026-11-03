import { pickWeighted, type JokeCategory } from './jokes';

export type RhythmConfig = {
  enabled: boolean;
  dnd: boolean;
  quietHoursStart: number; // 0-23
  quietHoursEnd: number;
  idleMinutes: number;
  sessionBreakMinutes: number;
  typingBurstMs: number;
  cooldownSec: number;
  frustrationErrors: number;
};

export const defaultRhythm = (): RhythmConfig => ({
  enabled: true,
  dnd: false,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  idleMinutes: 8,
  sessionBreakMinutes: 50,
  typingBurstMs: 2500,
  cooldownSec: 90,
  frustrationErrors: 3,
});

export type ActivitySignals = {
  now: number;
  typingRate: number; // keys / sec recent
  lastTypeAt: number;
  editRate: number;
  undoChurn: number;
  recentErrors: number;
  buildFailed: boolean;
  buildPassed: boolean;
  gitCommit: boolean;
  sessionMin: number;
  cpuPct: number;
  idleSec: number; // OS idle
  onBattery: boolean;
};

export type TriggerResult = {
  score: number;
  action: JokeCategory | 'none';
  reason: string;
};

export function inQuietHours(cfg: RhythmConfig, now = new Date()): boolean {
  const h = now.getHours();
  const s = cfg.quietHoursStart;
  const e = cfg.quietHoursEnd;
  if (s === e) return false;
  if (s < e) return h >= s && h < e;
  return h >= s || h < e;
}

export function scoreTrigger(sig: ActivitySignals, cfg: RhythmConfig, lastFireAt: number): TriggerResult {
  if (!cfg.enabled || cfg.dnd) return { score: 0, action: 'none', reason: 'dnd' };
  if (inQuietHours(cfg, new Date(sig.now))) return { score: 0, action: 'none', reason: 'quiet' };
  if (sig.now - lastFireAt < cfg.cooldownSec * 1000) return { score: 0, action: 'none', reason: 'cooldown' };

  // Never interrupt mid typing burst
  if (sig.now - sig.lastTypeAt < cfg.typingBurstMs) {
    return { score: 0, action: 'none', reason: 'typing-burst' };
  }

  let score = 0;
  let action: JokeCategory | 'none' = 'none';
  let reason = '';

  if (sig.buildPassed || sig.gitCommit) {
    score += 8;
    action = 'congrats';
    reason = sig.gitCommit ? 'commit' : 'build-pass';
  } else if (sig.buildFailed || sig.recentErrors >= cfg.frustrationErrors || sig.undoChurn > 6) {
    score += 7 + Math.min(4, sig.recentErrors);
    action = 'cheer_ups';
    reason = 'frustration';
  } else if (sig.sessionMin >= cfg.sessionBreakMinutes && sig.cpuPct > 5) {
    score += 6;
    action = 'break_reminders';
    reason = 'long-session';
  } else if (sig.idleSec >= cfg.idleMinutes * 60 && sig.cpuPct < 12) {
    score += 9;
    action = 'idle_callouts';
    reason = 'os-idle';
  } else if (sig.typingRate > 0.3 && sig.typingRate < 2.5 && sig.editRate > 0) {
    score += 4;
    action = 'coding_jokes';
    reason = 'steady-flow';
  } else if (sig.recentErrors > 0 && sig.recentErrors < cfg.frustrationErrors) {
    score += 3;
    action = 'tension_breakers';
    reason = 'light-errors';
  }

  if (sig.onBattery) score += 1; // nudge idle/break slightly

  if (score < 4 || action === 'none') return { score, action: 'none', reason: reason || 'low' };
  return { score, action, reason };
}

export function fireLine(action: JokeCategory): string {
  const hit = pickWeighted([action], { [action]: 1 });
  return hit?.line || '';
}
