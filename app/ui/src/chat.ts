import { api, ApiError, type ChatMessage } from './api';
import { svg } from './icons';

export type FixtureMsg = { role: 'user' | 'assistant'; content: string; time?: string };

export class ChatPanel {
  private el: HTMLElement;
  private messages: ChatMessage[] = [];
  private times: string[] = [];
  private model = 'Omni Ultra 1.2';
  private thinking = false;
  private mode: 'plain' | 'ultra';
  private showThinking = false;
  private abortCtrl: AbortController | null = null;
  private runId: string | null = null;
  private statusTimer = 0;
  private liveTokens = 0;
  private liveCost = 0;
  private liveElapsed = 0;
  private onFilesWritten: ((files: string[]) => void) | null = null;

  constructor(el: HTMLElement, mode: 'plain' | 'ultra') {
    this.el = el;
    this.mode = mode;
    this.render();
  }

  setMode(mode: 'plain' | 'ultra') {
    this.mode = mode;
    this.render();
  }

  setOnFilesWritten(cb: (files: string[]) => void) {
    this.onFilesWritten = cb;
  }

  stop() {
    void this.stopGeneration();
  }

  clear() {
    this.messages = [];
    this.times = [];
    this.thinking = false;
    this.showThinking = false;
    this.render();
  }

  /** Load a fixture transcript into the real chat component (no DOM faking). */
  loadFixture(msgs: FixtureMsg[], opts?: { thinking?: boolean }) {
    this.messages = msgs.map(m => ({ role: m.role, content: m.content }));
    this.times = msgs.map(m => m.time || '');
    this.showThinking = !!opts?.thinking && this.mode === 'ultra';
    this.thinking = this.showThinking;
    this.render();
    requestAnimationFrame(() => {
      const host = this.el.querySelector('#chat-msgs') as HTMLElement | null;
      if (host) host.scrollTop = 0;
    });
  }

  private render() {
    const title = this.mode === 'ultra' ? 'CODING AGENT' : 'CODING AGENT';
    this.el.innerHTML = `
      <div class="chat-header">
        <div class="title">
          <span class="sparkle">${svg.sparkle}</span>
          <span>${title}</span>
        </div>
        <div class="controls">
          <button title="Minimize">—</button>
          <button title="Close">${svg.close}</button>
        </div>
      </div>
      <div class="model-picker-wrap">
        <button class="model-picker" data-act="model">
          <span>${this.model}</span>
          <span>▾</span>
        </button>
      </div>
      <div class="chat-messages" id="chat-msgs"></div>
      <div class="chat-input-area">
        <div class="chat-input-row">
          <textarea id="chat-input" enterkeyhint="enter" rows="2" placeholder="${this.mode === 'ultra' ? 'Ask anything about your code...' : 'Ask OMNI-CODE something...'}"></textarea>
          <button class="send-btn" id="chat-send" title="Send">${svg.send}</button>
        </div>
        <div class="chat-actions">
          <button class="clear-chat" id="clear-chat">Clear chat</button>
        </div>
        <div class="chat-disclaimer">OMNI-CODE can make mistakes. Verify important information.</div>
      </div>
      <div class="thinking ${this.thinking ? '' : 'hidden'}" id="thinking">
        <span class="dots"><span></span><span></span><span></span></span>
        <span id="thinking-label">Coding Agent is thinking</span>
        <span class="token-meter" id="token-meter">${this.thinking ? `· ${this.liveTokens} tok · $${this.liveCost.toFixed(5)} · ${(this.liveElapsed/1000).toFixed(1)}s` : ''}</span>
        <button type="button" class="stop-btn" id="chat-stop" title="Stop (Esc)">Stop</button>
      </div>
    `;
    this.paintMessages();
    this.bind();
  }

  private paintMessages() {
    const host = this.el.querySelector('#chat-msgs')!;
    host.innerHTML = this.messages.filter(m => m.role !== 'system').map((m, i) => {
      const who = m.role === 'user' ? 'You' : 'Coding Agent';
      const cls = m.role === 'user' ? 'user' : 'ai';
      const avatar = m.role === 'user' ? 'U' : (this.mode === 'ultra' ? '◈' : '◎');
      const body = formatBody(m.content);
      const time = this.times[i] || '';
      return `<div class="msg ${cls}">
        <div class="msg-head"><div class="avatar">${avatar}</div><strong>${who}</strong>
          <button type="button" class="msg-copy" data-copy="${i}" title="Copy">⧉</button>
        </div>
        <div class="msg-body">${body}</div>
        ${time ? `<div class="msg-foot"><span class="msg-time">${time}</span></div>` : ''}
      </div>`;
    }).join('');
    // Fixture transcripts keep first message visible; live replies stick to bottom
    const fixture = this.times.some(x => !!x);
    host.scrollTop = fixture ? 0 : host.scrollHeight;
  }

