import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startDemo } from '../src/index.js';

let demo;

before(async () => {
  demo = await startDemo({ dashboardPort: 0, statefulPort: 0, statelessPort: 0, verbose: false });
});

after(async () => {
  await demo?.stop();
});

/** Keeps the session cookie between requests, like a browser. */
function browser(baseUrl) {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { ...(cookie && { cookie }), ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, ...(await res.json()) };
  };
}

describe('stateful cluster (sessions in server memory)', () => {
  test('the cart disappears when the next request lands on another server', async () => {
    const request = browser(demo.urls.stateful);

    const added = await request('POST', '/api/cart', { item: 'phone' });
    const next = await request('GET', '/api/cart');

    assert.notEqual(added.servedBy, next.servedBy, 'round robin should pick a different server');
    assert.deepEqual(added.cart, ['phone']);
    assert.deepEqual(next.cart, [], 'the other server has no cart for this user');
    assert.equal(next.sessionFound, false);
  });

  test('a login only "exists" on the server that handled it', async () => {
    const request = browser(demo.urls.stateful);

    const login = await request('POST', '/api/login', { name: 'Ana' });
    const seen = [];
    for (let i = 0; i < 3; i++) seen.push((await request('GET', '/api/cart')).user);

    assert.equal(login.user, 'Ana');
    assert.ok(seen.includes(null), `expected some server to not know the user, got ${JSON.stringify(seen)}`);
  });
});

describe('stateless cluster (sessions in the shared store)', () => {
  test('every server returns the same cart', async () => {
    const request = browser(demo.urls.stateless);

    await request('POST', '/api/login', { name: 'Ana' });
    await request('POST', '/api/cart', { item: 'phone' });
    await request('POST', '/api/cart', { item: 'laptop' });

    const servers = new Set();
    for (let i = 0; i < 6; i++) {
      const res = await request('GET', '/api/cart');
      servers.add(res.servedBy);
      assert.equal(res.user, 'Ana');
      assert.deepEqual(res.cart, ['phone', 'laptop']);
    }
    assert.equal(servers.size, 3, 'requests should have been spread over all 3 servers');
  });

  test('servers keep no user data in their own memory', async () => {
    const servers = await demo.clusters.stateless.status();
    for (const server of servers) assert.deepEqual(server.sessions, []);
  });

  test('a newly added server can serve existing users right away', async () => {
    const request = browser(demo.urls.stateless);
    await request('POST', '/api/cart', { item: 'headphones' });

    const { name } = await demo.clusters.stateless.addServer();
    const servedBy = new Set();
    for (let i = 0; i < 8; i++) {
      const res = await request('GET', '/api/cart');
      servedBy.add(res.servedBy);
      assert.deepEqual(res.cart, ['headphones']);
    }
    assert.ok(servedBy.has(name), `the new server ${name} should have handled some requests`);
  });

  test('stopping a server loses nothing', async () => {
    const request = browser(demo.urls.stateless);
    const first = await request('POST', '/api/cart', { item: 'phone' });

    await demo.clusters.stateless.removeServer(first.servedBy);
    for (let i = 0; i < 4; i++) {
      const res = await request('GET', '/api/cart');
      assert.notEqual(res.servedBy, first.servedBy);
      assert.deepEqual(res.cart, ['phone']);
    }
  });
});

describe('dashboard', () => {
  test('forwards /stateful/api/* and /stateless/api/* to the right cluster', async () => {
    for (const cluster of ['stateful', 'stateless']) {
      const res = await fetch(`${demo.urls.dashboard}/${cluster}/api/cart`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('x-served-by'), /^server-/);
    }
  });

  test('status reports both clusters and the shared store', async () => {
    const res = await fetch(`${demo.urls.dashboard}/admin/status`);
    const status = await res.json();
    assert.ok(status.stateful.servers.length >= 3);
    assert.ok(status.stateless.servers.length >= 1);
    assert.ok(Array.isArray(status.sharedStore.sessions));
  });

  test('rejects unknown routes without crashing', async () => {
    for (const path of ['/constructor/api/x', '/admin/__proto__/servers', '/nope']) {
      const res = await fetch(demo.urls.dashboard + path);
      assert.equal(res.status, 404, path);
    }
  });
});
