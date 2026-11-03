import { api } from './api';

const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance / Theme' },
  { id: 'editor', label: 'Editor' },
  { id: 'providers', label: 'Providers' },
  { id: 'assistant', label: 'Omni the Presence' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'about', label: 'About' },
] as const;

type CatId = (typeof CATEGORIES)[number]['id'];

export class SettingsView {
  private root: HTMLElement;
  private cat: CatId = 'providers';
  private showMinimax = false;
  private showNvidia = false;

  static open(host: HTMLElement): SettingsView {
    const el = document.createElement('div');
    el.className = 'settings-overlay';
    host.appendChild(el);
    const v = new SettingsView(el);
    v.render();
    return v;
  }

  private constructor(root: HTMLElement) {
    this.root = root;
  }

  close() {
    this.root.remove();
  }

  private async render() {
    this.root.innerHTML = `
      <div class="settings-shell">
        <div class="settings-header">
          <span>Settings</span>
          <button class="settings-close" title="Close">✕</button>
        </div>
        <div class="settings-body">
          <nav class="settings-cats"></nav>
          <div class="settings-page"></div>
        </div>
      </div>`;
    this.root.querySelector('.settings-close')?.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.paintCats();
    await this.paintPage();
  }

  private paintCats() {
    const nav = this.root.querySelector('.settings-cats')!;
    nav.innerHTML = CATEGORIES.map(
      (c) => `<button class="settings-cat ${c.id === this.cat ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>`
    ).join('');
    nav.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        this.cat = (btn as HTMLElement).dataset.cat as CatId;
        this.paintCats();
        await this.paintPage();
      });
    });
  }

  private async paintPage() {
    const page = this.root.querySelector('.settings-page')!;
    switch (this.cat) {
      case 'providers':
        await this.paintProviders(page);
        break;
      case 'general':
        page.innerHTML = `<h2>General</h2>
          <p class="settings-hint">Launch mode is chosen in the OMNI-CODE Gateway each start.</p>
          <label class="settings-field">Default project folder<input id="set-project" placeholder="%USERPROFILE%\\Projects" /></label>`;
        break;
      case 'appearance':
        page.innerHTML = `<h2>Appearance / Theme</h2>
          <p class="settings-hint">Matches the current Plain / Ultra chrome. Light theme toggle:</p>
          <button id="set-theme-toggle" class="settings-btn">Toggle light theme</button>`;
        page.querySelector('#set-theme-toggle')?.addEventListener('click', () => {
          document.body.classList.toggle('mode-light');
        });
        break;
      case 'editor':
        page.innerHTML = `<h2>Editor</h2>
          <label class="settings-field">Tab size<input type="number" value="2" min="1" max="8"/></label>
          <label class="settings-field"><input type="checkbox" checked/> Word wrap</label>
          <label class="settings-field"><input type="checkbox" checked/> Minimap</label>`;
        break;
      case 'assistant':
        page.innerHTML = `<h2>Omni the Presence</h2>
          <p class="settings-hint">Omni is a separate entity from the coding chat — watching, joking, commenting. MiniMax powers his voice &amp; chat. NVIDIA can tag moods when available.</p>
          <label class="settings-field"><input type="checkbox" id="set-omni-show" checked/> Show Omni window</label>
          <label class="settings-field"><input type="checkbox" id="set-omni-speak" checked/> Speak replies (TTS)</label>
          <label class="settings-field"><input type="checkbox" id="set-omni-volunteer" checked/> Occasional volunteer remarks</label>`;
        break;
      case 'notifications':
        page.innerHTML = `<h2>Notifications</h2>
          <label class="settings-field"><input type="checkbox"/> Do not disturb</label>
          <label class="settings-field">Default timer (minutes)<input type="number" value="25"/></label>`;
        break;
      case 'shortcuts':
        page.innerHTML = `<h2>Shortcuts</h2>
          <ul class="settings-list">
            <li><kbd>Ctrl+S</kbd> Save file</li>
            <li><kbd>Ctrl+Shift+B</kbd> Brain view</li>
            <li><kbd>Ctrl+Shift+H</kbd> Harness intake</li>
          </ul>`;
        break;
      case 'about':
        page.innerHTML = `<h2>About</h2>
          <p><strong>OMNI-CODE</strong> v1.1.0</p>
          <p class="settings-hint">Go Gateway → Rust core → native WebView2. No Electron.</p>
          <p class="settings-hint">Install: %USERPROFILE%\\.omni-neural-ide</p>`;
        break;
    }
  }

  private async paintProviders(page: Element) {
    page.innerHTML = `<h2>Providers</h2>
      <p class="settings-hint">API keys stay on this machine under keys\\providers.json. Changes apply without relaunch.</p>
      <div class="settings-providers">
        <div class="settings-role">
          <h3>MiniMax <span class="role-pill">Main brain</span></h3>
          <p class="settings-hint">Powers Omni the Presence, the coding chat, and concurrent agents.</p>
          <label class="settings-field">MiniMax API key
            <div class="settings-secret">
              <input id="set-minimax" type="password" autocomplete="off" spellcheck="false"/>
              <button type="button" id="tog-minimax" class="settings-btn ghost">Show</button>
            </div>
          </label>
          <label class="settings-field">Concurrent agents (pool)
            <select id="set-max-agents">
              <option value="3">3 (default)</option>
              <option value="4">4 (max)</option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
          </label>
        </div>
        <div class="settings-role">
          <h3>NVIDIA <span class="role-pill side">Embeddings &amp; side tasks</span></h3>
          <p class="settings-hint">Indexing, short classify/summarize, mood tags. Optional — skipped if no key.</p>
          <label class="settings-field">NVIDIA API key
            <div class="settings-secret">
              <input id="set-nvidia" type="password" autocomplete="off" spellcheck="false"/>
              <button type="button" id="tog-nvidia" class="settings-btn ghost">Show</button>
            </div>
          </label>
          <label class="settings-field">Embedding model
            <select id="set-embed-model">
              <option>nvidia/nv-embedqa-e5-v5</option>
              <option>nvidia/llama-3.2-nv-embedqa-1b-v2</option>
            </select>
          </label>
          <label class="settings-field">Small-task model
            <select id="set-side-model">
              <option>nvidia/nemotron-mini-4b-instruct</option>
              <option>nvidia/nemotron-3-nano-3b-instruct</option>
            </select>
          </label>
        </div>
        <div class="settings-actions">
          <button class="settings-btn primary" id="save-providers">Save</button>
          <span id="providers-status" class="settings-status"></span>
        </div>
      </div>`;

    try {
      const keys = await api.getKeys();
      const mm = page.querySelector('#set-minimax') as HTMLInputElement;
      const nv = page.querySelector('#set-nvidia') as HTMLInputElement;
      if (mm) mm.value = keys.minimax || '';
      if (nv) nv.value = keys.nvidia || '';
      const max = page.querySelector('#set-max-agents') as HTMLSelectElement;
      if (max && keys.maxAgents) max.value = String(keys.maxAgents);
      const emb = page.querySelector('#set-embed-model') as HTMLSelectElement;
      if (emb && keys.nvidiaEmbedModel) emb.value = keys.nvidiaEmbedModel;
      const side = page.querySelector('#set-side-model') as HTMLSelectElement;
      if (side && keys.nvidiaSideModel) side.value = keys.nvidiaSideModel;
    } catch {
      /* offline / demo */
    }

    const bindToggle = (btnId: string, inputId: string, flag: 'mm' | 'nv') => {
      page.querySelector(btnId)?.addEventListener('click', () => {
        const input = page.querySelector(inputId) as HTMLInputElement;
        const btn = page.querySelector(btnId) as HTMLButtonElement;
        if (flag === 'mm') this.showMinimax = !this.showMinimax;
        else this.showNvidia = !this.showNvidia;
        const show = flag === 'mm' ? this.showMinimax : this.showNvidia;
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
      });
    };
    bindToggle('#tog-minimax', '#set-minimax', 'mm');
    bindToggle('#tog-nvidia', '#set-nvidia', 'nv');

    page.querySelector('#save-providers')?.addEventListener('click', async () => {
      const minimax = (page.querySelector('#set-minimax') as HTMLInputElement).value.trim();
      const nvidia = (page.querySelector('#set-nvidia') as HTMLInputElement).value.trim();
      const max_agents = Number((page.querySelector('#set-max-agents') as HTMLSelectElement).value);
      const nvidia_embed_model = (page.querySelector('#set-embed-model') as HTMLSelectElement).value;
      const nvidia_side_model = (page.querySelector('#set-side-model') as HTMLSelectElement).value;
      const status = page.querySelector('#providers-status')!;
      try {
        await api.setKeys({ minimax, nvidia, max_agents, nvidia_embed_model, nvidia_side_model });
        status.textContent = 'Saved';
        status.className = 'settings-status ok';
      } catch (e: any) {
        status.textContent = e.message || 'Save failed';
        status.className = 'settings-status err';
      }
    });
  }
}
