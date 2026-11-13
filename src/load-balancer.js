// A minimal round-robin load balancer (reverse proxy).
//
// It knows nothing about users or sessions. It sends request 1 to the first
// server, request 2 to the second, and so on, wrapping around. That is the
// whole point: any request can land on any server.
import http from 'node:http';

export function createLoadBalancer({ log = () => {} } = {}) {
  let backends = []; // [{ name, host, port }]
  let next = 0;

  function pick() {
    if (backends.length === 0) return null;
    const backend = backends[next % backends.length];
    next = (next + 1) % backends.length;
    return backend;
  }

  function handle(req, res, path = req.url) {
    const backend = pick();
    if (!backend) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No servers behind the load balancer' }));
    }

    const upstream = http.request(
      { host: backend.host, port: backend.port, method: req.method, path, headers: req.headers },
      (upstreamRes) => {
        log(`${req.method} ${path} -> server ${backend.name} (${upstreamRes.statusCode})`);
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      log(`${req.method} ${path} -> server ${backend.name} FAILED: ${err.message}`);
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Server ${backend.name} is unreachable` }));
    });
    req.pipe(upstream);
  }

  return {
    handle,

    // "Adding a server is as simple as starting it and adding it to the load balancer."
    add(backend) {
      backends.push(backend);
    },

    remove(name) {
      backends = backends.filter((b) => b.name !== name);
    },

    clear() {
      backends = [];
      next = 0;
    },

    get backends() {
      return backends.map((b) => ({ ...b }));
    },

    listen(port, host) {
      const server = http.createServer((req, res) => handle(req, res));
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
      });
    },
  };
}
