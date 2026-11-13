// A tiny stand-in for Redis, so the demo runs without installing anything.
//
// It is its own process. App servers reach it over the network, the same
// way they would reach Redis or a database. Set REDIS_URL to use real Redis
// instead.
//
//   GET    /sessions        -> all sessions (for the dashboard)
//   GET    /sessions/:id    -> one session, or 404
//   PUT    /sessions/:id    -> store a session
//   DELETE /sessions        -> remove everything
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 0);
const sessions = new Map();

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const match = pathname.match(/^\/sessions(?:\/([^/]+))?$/);
  if (!match) return send(res, 404, { error: 'Not found' });

  const id = match[1] && decodeURIComponent(match[1]);

  if (!id && req.method === 'GET') {
    return send(res, 200, [...sessions].map(([key, value]) => ({ id: key, ...value })));
  }
  if (!id && req.method === 'DELETE') {
    sessions.clear();
    return send(res, 204);
  }
  if (id && req.method === 'GET') {
    return sessions.has(id) ? send(res, 200, sessions.get(id)) : send(res, 404, { error: 'No such session' });
  }
  if (id && req.method === 'PUT') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      sessions.set(id, JSON.parse(raw));
    } catch {
      return send(res, 400, { error: 'Body must be JSON' });
    }
    return send(res, 204);
  }
  send(res, 405, { error: 'Method not allowed' });
});

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

server.listen(PORT, '127.0.0.1', () => {
  process.send?.({ type: 'ready', port: server.address().port });
});

process.on('disconnect', () => process.exit(0));
