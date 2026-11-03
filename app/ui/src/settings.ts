import { api } from './api';
import { VOICE_IDS, autoConfigureOmni,
  defaultOmniConfig,
  deleteUserPreset,
  listUserPresets,
  loadOmniConfig,
  PERSONALITY_PRESETS,
  saveOmniConfig,
  saveUserPreset,
  type OmniConfig, } from './omni-config';
import { poolStats } from './jokes';

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
    document.getElementById('assistant-root')?.classList.add('assistant-tucked');
    const v = new SettingsView(el);
    v.render();
    return v;
  }

  private constructor(root: HTMLElement) {
    this.root = root;
  }

  close() {
    this.root.remove();
    document.getElementById('assistant-root')?.classList.remove('assistant-tucked');
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
        this.paintOmniPresence(page);
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
          <p><strong>OMNI-CODE</strong> v1.3.0</p>
          <p class="settings-hint">Go Gateway → Rust core → native WebView2. No Electron.</p>
          <p class="settings-hint">Install: %USERPROFILE%\.omni-neural-ide</p>
          <div class="settings-field" style="margin-top:12px">
            <button type="button" class="primary" id="btn-check-updates">Check for updates</button>
            <p class="settings-hint" id="update-status">In-app updates — no setup.exe needed.</p>
          </div>`;
        page.querySelector('#btn-check-updates')?.addEventListener('click', async () => {
          const stEl = page.querySelector('#update-status') as HTMLElement;
          stEl.textContent = 'Checking…';
          try {
            const { api } = await import('./api');
            const r = await api.updateCheck();
            if (!r.available) { stEl.textContent = `You're on ${r.current}` + (r.latest ? ` (latest ${r.latest})` : ''); return; }
            stEl.textContent = `Update ${r.latest} available.`;
            if (confirm(`Update to ${r.latest}? App will restart.`)) {
              const mode = new URLSearchParams(location.search).get('mode') || 'plain';
              const a = await api.updateApply(mode);
              stEl.textContent = a.message;
            }
          } catch (e: any) { stEl.textContent = e?.message || 'Check failed'; }
        });
        break;
    }
  }


  private paintOmniPresence(page: Element) {
    const cfg = loadOmniConfig();
    const stats = poolStats();
    const presetOpts = (Object.keys(PERSONALITY_PRESETS) as (keyof typeof PERSONALITY_PRESETS)[])
      .map((k) => `<option value="${k}" ${cfg.preset===k?'selected':''}>${PERSONALITY_PRESETS[k].label}</option>`)
      .join('') + `<option value="custom" ${cfg.preset==='custom'?'selected':''}>Custom</option>`;
    const userPresets = listUserPresets();
    page.innerHTML = `
      <h2>Omni the Presence</h2>
      <p class="settings-hint">Separate from the coding chat. MiniMax voice &amp; brain; NVIDIA mood tags when available. Line pool: ${stats.total} phrases.</p>

      <details class="omni-group" open>
        <summary>Avatar &amp; voice</summary>
        <div class="omni-group-body">
          <div class="avatar-pick">
            <button type="button" id="avatar-female" class="${(cfg.avatar||'female')==='female'?'active':''}">Female</button>
            <button type="button" id="avatar-male" class="${cfg.avatar==='male'?'active':''}">Male</button>
          </div>
          <p class="settings-hint">Switches face + voice together (MiniMax TTS; speechSynthesis fallback matches gender).</p>
          <label class="settings-field">Face mode
            <select id="omni-face-mode">
              <option value="digital" ${(cfg.faceMode||'digital')==='digital'?'selected':''}>Digital (LED eyes + waveform mouth)</option>
              <option value="classic" ${cfg.faceMode==='classic'?'selected':''}>Classic portrait</option>
            </select>
          </label>
          <label class="settings-field">Effect intensity
            <input type="range" id="omni-fx-intensity" min="0.2" max="1" step="0.05" value="${cfg.effectIntensity??0.85}"/>
          </label>
          <label class="settings-field">Pixel size
            <input type="range" id="omni-pixel-size" min="1" max="6" step="1" value="${cfg.pixelSize??2}"/>
          </label>
          <label class="settings-field">Custom eye color (optional)
            <input type="color" id="omni-eye-color" value="${cfg.eyeColorOverride||'#50dcff'}"/>
            <button type="button" id="omni-eye-clear">Clear override</button>
          </label>
        </div>
      </details>

      <details class="omni-group" open>
        <summary>Presence</summary>
        <div class="omni-group-body">
          <label class="settings-field row"><input type="checkbox" id="omni-show" ${cfg.show?'checked':''}/> Show Omni window</label>
          <label class="settings-field row"><input type="checkbox" id="omni-speak" ${cfg.speak?'checked':''}/> Speak replies (TTS)</label>
          <label class="settings-field row"><input type="checkbox" id="omni-volunteer" ${cfg.volunteer?'checked':''}/> Occasional volunteer remarks</label>
          <label class="settings-field row"><input type="checkbox" id="omni-autoupdate" ${cfg.autoCheckUpdates?'checked':''}/> Auto-check updates on start</label>
        </div>
      </details>

      <details class="omni-group" open>
        <summary>Intelligence &amp; depth</summary>
        <div class="omni-group-body">
          <p class="settings-hint">Controls MiniMax calls for Omni only. Coding chat has its own path.</p>
          <label class="settings-field">Reasoning depth
            <select id="omni-depth">
              ${['off','low','medium','high'].map(v=>`<option value="${v}" ${cfg.reasoningDepth===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="settings-field">Response length
            <select id="omni-len">
              ${['short','medium','long'].map(v=>`<option value="${v}" ${cfg.responseLength===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="settings-field">Max tokens <input id="omni-tokens" type="number" min="64" max="2048" value="${cfg.maxTokens}"/></label>
          <label class="settings-field">Temperature <input id="omni-temp" type="number" min="0" max="1.5" step="0.05" value="${cfg.temperature}"/></label>
          <label class="settings-field">Context / cache
            <select id="omni-ctx">
              ${['minimal','normal','deep'].map(v=>`<option value="${v}" ${cfg.contextAmount===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="settings-field">Timeout (ms) <input id="omni-timeout" type="number" min="5000" max="60000" step="1000" value="${cfg.timeoutMs}"/></label>
          <label class="settings-field">Speech speed <input id="omni-speed" type="number" min="0.7" max="1.4" step="0.05" value="${cfg.speechSpeed}"/></label>
          <label class="settings-field">Voice
            <select id="omni-voice">
              <option value="male-qn-qingse" ${cfg.voiceId==='male-qn-qingse'?'selected':''}>Qingse (default)</option>
              <option value="male-qn-jingying" ${cfg.voiceId==='male-qn-jingying'?'selected':''}>Jingying</option>
              <option value="female-shaonv" ${cfg.voiceId==='female-shaonv'?'selected':''}>Shaonv</option>
              <option value="presenter_male" ${cfg.voiceId==='presenter_male'?'selected':''}>Presenter</option>
            </select>
          </label>
          <button type="button" class="settings-btn primary" id="omni-auto">Auto-configure</button>
          <span id="omni-auto-status" class="settings-status"></span>
        </div>
      </details>

      <details class="omni-group" open>
        <summary>Personality</summary>
        <div class="omni-group-body">
          <label class="settings-field">Preset
            <select id="omni-preset">${presetOpts}</select>
          </label>
          <p class="settings-hint" id="omni-preset-preview"></p>
          <label class="settings-field">Tone (soft → sharp) <input id="omni-tone" type="range" min="0" max="1" step="0.05" value="${cfg.tone}"/></label>
          <label class="settings-field">Humor <input id="omni-humor" type="range" min="0" max="1" step="0.05" value="${cfg.humor}"/></label>
          <label class="settings-field">Chattiness <input id="omni-chatty" type="range" min="0" max="1" step="0.05" value="${cfg.chattiness}"/></label>
          <label class="settings-field">Encouragement <input id="omni-enc" type="range" min="0" max="1" step="0.05" value="${cfg.encouragement}"/></label>
          <label class="settings-field">Formality <input id="omni-form" type="range" min="0" max="1" step="0.05" value="${cfg.formality}"/></label>
          <label class="settings-field">Language <input id="omni-lang" type="text" value="${cfg.language}"/></label>
          <label class="settings-field">Custom personality
            <textarea id="omni-custom" rows="4">${cfg.customPersonality.replace(/</g,'&lt;')}</textarea>
          </label>
        </div>
      </details>

      <details class="omni-group">
        <summary>Rhythm (when Omni speaks up)</summary>
        <div class="omni-group-body">
          <p class="settings-hint">Uses typing, builds, errors, git, session length, CPU, battery, and OS idle.</p>
          <label class="settings-field row"><input type="checkbox" id="omni-rhythm" ${cfg.rhythm.enabled?'checked':''}/> Enable rhythm</label>
          <label class="settings-field row"><input type="checkbox" id="omni-dnd" ${cfg.rhythm.dnd?'checked':''}/> Do not disturb</label>
          <label class="settings-field">Quiet hours start (0–23) <input id="omni-qh-s" type="number" min="0" max="23" value="${cfg.rhythm.quietHoursStart}"/></label>
          <label class="settings-field">Quiet hours end <input id="omni-qh-e" type="number" min="0" max="23" value="${cfg.rhythm.quietHoursEnd}"/></label>
          <label class="settings-field">Idle callout after (minutes) <input id="omni-idle" type="number" min="2" max="60" value="${cfg.rhythm.idleMinutes}"/></label>
          <label class="settings-field">Break reminder after (minutes) <input id="omni-break" type="number" min="20" max="180" value="${cfg.rhythm.sessionBreakMinutes}"/></label>
          <label class="settings-field">Typing-burst mute (ms) <input id="omni-burst" type="number" min="500" max="8000" step="100" value="${cfg.rhythm.typingBurstMs}"/></label>
          <label class="settings-field">Cooldown between lines between lines (sec) <input id="omni-cool" type="number" min="30" max="600" value="${cfg.rhythm.cooldownSec}"/></label>
          <label class="settings-field">Frustration error threshold <input id="omni-frust" type="number" min="2" max="10" value="${cfg.rhythm.frustrationErrors}"/></label>
        </div>
      </details>

      <details class="omni-group">
        <summary>Presets &amp; reset</summary>
        <div class="omni-group-body">
          <div class="settings-actions">
            <input id="omni-preset-name" placeholder="Preset name" style="flex:1;background:#061018;border:1px solid #1e2e3e;border-radius:6px;padding:8px;color:#e8eef4"/>
            <button type="button" class="settings-btn" id="omni-save-preset">Save preset</button>
          </div>
          <label class="settings-field">Load preset
            <select id="omni-load-preset">
              <option value="">—</option>
              ${userPresets.map(p=>`<option value="${p.name}">${p.name}</option>`).join('')}
            </select>
          </label>
          <div class="settings-actions">
            <button type="button" class="settings-btn" id="omni-load-btn">Load</button>
            <button type="button" class="settings-btn" id="omni-del-btn">Delete preset</button>
            <button type="button" class="settings-btn" id="omni-reset" style="border-color:#7f1d1d;color:#f87171">Reset to default</button>
          </div>
        </div>
      </details>

      <div class="settings-actions" style="margin-top:16px">
        <button type="button" class="settings-btn primary" id="omni-save">Save Omni settings</button>
        <span id="omni-save-status" class="settings-status"></span>
      </div>`;

    const preview = () => {
      const sel = (page.querySelector('#omni-preset') as HTMLSelectElement).value;
      const el = page.querySelector('#omni-preset-preview');
      if (!el) return;
      if (sel === 'custom') el.textContent = 'Uses the custom personality text below.';
      else el.textContent = PERSONALITY_PRESETS[sel as keyof typeof PERSONALITY_PRESETS]?.preview || '';
    };
    preview();
    page.querySelector('#omni-preset')?.addEventListener('change', () => {
      preview();
      const sel = (page.querySelector('#omni-preset') as HTMLSelectElement).value;
      if (sel !== 'custom' && PERSONALITY_PRESETS[sel as keyof typeof PERSONALITY_PRESETS]) {
        (page.querySelector('#omni-custom') as HTMLTextAreaElement).value =
          PERSONALITY_PRESETS[sel as keyof typeof PERSONALITY_PRESETS].text;
      }
    });

    const readCfg = (): OmniConfig => {
      const c = loadOmniConfig();
      c.show = (page.querySelector('#omni-show') as HTMLInputElement).checked;
      c.speak = (page.querySelector('#omni-speak') as HTMLInputElement).checked;
      c.volunteer = (page.querySelector('#omni-volunteer') as HTMLInputElement).checked;
      c.reasoningDepth = (page.querySelector('#omni-depth') as HTMLSelectElement).value as any;
      c.responseLength = (page.querySelector('#omni-len') as HTMLSelectElement).value as any;
      c.maxTokens = Number((page.querySelector('#omni-tokens') as HTMLInputElement).value);
      c.temperature = Number((page.querySelector('#omni-temp') as HTMLInputElement).value);
      c.contextAmount = (page.querySelector('#omni-ctx') as HTMLSelectElement).value as any;
      c.timeoutMs = Number((page.querySelector('#omni-timeout') as HTMLInputElement).value);
      c.speechSpeed = Number((page.querySelector('#omni-speed') as HTMLInputElement).value);
      c.voiceId = (page.querySelector('#omni-voice') as HTMLSelectElement).value;
      c.preset = (page.querySelector('#omni-preset') as HTMLSelectElement).value as any;
      c.tone = Number((page.querySelector('#omni-tone') as HTMLInputElement).value);
      c.humor = Number((page.querySelector('#omni-humor') as HTMLInputElement).value);
      c.chattiness = Number((page.querySelector('#omni-chatty') as HTMLInputElement).value);
      c.encouragement = Number((page.querySelector('#omni-enc') as HTMLInputElement).value);
      c.formality = Number((page.querySelector('#omni-form') as HTMLInputElement).value);
      c.language = (page.querySelector('#omni-lang') as HTMLInputElement).value || 'en';
      c.customPersonality = (page.querySelector('#omni-custom') as HTMLTextAreaElement).value;
      c.rhythm.enabled = (page.querySelector('#omni-rhythm') as HTMLInputElement).checked;
      c.rhythm.dnd = (page.querySelector('#omni-dnd') as HTMLInputElement).checked;
      c.rhythm.quietHoursStart = Number((page.querySelector('#omni-qh-s') as HTMLInputElement).value);
      c.rhythm.quietHoursEnd = Number((page.querySelector('#omni-qh-e') as HTMLInputElement).value);
      c.rhythm.idleMinutes = Number((page.querySelector('#omni-idle') as HTMLInputElement).value);
      c.rhythm.sessionBreakMinutes = Number((page.querySelector('#omni-break') as HTMLInputElement).value);
      c.rhythm.typingBurstMs = Number((page.querySelector('#omni-burst') as HTMLInputElement).value);
      c.rhythm.cooldownSec = Number((page.querySelector('#omni-cool') as HTMLInputElement).value);
      c.rhythm.frustrationErrors = Number((page.querySelector('#omni-frust') as HTMLInputElement).value);
      return c;
    };

    page.querySelector('#omni-save')?.addEventListener('click', () => {
      const c = readCfg();
      saveOmniConfig(c);
      (window as any).__omniReloadConfig?.();
      const st = page.querySelector('#omni-save-status')!;
      st.textContent = 'Saved';
      st.className = 'settings-status ok';
    });
    page.querySelector('#omni-auto')?.addEventListener('click', async () => {
      const st = page.querySelector('#omni-auto-status')!;
      st.textContent = 'Measuring…';
      const t0 = performance.now();
      let has = false;
      try {
        const k = await api.getKeys();
        has = !!(k.hasMinimax || k.minimax);
        await api.health();
      } catch {}
      const latency = performance.now() - t0;
      const next = await autoConfigureOmni(has, latency);
      saveOmniConfig(next);
      st.textContent = `Applied ${latency < 400 ? 'deep' : latency < 1200 ? 'balanced' : 'fast'} profile (${Math.round(latency)}ms)`;
      st.className = 'settings-status ok';
      this.paintOmniPresence(page);
    });
    page.querySelector('#omni-save-preset')?.addEventListener('click', () => {
      const name = (page.querySelector('#omni-preset-name') as HTMLInputElement).value.trim();
      if (!name) return;
      saveUserPreset(name, readCfg());
      this.paintOmniPresence(page);
    });
    page.querySelector('#omni-load-btn')?.addEventListener('click', () => {
      const name = (page.querySelector('#omni-load-preset') as HTMLSelectElement).value;
      const hit = listUserPresets().find((p) => p.name === name);
      if (!hit) return;
      saveOmniConfig(hit.cfg);
      this.paintOmniPresence(page);
    });
    page.querySelector('#omni-del-btn')?.addEventListener('click', () => {
      const name = (page.querySelector('#omni-load-preset') as HTMLSelectElement).value;
      if (!name) return;
      deleteUserPreset(name);
      this.paintOmniPresence(page);
    });
    page.querySelector('#omni-reset')?.addEventListener('click', () => {
      if (!confirm('Reset Omni the Presence to defaults?')) return;
      saveOmniConfig(defaultOmniConfig());
      this.paintOmniPresence(page);
    });

    
    page.querySelector('#omni-face-mode')?.addEventListener('change', (e) => {
      const cfg = loadOmniConfig();
      cfg.faceMode = (e.target as HTMLSelectElement).value as any;
      saveOmniConfig(cfg);
      (window as any).__omniReloadConfig?.();
    });
    page.querySelector('#omni-fx-intensity')?.addEventListener('input', (e) => {
      const cfg = loadOmniConfig();
      cfg.effectIntensity = Number((e.target as HTMLInputElement).value);
      saveOmniConfig(cfg);
      (window as any).__omniReloadConfig?.();
    });
    page.querySelector('#omni-pixel-size')?.addEventListener('input', (e) => {
      const cfg = loadOmniConfig();
      cfg.pixelSize = Number((e.target as HTMLInputElement).value);
      saveOmniConfig(cfg);
      (window as any).__omniReloadConfig?.();
    });
    page.querySelector('#omni-eye-color')?.addEventListener('input', (e) => {
      const cfg = loadOmniConfig();
      cfg.eyeColorOverride = (e.target as HTMLInputElement).value;
      saveOmniConfig(cfg);
      (window as any).__omniReloadConfig?.();
    });
    page.querySelector('#omni-eye-clear')?.addEventListener('click', () => {
      const cfg = loadOmniConfig();
      cfg.eyeColorOverride = '';
      saveOmniConfig(cfg);
      (window as any).__omniReloadConfig?.();
      this.paintPage('assistant');
    });
page.querySelector('#avatar-female')?.addEventListener('click', () => {
      const cfg = loadOmniConfig(); cfg.avatar='female'; cfg.voiceId=VOICE_IDS.female; saveOmniConfig(cfg);
      (window as any).__omniReloadConfig?.(); this.paintPage('assistant');
    });
    page.querySelector('#avatar-male')?.addEventListener('click', () => {
      const cfg = loadOmniConfig(); cfg.avatar='male'; cfg.voiceId=VOICE_IDS.male; saveOmniConfig(cfg);
      (window as any).__omniReloadConfig?.(); this.paintPage('assistant');
    });
    page.querySelector('#omni-autoupdate')?.addEventListener('change', (e) => {
      const cfg = loadOmniConfig(); cfg.autoCheckUpdates=(e.target as HTMLInputElement).checked; saveOmniConfig(cfg);
    });

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
