import { api, type ChatMessage } from './api';
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

  constructor(el: HTMLElement, mode: 'plain' | 'ultra') {
    this.el = el;
    this.mode = mode;
    this.render();
  }

  setMode(mode: 'plain' | 'ultra') {
    this.mode = mode;
    this.render();
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
  }

  private render() {
    const title = this.mode === 'ultra' ? 'OMNI CHAT' : 'CHAT';
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
          <textarea id="chat-input" rows="2" placeholder="${this.mode === 'ultra' ? 'Ask anything about your code...' : 'Ask OMNI-CODE something...'}"></textarea>
          <button class="send-btn" id="chat-send" title="Send">${svg.send}</button>
        </div>
        <div class="chat-actions">
          <button class="clear-chat" id="clear-chat">Clear chat</button>
        </div>
        <div class="chat-disclaimer">OMNI-CODE can make mistakes. Verify important information.</div>
      </div>
      <div class="thinking ${this.thinking && this.mode==='ultra' ? '' : 'hidden'}" id="thinking">
        <span class="dots"><span></span><span></span><span></span></span>
        Omni Ultra is thinking
      </div>
    `;
    this.paintMessages();
    this.bind();
  }

  private paintMessages() {
    const host = this.el.querySelector('#chat-msgs')!;
    host.innerHTML = this.messages.filter(m => m.role !== 'system').map((m, i) => {
      const who = m.role === 'user' ? 'You' : (this.mode === 'ultra' ? 'OMNI' : 'OMNI-CODE');
      const cls = m.role === 'user' ? 'user' : 'ai';
      const avatar = m.role === 'user' ? 'U' : (this.mode === 'ultra' ? '◈' : '◎');
      const body = formatBody(m.content);
      const time = this.times[i] || '';
      return `<div class="msg ${cls}">
        <div class="msg-head"><div class="avatar">${avatar}</div><strong>${who}</strong></div>
        <div class="msg-body">${body}</div>
        ${time ? `<div class="msg-foot"><span class="msg-time">${time}</span></div>` : ''}
      </div>`;
    }).join('');
    host.scrollTop = host.scrollHeight;
  }

  private bind() {
    const input = this.el.querySelector('#chat-input') as HTMLTextAreaElement;
    const send = () => this.send(input.value);
    this.el.querySelector('#chat-send')?.addEventListener('click', send);
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    this.el.querySelector('#clear-chat')?.addEventListener('click', () => this.clear());
    this.el.querySelector('[data-act="model"]')?.addEventListener('click', () => {
      const opts = ['Omni Ultra 1.2', 'MiniMax M3.1 Flash', 'NVIDIA Nemotron 3.5'];
      const i = opts.indexOf(this.model);
      this.model = opts[(i + 1) % opts.length];
      this.render();
    });
  }

  async send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.thinking) return;
    if (trimmed.startsWith('/')) {
      const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
      try {
        const r = await api.slash(cmd, rest.join(' '));
        this.messages.push({ role: 'user', content: trimmed });
        this.times.push('');
        this.messages.push({ role: 'assistant', content: r.message });
        this.times.push('');
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
    this.render();
    try {
      const r = await api.chat(this.messages, this.model);
      this.messages.push({ role: 'assistant', content: r.content });
      this.times.push('');
    } catch (e: any) {
      this.messages.push({
        role: 'assistant',
        content: `Could not reach the model API (${e.message}). Enter MiniMax / NVIDIA keys in the launcher, then try again.`,
      });
      this.times.push('');
    } finally {
      this.thinking = false;
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
  const keys = /\b(from|import|def|class|return|if|else|elif|None|True|False|async|await|const|let|var|export|function|new|try|catch|finally|with|as|in|is|not|and|or)\b/g;
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
