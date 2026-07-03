import type { WsClientEvent, WsServerEvent } from '@securechat/types';
import { getAccessToken } from './api';

/**
 * Thin WebSocket client. Authenticates with the in-memory access token via a
 * query param (browsers can't set WS headers), auto-reconnects, and heartbeats.
 */

let socket: WebSocket | null = null;
let handler: (ev: WsServerEvent) => void = () => {};
let shouldRun = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000/ws';

export function onServerEvent(h: (ev: WsServerEvent) => void): void {
  handler = h;
}

export function connectWs(): void {
  shouldRun = true;
  const token = getAccessToken();
  if (!token || socket) return;

  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  socket = ws;

  ws.onopen = () => {
    heartbeat = setInterval(() => sendWs({ type: 'ping' }), 25_000);
  };
  ws.onmessage = (e) => {
    try {
      handler(JSON.parse(e.data as string) as WsServerEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    clearInterval(heartbeat);
    socket = null;
    if (shouldRun) setTimeout(connectWs, 1500); // reconnect with backoff
  };
  ws.onerror = () => ws.close();
}

export function sendWs(ev: WsClientEvent): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(ev));
}

export function disconnectWs(): void {
  shouldRun = false;
  clearInterval(heartbeat);
  socket?.close();
  socket = null;
}