  private bind() {
    const input = this.el.querySelector('#chat-input') as HTMLTextAreaElement;
    const send = () => this.send(input.value);
    this.el.querySelector('#chat-send')?.addEventListener('click', send);
    // Coding chat: Enter = newline (editor-like). Send only via button or Ctrl/Cmd+Enter.
    input?.addEventListener('keydown', e => {
      if (e.isComposing || (e as any).keyCode === 229) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        send();
        return;
      }
      // Never preventDefault on plain Enter — allow newline. Block accidental form submit higher up.
    });
    input?.addEventListener('keypress', e => {
      // Extra safeguard: some browsers fire submit on Enter in forms
      if (e.key === 'Enter' && !(e as KeyboardEvent).ctrlKey && !(e as KeyboardEvent).metaKey) {
        e.stopPropagation();
      }
    });
    input?.setAttribute('enterkeyhint', 'enter');
    this.el.querySelector('#clear-chat')?.addEventListener('click', () => this.clear());
    input?.style.setProperty('user-select', 'text');
    this.el.querySelectorAll('.msg-copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const i = Number((btn as HTMLElement).dataset.copy || -1);
        const m = this.messages.filter(x => x.role !== 'system')[i];
        if (!m) return;
        try { await navigator.clipboard.writeText(m.content); (btn as HTMLElement).textContent = '✓'; } catch {}
      });
    });
    // code card copy
    this.el.querySelectorAll('.code-card-head .copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pre = (btn as HTMLElement).closest('.code-card')?.querySelector('pre');
        if (!pre) return;
        try { await navigator.clipboard.writeText(pre.textContent || ''); } catch {}
      });
    });
    this.el.querySelector('[data-act="model"]')?.addEventListener('click', () => {
      const opts = ['Omni Ultra 1.2', 'MiniMax M3.1 Flash', 'NVIDIA Nemotron 3.5'];
      const i = opts.indexOf(this.model);
      this.model = opts[(i + 1) % opts.length];
      this.render();
    });
    this.el.querySelector('#chat-stop')?.addEventListener('click', () => void this.stopGeneration());
  }

  private escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.thinking) {
      e.preventDefault();
      void this.stopGeneration();
    }
  };

  private async stopGeneration() {
    try { this.abortCtrl?.abort(); } catch {}
    try { await api.agentStop(this.runId || undefined); } catch {}
    this.thinking = false;
    this.stopStatusPoll();
    this.messages.push({ role: 'assistant', content: 'Stopped — generation cancelled.' });
    this.times.push('');
    this.render();
  }

  private startStatusPoll() {
    this.stopStatusPoll();
    this.statusTimer = window.setInterval(async () => {
      try {
        const s = await api.agentStatus();
        if (!s.active && !this.thinking) return;
        this.liveTokens = s.tokens_out || 0;
        this.liveCost = s.cost_usd || 0;
        this.liveElapsed = s.elapsed_ms || 0;
        if (s.run_id) this.runId = s.run_id;
        const meter = this.el.querySelector('#token-meter');
        if (meter) meter.textContent = `· ${this.liveTokens} tok · $${this.liveCost.toFixed(5)} · ${(this.liveElapsed/1000).toFixed(1)}s`;
        // Client watchdog: idle > 60s with active thinking
        if (s.active && s.idle_ms > 60000) {
          console.warn('client watchdog: idle', s.idle_ms);
          void this.stopGeneration();
          this.messages.push({ role: 'assistant', content: 'Hit idle watchdog (no tokens) cap — stopped to protect the UI and your token budget.' });
          this.times.push('');
          this.render();
        }
      } catch { /* ignore */ }
    }, 400);
  }

  private stopStatusPoll() {
    if (this.statusTimer) { window.clearInterval(this.statusTimer); this.statusTimer = 0; }
  }

  /** Omni handoff: visible message + start Coding Agent run. */
  injectFromOmni(delegate: { task_id: string; message: string; coding_reply: string; files_written: string[] }) {
    const head = `From Omni: ${delegate.message}`;
    this.messages.push({ role: 'user', content: head });
    this.times.push('');
    if (delegate.coding_reply) {
      this.messages.push({ role: 'assistant', content: delegate.coding_reply });
      this.times.push('');
    }
    if (delegate.files_written?.length) {
      this.messages.push({ role: 'assistant', content: `Wrote: ${delegate.files_written.join(', ')}` });
      this.times.push('');
    }
    this.render();
  }

  async send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.thinking) return;
    if (trimmed.startsWith('/')) {
      const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
      try {
        this.messages.push({ role: 'user', content: trimmed });
        this.times.push('');
        if (cmd.toLowerCase() === 'update') {
          const mode = (new URLSearchParams(location.search).get('mode') || 'plain');
          const chk = await api.updateCheck();
          if (!chk.available) {
            this.messages.push({ role: 'assistant', content: `Already up to date (${chk.current}).` });
          } else {
            this.messages.push({ role: 'assistant', content: `Update ${chk.current} → ${chk.latest}. Applying…` });
            this.render();
            const a = await api.updateApply(mode);
            this.messages.push({ role: 'assistant', content: a.message });
          }
          this.times.push('');
          this.times.push('');
        } else {
          const r = await api.slash(cmd, rest.join(' '));
          this.messages.push({ role: 'assistant', content: r.message });
          this.times.push('');
        }
      } catch (e: any) {
        this.messages.push({ role: 'user', content: trimmed });
        this.times.push('');
        this.messages.push({ role: 'assistant', content: `Slash error: ${e.message}` });
        this.times.push('');
      }
      this.render();
      return;
    }
    this.messages.push({ role: 'user', content: trimmed });
    this.times.push('');
    this.thinking = true;
    this.liveTokens = 0; this.liveCost = 0; this.liveElapsed = 0;
    this.abortCtrl = new AbortController();
    window.addEventListener('keydown', this.escHandler);
    this.render();
    this.startStatusPoll();
    try {
      const r = await api.chat(this.messages, this.model, { signal: this.abortCtrl.signal });
      if (r.run_id) this.runId = r.run_id;
      if (r.usage) {
        this.liveTokens = r.usage.tokens_out;
        this.liveCost = r.usage.cost_usd;
        this.liveElapsed = r.usage.elapsed_ms;
      }
      if ((r as any).python) (window as any).__omniTerminal?.printPython?.('agent python', (r as any).python);
      const files = r.files_written || [];
      if (files.length) this.onFilesWritten?.(files);
      let content = r.content || '';
      if (r.stopped) content = content || 'Stopped — generation cancelled.';
      if (r.capped) content = r.capped;
      this.messages.push({ role: 'assistant', content });
      this.times.push('');
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        this.messages.push({ role: 'assistant', content: 'Stopped — generation cancelled.' });
      } else {
        let msg = "Can't reach my brain right now.";
        if (e instanceof ApiError) msg = e.message;
        else if (e?.message && !/<!DOCTYPE|<html/i.test(String(e.message))) msg = String(e.message).slice(0, 200);
        this.messages.push({ role: 'assistant', content: msg });
      }
      this.times.push('');
    } finally {
      this.thinking = false;
      this.abortCtrl = null;
      this.stopStatusPoll();
      window.removeEventListener('keydown', this.escHandler);
      this.render();
    }
  }
}

