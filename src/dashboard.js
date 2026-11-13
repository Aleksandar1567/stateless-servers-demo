// The web dashboard on :3000. Not part of the "system" being demonstrated;
// it is the window you look through.
//
//   GET  /                              the UI
//   ANY  /stateful/api/*                forwarded to the stateful cluster's load balancer
//   ANY  /stateless/api/*               forwarded to the stateless cluster's load balancer
//   GET  /admin/status                  what every server and the shared store hold
//   POST /admin/:cluster/servers        start one more server
//   DELETE /admin/:cluster/servers/:n   stop server n
//   POST /admin/reset                   restart everything with empty memory
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const INDEX_HTML = new URL('../public/index.html', import.meta.url);
const MAX_SERVERS = 8;

export function createDashboard({ clusters, sharedStore, lbUrls, serversPerCluster }) {
  return http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
    }
  });

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const [, first, ...rest] = url.pathname.split('/');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await readFile(INDEX_HTML));
    }

    if (Object.hasOwn(clusters, first) && rest[0] === 'api') {
      return clusters[first].lb.handle(req, res, `/${rest.join('/')}${url.search}`);
    }

    if (first !== 'admin') return sendJson(res, 404, { error: 'Not found' });

    const [action, ...args] = rest;

    if (req.method === 'GET' && action === 'status') {
      const [stateful, stateless, sessions] = await Promise.all([
        clusters.stateful.status(),
        clusters.stateless.status(),
        sharedStore.entries(),
      ]);
      return sendJson(res, 200, {
        stateful: { url: lbUrls.stateful, servers: stateful },
        stateless: { url: lbUrls.stateless, servers: stateless },
        sharedStore: { label: sharedStore.label, sessions },
      });
    }

    if (req.method === 'POST' && action === 'reset') {
      await Promise.all([
        clusters.stateful.reset(serversPerCluster),
        clusters.stateless.reset(serversPerCluster),
        sharedStore.clear(),
      ]);
      // Forget the browser's session id too, so it starts as a new visitor.
      res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      return sendJson(res, 200, { ok: true });
    }

    if (Object.hasOwn(clusters, action) && args[0] === 'servers') {
      const cluster = clusters[action];
      if (req.method === 'POST' && args.length === 1) {
        if (cluster.lb.backends.length >= MAX_SERVERS) {
          return sendJson(res, 400, { error: `This demo stops at ${MAX_SERVERS} servers per cluster` });
        }
        return sendJson(res, 201, await cluster.addServer());
      }
      if (req.method === 'DELETE' && args.length === 2) {
        const removed = await cluster.removeServer(decodeURIComponent(args[1]));
        return sendJson(res, removed ? 200 : 404, { removed });
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
