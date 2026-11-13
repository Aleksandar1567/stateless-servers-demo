// One app server = one OS process with its own memory.
//
// The cluster starts several copies of this file behind a load balancer.
// Every copy runs the same code. The only thing that differs is STORE:
//
//   STORE=memory        sessions live inside this process   -> STATEFUL
//   STORE=http | redis  sessions live in one shared store   -> STATELESS
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createStore } from './stores/index.js';

const SERVER_NAME = process.env.SERVER_NAME ?? 'A';
const PORT = Number(process.env.PORT ?? 0);

// ─── The line this whole demo is about ──────────────────────────────────────
const sessions = await createStore(process.env.STORE ?? 'memory', process.env.STORE_URL);
// ────────────────────────────────────────────────────────────────────────────

const PRODUCTS = new Set(['phone', 'laptop', 'headphones']);
let requestsHandled = 0;

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    sendJson(res, 500, { servedBy: SERVER_NAME, error: err.message });
  }
});

async function route(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');

  // Not part of the app: lets the dashboard draw what this server remembers.
  if (req.method === 'GET' && pathname === '/internal/state') {
    return sendJson(res, 200, {
      server: SERVER_NAME,
      pid: process.pid,
      storage: sessions.kind,
      requestsHandled,
      // A stateless server has no sessions in its own memory, by design.
      sessions: sessions.kind === 'memory' ? await sessions.entries() : [],
    });
  }

  requestsHandled++;

  // The browser identifies itself with a session id cookie.
  // The cookie is only an id; the session data lives wherever STORE says.
  let sessionId = readCookie(req, 'sid');
  if (!sessionId) {
    sessionId = randomUUID();
    res.setHeader('Set-Cookie', `sid=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  }

  const stored = await sessions.get(sessionId);
  const session = stored ?? { user: null, cart: [] };

  if (req.method === 'GET' && pathname === '/api/cart') {
    // just read
  } else if (req.method === 'POST' && pathname === '/api/cart') {
    const { item } = await readJson(req);
    if (!PRODUCTS.has(item)) return sendJson(res, 400, { servedBy: SERVER_NAME, error: `Unknown item: ${item}` });
    session.cart.push(item);
    await sessions.set(sessionId, session);
  } else if (req.method === 'POST' && pathname === '/api/login') {
    const { name } = await readJson(req);
    const user = String(name ?? '').trim().slice(0, 30);
    if (!user) return sendJson(res, 400, { servedBy: SERVER_NAME, error: 'Name is required' });
    session.user = user;
    await sessions.set(sessionId, session);
  } else {
    return sendJson(res, 404, { servedBy: SERVER_NAME, error: 'Not found' });
  }

  sendJson(res, 200, {
    servedBy: SERVER_NAME,
    sessionId,
    sessionFound: stored !== null,
    user: session.user,
    cart: session.cart,
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-served-by': `server-${SERVER_NAME}` });
  res.end(JSON.stringify(body));
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Body too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

server.listen(PORT, '127.0.0.1', () => {
  process.send?.({ type: 'ready', port: server.address().port });
});

// Exit together with the parent that started us.
process.on('disconnect', () => process.exit(0));
