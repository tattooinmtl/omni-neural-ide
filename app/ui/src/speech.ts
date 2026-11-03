/** Sanitize text before Omni speaks or shows in the spoken bubble. Never speak code/meta. */

const META_PATTERNS = [
  /\b(as an ai|language model|chain[- ]of[- ]thought|my (hidden )?reasoning|let me think|well, the user)\b/gi,
  /\b(i (will|I'll) (now )?(analyze|examine|consider)|thinking step[- ]by[- ]step)\b/gi,
  /\b(system prompt|developer message|tool call|function call)\b/gi,
];

export function sanitizeForSpeech(raw: string): { speak: string; hadCode: boolean; display: string } {
  let text = String(raw ?? '');
  let hadCode = false;
  // Never speak/show raw HTML error pages
  if (/<!DOCTYPE|<html[\s>]/i.test(text)) {
    return { speak: "", hadCode: false, display: "" };
  }

  // Strip fenced code blocks
  if (/```/.test(text)) {
    hadCode = true;
    text = text.replace(/```[\w+-]*\n?[\s\S]*?```/g, '');
  }
  // Inline code
  if (/`[^`]+`/.test(text)) {
    hadCode = true;
    text = text.replace(/`[^`]+`/g, '');
  }
  // URLs
  text = text.replace(/https?:\/\/\S+/gi, '');
  text = text.replace(/\bwww\.\S+/gi, '');
  // File paths that look like code pointers — keep short mention, drop long paths with extensions in lists
  // Markdown headings/emphasis/noise
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/[*_~]{1,3}/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Meta / CoT
  for (const re of META_PATTERNS) text = text.replace(re, '');
  // Symbol salad
  text = text.replace(/[{}\[\]<>|\\/^~`]{2,}/g, ' ');
  text = text.replace(/[^\S\n]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  // Prefer first 1–3 short sentences for speech
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let speak = sentences.slice(0, 3).join(' ').trim();
  if (speak.length > 220) speak = speak.slice(0, 217).replace(/\s+\S*$/, '') + '…';

  if (hadCode) {
    const pointer = 'I put the code in the chat.';
    speak = speak ? `${speak} ${pointer}` : pointer;
  }
  if (!speak) {
    speak = hadCode ? 'I put it in the chat.' : '';
  }

  // Display bubble: never show raw CoT; use sanitized text (fuller than speak)
  let display = text;
  if (hadCode && !/put (the )?code in the chat/i.test(display)) {
    display = (display ? display + ' ' : '') + '(Code’s in the chat.)';
  }
  display = display.trim();

  return { speak, hadCode, display: display || speak };
}

export function isSpeakable(s: string): boolean {
  return sanitizeForSpeech(s).speak.trim().length > 0;
}
