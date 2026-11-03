const BASE = (window as any).__OMNI_API__ || '';

export type Mode = 'plain' | 'ultra';

export interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: TreeNode[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type ApiErrorKind = 'nokey' | 'offline' | 'auth' | 'rate' | 'server' | 'unknown';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status: number;
  detail: string;
  constructor(kind: ApiErrorKind, human: string, status = 0, detail = '') {
    super(human);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** Never expose HTML / huge bodies to UI. */
export function humanizeApiFailure(status: number, body: string, path: string): ApiError {
  const raw = (body || '').trim();
  const looksHtml = /<!DOCTYPE|<html[\s>]|Unsupported method/i.test(raw);
  const detail = looksHtml
    ? `HTTP ${status} on ${path} (non-JSON/HTML body suppressed)`
    : raw.slice(0, 400);
  const lower = raw.toLowerCase();
  if (status === 401 || /api key not set|unauthorized|minimax key/i.test(raw)) {
    return new ApiError(
      'nokey',
      'I need a MiniMax key — Settings → Providers.',
      status,
      detail
    );
  }
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return new ApiError('offline', "Can't reach my brain right now.", status, detail);
  }
  if (status === 429 || /too many|rate/i.test(lower)) {
    return new ApiError('rate', 'Easy — my brain is rate-limited. Try again in a bit.', status, detail);
  }
  if (status === 501 || looksHtml) {
    return new ApiError('server', "Can't reach my brain right now.", status, detail);
  }
  if (status >= 500) {
    return new ApiError('server', "Can't reach my brain right now.", status, detail);
  }
  return new ApiError('unknown', "Something went sideways — check logs if it keeps up.", status, detail || String(status));
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch (e: any) {
    const err = new ApiError('offline', "Can't reach my brain right now.", 0, String(e?.message || e));
    logClientError(path, err);
    throw err;
  }
  if (!r.ok) {
    const t = await r.text();
    const err = humanizeApiFailure(r.status, t, path);
    logClientError(path, err);
    throw err;
  }
  return r.json();
}

function logClientError(path: string, err: ApiError) {
  try {
    const line = `[${new Date().toISOString()}] ${path} status=${err.status} kind=${err.kind} ${err.detail || err.message}\n`;
    // Best-effort: POST to core log sink if present; also console
    console.warn(line);
    void fetch(`${BASE}/api/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, status: err.status, kind: err.kind, detail: err.detail, message: err.message }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

export const api = {
  health: () => req<{ ok: boolean; mode: Mode }>('/api/health').catch(() => ({ ok: false, mode: 'plain' as Mode })),
  listDir: (path: string) => req<{ entries: TreeNode[] }>(`/api/fs/list?path=${encodeURIComponent(path)}`),
  readFile: (path: string) => req<{ path: string; content: string; language: string }>(`/api/fs/read?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string) =>
    req<{ ok: boolean }>('/api/fs/write', { method: 'POST', body: JSON.stringify({ path, content }) }),
  openFolder: (path: string) =>
    req<{ root: string; tree: TreeNode }>('/api/fs/open', { method: 'POST', body: JSON.stringify({ path }) }),
  tree: () => req<{ root: string | null; tree: TreeNode | null }>('/api/fs/tree'),
  chat: (messages: ChatMessage[], model: string) =>
    req<{ content: string; model: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, model }),
    }),
  slash: (cmd: string, args: string) =>
    req<{ ok: boolean; message: string; data?: unknown }>('/api/slash', {
      method: 'POST',
      body: JSON.stringify({ cmd, args }),
    }),
  config: () => req<{ mode: Mode; projectRoot: string | null; models: string[]; hasMinimax: boolean; hasNvidia: boolean }>('/api/config'),
  getKeys: () => req<any>('/api/keys'),
  setKeys: (body: Record<string, unknown>) =>
    req<{ ok: boolean }>('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
  omniChat: (message: string, opts?: { system?: string; max_tokens?: number; temperature?: number; timeout_ms?: number }) =>
    req<{ content: string; model: string }>('/api/omni/chat', { method: 'POST', body: JSON.stringify({ message, ...opts }) }),
  activity: () => req<{ cpuPct: number; idleSec: number; onBattery: boolean; memPct: number }>('/api/activity'),
  omniVolunteer: (input: string) =>
    req<{ content: string; model: string }>('/api/omni/volunteer', { method: 'POST', body: JSON.stringify({ task: 'volunteer', input }) }),
  embed: (texts: string[]) =>
    req<{ vectors: number[][]; model: string; skipped: boolean }>('/api/embed', { method: 'POST', body: JSON.stringify({ texts }) }),
};

export function langFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', md: 'markdown', json: 'json',
    css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    sh: 'shell', ps1: 'powershell', txt: 'plaintext',
  };
  return map[ext] || 'plaintext';
}
