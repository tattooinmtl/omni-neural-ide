import { api, type ChatMessage } from './api';
import { svg } from './icons';

export class ChatPanel {
  private el: HTMLElement;
  private messages: ChatMessage[] = [];
  private model = 'Omni Ultra 1.2';
  private thinking = false;
  private mode: 'plain' | 'ultra';

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
          <button title="Close" data-act="close-chat">${svg.close}</button>
        </div>
      </div>
      <div class="model-picker-wrap">
        <button class="model-picker" data-act="model">
          <span>${this.model}</span>
          <span>▾</span>
        </button>
      </div>
      <div class="chat-messages" id="chat-msgs"></div>
      <div class="thinking ${this.thinking ? '' : 'hidden'}" id="thinking">
        <span class="dots"><span></span><span></span><span></span></span>
        Omni Ultra is thinking.
      </div>
      <div class="chat-input-area">
        <div class="chat-input-row">
          <textarea id="chat-input" rows="2" placeholder="${this.mode === 'ultra' ? 'Ask anything about your code...' : 'Ask OMNI-CODE something...'}"></textarea>
          <button class="send-btn" id="chat-send" title="Send">${svg.send}</button>
        </div>
        <div class="chat-actions">
          <button class="clear-chat" id="clear-chat">Clear chat</button>
          <span></span>
        </div>
        <div class="chat-disclaimer">OMNI-CODE can make mistakes. Verify important information.</div>
      </div>
    `;
    this.paintMessages();
    this.bind();
  }

  private paintMessages() {
    const host = this.el.querySelector('#chat-msgs')!;
    host.innerHTML = this.messages.filter(m => m.role !== 'system').map(m => {
      const who = m.role === 'user' ? 'You' : (this.mode === 'ultra' ? 'OMNI' : 'OMNI-CODE');
      const cls = m.role === 'user' ? 'user' : 'ai';
      const avatar = m.role === 'user' ? 'U' : '◎';
      const body = formatBody(m.content);
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<div class="msg ${cls}">
        <div class="msg-head"><div class="avatar">${avatar}</div><strong>${who}</strong><span class="msg-time">${time}</span></div>
        <div class="msg-body">${body}</div>
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
        this.messages.push({ role: 'assistant', content: r.message });
      } catch (e: any) {
        this.messages.push({ role: 'user', content: trimmed });
        this.messages.push({ role: 'assistant', content: `Slash error: ${e.message}` });
      }
      this.render();
      return;
    }
    this.messages.push({ role: 'user', content: trimmed });
    this.thinking = true;
    this.render();
    try {
      const r = await api.chat(this.messages, this.model);
      this.messages.push({ role: 'assistant', content: r.content });
    } catch (e: any) {
      this.messages.push({
        role: 'assistant',
        content: `Could not reach the model API (${e.message}). Enter MiniMax / NVIDIA keys in the launcher, then try again.`,
      });
    } finally {
      this.thinking = false;
      this.render();
    }
  }
}

function formatBody(content: string): string {
  const escaped = content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<div class="code-block"><button class="copy">Copy</button>${code.trimEnd()}</div>`;
  });
}
