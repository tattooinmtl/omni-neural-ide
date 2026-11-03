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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
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
  getKeys: () => req<{ minimax: string; nvidia: string; hasMinimax: boolean; hasNvidia: boolean }>('/api/keys'),
  setKeys: (minimax?: string, nvidia?: string) =>
    req<{ ok: boolean }>('/api/keys', { method: 'POST', body: JSON.stringify({ minimax, nvidia }) }),
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
