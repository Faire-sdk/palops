import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface RestCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | undefined;
  reason: string | undefined;
}

/** A stand-in for Discord's REST API that records what it was asked and answers plausibly. */
export async function startFakeRest(token: string) {
  const calls: RestCall[] = [];
  const failing = new Map<string, number>();
  /** Members by "guild/user", so role sync has something to read. */
  const members = new Map<string, { roles: string[]; nick?: string | null }>();
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = req.url ?? '';
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      calls.push({ method: req.method ?? '', path, body, auth: req.headers.authorization, reason: req.headers['x-audit-log-reason'] as string | undefined });
      const send = (status: number, payload: unknown = {}) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
      for (const [prefix, status] of failing) if (path.startsWith(prefix)) return send(status, { message: 'Missing Access' });
      if (!path.startsWith('/webhooks') && !path.startsWith('/interactions') && req.headers.authorization !== `Bot ${token}`) return send(401, { message: '401: Unauthorized' });
      const memberMatch = path.match(/^\/guilds\/(\d+)\/members\/(\d+)(?:\/roles\/(\d+))?$/);
      if (memberMatch) {
        const [, guild, user, role] = memberMatch;
        const key = `${guild}/${user}`;
        if (req.method === 'GET') return members.has(key) ? send(200, { user: { id: user }, roles: members.get(key)!.roles, nick: members.get(key)!.nick ?? null }) : send(404, { message: 'Unknown Member' });
        if (req.method === 'PUT' && !role) {
          members.set(key, { roles: (body?.roles as string[]) ?? [], nick: (body?.nick as string) ?? null });
          return send(201, { user: { id: user } });
        }
        if (req.method === 'PUT' && role) {
          const m = members.get(key);
          if (!m) return send(404, { message: 'Unknown Member' });
          if (!m.roles.includes(role)) m.roles.push(role);
          return send(204);
        }
        if (req.method === 'DELETE' && role) {
          const m = members.get(key);
          if (m) m.roles = m.roles.filter((r) => r !== role);
          return send(204);
        }
        if (req.method === 'PATCH') {
          const m = members.get(key);
          if (!m) return send(404, { message: 'Unknown Member' });
          if ('nick' in (body ?? {})) m.nick = body!.nick as string;
          return send(200, {});
        }
      }
      if (path === '/users/@me') return send(200, { id: '999', username: 'PalOpsBot' });
      if (path.startsWith('/guilds/') && !path.includes('/bans') && !path.includes('/members')) return send(200, { id: path.split('/')[2], name: 'Palworld Friends' });
      if (path.startsWith('/channels/') && req.method === 'GET') return send(200, { id: path.split('/')[2], name: 'palworld' });
      if (path.startsWith('/channels/') && req.method === 'PATCH') return send(200, {});
      if (path.includes('/messages')) return send(200, { id: '1' });
      if (path.includes('/commands')) return send(200, []);
      if (path.includes('/bans')) return send(req.method === 'GET' ? 404 : 204);
      if (path.startsWith('/interactions')) return send(204);
      return send(404, { message: 'Unknown' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, failing, members, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export interface Frame {
  op: number;
  d?: any;
  s?: number | null;
  t?: string | null;
}

/** A stand-in for Discord's gateway: says hello, accepts IDENTIFY/RESUME, acknowledges heartbeats. */
export async function startFakeGateway(options: { heartbeatMs?: number; ack?: boolean; port?: number } = {}) {
  const frames: Frame[] = [];
  const sockets = new Set<WebSocket>();
  let seq = 0;
  let ack = options.ack ?? true;
  const wss = new WebSocketServer({ host: '127.0.0.1', port: options.port ?? 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const port = (wss.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}`;

  const dispatch = (socket: WebSocket, t: string, d: unknown) => socket.send(JSON.stringify({ op: 0, t, s: ++seq, d }));
  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: options.heartbeatMs ?? 200 } }));
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      frames.push(frame);
      if (frame.op === 1 && ack) socket.send(JSON.stringify({ op: 11 }));
      if (frame.op === 2) dispatch(socket, 'READY', { session_id: 'session-1', resume_gateway_url: url, user: { id: '999' } });
      if (frame.op === 6) dispatch(socket, 'RESUMED', {});
    });
  });

  return {
    url,
    port,
    frames,
    ofOp: (op: number) => frames.filter((f) => f.op === op),
    /** Presence updates the bot has sent, oldest first (IDENTIFY's presence counts as the first). */
    presences: () => frames.flatMap((f) => (f.op === 2 ? [f.d.presence] : f.op === 3 ? [f.d] : [])),
    dispatchAll: (t: string, d: unknown) => {
      for (const s of sockets) dispatch(s, t, d);
    },
    sendAll: (frame: Frame) => {
      for (const s of sockets) s.send(JSON.stringify(frame));
    },
    closeAll: (code: number) => {
      for (const s of sockets) s.close(code);
    },
    dropAll: () => {
      for (const s of sockets) s.terminate();
    },
    setAck: (value: boolean) => (ack = value),
    connections: () => sockets.size,
    close: async () => {
      for (const s of sockets) s.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
