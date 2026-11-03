function humanizeApiFailure(status, body, path) {
  const raw = (body || '').trim();
  const looksHtml = /<!DOCTYPE|<html[\s>]|Unsupported method/i.test(raw);
  const detail = looksHtml ? `HTTP ${status} on ${path} (non-JSON/HTML body suppressed)` : raw.slice(0, 400);
  if (status === 401 || /api key not set|unauthorized|minimax key/i.test(raw)) {
    return { kind: 'nokey', message: 'I need a MiniMax key — Settings → Providers.', detail };
  }
  if (status === 501 || looksHtml || status >= 500) {
    return { kind: 'server', message: "Can't reach my brain right now.", detail };
  }
  return { kind: 'unknown', message: 'Something went sideways', detail };
}
const html = `<!DOCTYPE HTML>\n<html><body>Error code: 501 Unsupported method ('POST')</body></html>`;
const r = humanizeApiFailure(501, html, '/api/omni/chat');
if (r.message.includes('<!') || r.message.includes('DOCTYPE')) throw new Error('leaked html');
if (r.message !== "Can't reach my brain right now.") throw new Error(r.message);
const k = humanizeApiFailure(401, 'MiniMax API key not set', '/api/omni/chat');
if (!/MiniMax key/.test(k.message)) throw new Error(k.message);
console.log('api-error-tests OK');
