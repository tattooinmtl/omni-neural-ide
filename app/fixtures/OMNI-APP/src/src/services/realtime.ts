export function connectRealtime(url: string) {
  return new WebSocket(url);
}
