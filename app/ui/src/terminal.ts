/** Terminal + Console panels. Terminal talks to /api/term/exec (line-oriented shell). */

import { api } from './api';

export class TerminalPanel {
  el: HTMLElement;
  out: HTMLElement;
  input: HTMLInputElement;
  cwd: string;
  history: string[] = [];
  histIdx = -1;

  constructor(host: HTMLElement, cwd: string) {
    this.cwd = cwd || '';
    this.el = host;
    host.classList.add('term-panel');
    host.innerHTML = `
      <div class="term-out" id="term-out"></div>
      <div class="term-in-row">
        <span class="term-prompt" id="term-prompt">${escape(this.cwd || '~')}$</span>
        <input class="term-input" id="term-input" spellcheck="false" autocomplete="off" />
      </div>`;
    this.out = host.querySelector('#term-out')!;
    this.input = host.querySelector('#term-input')!;
    this.println(`OMNI-CODE Terminal · ${navigator.platform.includes('Win') ? 'PowerShell' : 'shell'} via core`);
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  setCwd(cwd: string) {
    this.cwd = cwd;
    const p = this.el.querySelector('#term-prompt');
    if (p) p.textContent = `${cwd || '~'}$`;
  }

  focus() { this.input.focus(); }

  println(text: string, cls = '') {
    const line = document.createElement('div');
    line.className = 'term-line ' + cls;
    line.textContent = text;
    this.out.appendChild(line);
    this.out.scrollTop = this.out.scrollHeight;
  }

  clear() { this.out.innerHTML = ''; }

  private async onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = this.input.value;
      this.input.value = '';
      if (!cmd.trim()) return;
      this.history.push(cmd);
      this.histIdx = this.history.length;
      this.println(`${this.cwd || '~'}$ ${cmd}`, 'cmd');
      try {
        const r = await api.termExec(cmd, this.cwd || undefined);
        if (r.cwd) this.setCwd(r.cwd);
        if (r.stdout) this.println(r.stdout.replace(/\r/g, ''));
        if (r.stderr) this.println(r.stderr.replace(/\r/g, ''), 'err');
        if (r.code !== 0 && !r.stderr) this.println(`[exit ${r.code}]`, 'err');
      } catch (err: any) {
        this.println(String(err?.message || err), 'err');
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.histIdx > 0) {
        this.histIdx--;
        this.input.value = this.history[this.histIdx] || '';
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.histIdx < this.history.length - 1) {
        this.histIdx++;
        this.input.value = this.history[this.histIdx] || '';
      } else {
        this.histIdx = this.history.length;
        this.input.value = '';
      }
    }
  }
}

export class ConsolePanel {
  el: HTMLElement;
  out: HTMLElement;
  constructor(host: HTMLElement) {
    this.el = host;
    host.classList.add('console-panel');
    host.innerHTML = `<div class="term-out" id="console-out"></div>`;
    this.out = host.querySelector('#console-out')!;
    this.log('Console ready — app and agent logs appear here.');
  }
  log(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    const line = document.createElement('div');
    line.className = 'term-line ' + level;
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${msg}`;
    this.out.appendChild(line);
    this.out.scrollTop = this.out.scrollHeight;
  }
  clear() { this.out.innerHTML = ''; }
}

function escape(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}