function formatBody(content: string): string {
  const parts: string[] = [];
  const re = /```(\w+)?([^\n]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    parts.push(esc(content.slice(last, m.index)));
    const meta = m[2] || '';
    const fileMatch = /file\s*=\s*"([^"]+)"/.exec(meta);
    const fname = fileMatch ? fileMatch[1] : '';
    const code = highlightCode(m[3].replace(/\n$/, '').trimEnd());
    parts.push(`<div class="code-card"><div class="code-card-head"><span>${esc(fname)}</span><button class="copy" title="Copy">${copyIcon()}</button></div><pre>${code}</pre></div>`);
    last = m.index + m[0].length;
  }
  parts.push(esc(content.slice(last)));
  return parts.join('');
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function copyIcon() {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10V3.5A1.5 1.5 0 0 1 4.5 2H10"/></svg>`;
}

function highlightCode(src: string): string {
  // Never freeze the UI on giant blobs (tower-defense HTML etc.)
  if (src.length > 4000) return esc(src.slice(0, 4000)) + '\n/* … truncated in chat — open the file tab */';
  const lines = src.split('\n').map(line => {
    // crude: strings first
    let out = '';
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
        j = Math.min(j + 1, line.length);
        out += `<span class="tok-str">${esc(line.slice(i, j))}</span>`;
        i = j;
        continue;
      }
      if (ch === '#') {
        out += `<span class="tok-cm">${esc(line.slice(i))}</span>`;
        break;
      }
      // identifier / keyword / number
      if (/[A-Za-z_]/.test(ch)) {
        let j = i + 1;
        while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
        const w = line.slice(i, j);
        const next = line.slice(j).match(/^\s*\(/);
        if (/^(from|import|def|class|return|if|else|elif|None|True|False|async|await|const|let|var|export|function|new|try|catch|finally|with|as|in|is|not|and|or)$/.test(w)) {
          out += `<span class="tok-kw">${esc(w)}</span>`;
        } else if (next) {
          out += `<span class="tok-fn">${esc(w)}</span>`;
        } else {
          out += esc(w);
        }
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i + 1;
        while (j < line.length && /[0-9.]/.test(line[j])) j++;
        out += `<span class="tok-num">${esc(line.slice(i, j))}</span>`;
        i = j;
        continue;
      }
      out += esc(ch);
      i++;
    }
    return out;
  });
  return lines.join('\n');
}
