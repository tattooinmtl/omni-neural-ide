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

  busy = false;

  /** Print a python_run / python_test result block. */
  printPython(label: string, r: any) {
    if (!r) return;
    if (r.stdout) this.println(String(r.stdout).replace(/\r/g, ''));
    if (r.stderr) this.println(String(r.stderr).replace(/\r/g, ''), 'err');
    const tag = r.stopped ? ' (stopped)' : r.timed_out ? ' (timeout)' : '';
    this.println(`[${label} exit ${r.code}${tag} · ${((r.elapsed_ms || 0) / 1000).toFixed(1)}s]`, r.ok ? 'ok' : 'err');
  }

  /** Local Python commands: py <file|-c code>, pytest [path], pip install <pkgs>. */
  private async tryPython(cmd: string): Promise<boolean> {
    let m: RegExpMatchArray | null;
    const go = async (label: string, f: () => Promise<any>) => {
      this.busy = true;
      this.println(`[${label}] running… (Esc / Ctrl+C to stop)`, 'dim');
      try { this.printPython(label, await f()); }
      catch (err: any) { this.println(String(err?.message || err), 'err'); }
      finally { this.busy = false; }
      return true;
    };
    if ((m = cmd.match(/^(?:py|python)\s+-c\s+([\s\S]+)$/))) return go('python', () => api.pythonRun({ code: m![1].replace(/^["']|["']$/g, '') }));
    if ((m = cmd.match(/^(?:py|python)\s+(\S+\.py)(.*)$/))) return go('python', () => api.pythonRun({ script: m![1], args: m![2].trim() ? m![2].trim().split(/\s+/) : [] }));
    if ((m = cmd.match(/^pytest(?:\s+(.+))?$/))) return go('pytest', () => api.pythonTest(m![1]));
    if ((m = cmd.match(/^pip\s+install\s+(.+)$/))) {
      const pkgs = m[1].trim().split(/\s+/);
      if (!window.confirm(`Install into the workspace venv?\n\npip install ${pkgs.join(' ')}`)) { this.println('pip install cancelled', 'err'); return true; }
      return go('pip', () => api.pythonPip(pkgs, true));
    }
    return false;
  }

  private async onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = this.input.value;
      this.input.value = '';
      if (!cmd.trim()) return;
      this.history.push(cmd);
      this.histIdx = this.history.length;
      this.println(`${this.cwd || '~'}$ ${cmd}`, 'cmd');
      if (await this.tryPython(cmd.trim())) return;
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
    if (e.key === 'Escape' || (e.key === 'c' && e.ctrlKey && !this.input.value)) {
      if (this.busy) { e.preventDefault(); this.println('^C — stopping…', 'err'); void api.agentStop(); }
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
