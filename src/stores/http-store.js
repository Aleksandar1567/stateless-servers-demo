// Client for the built-in shared store (src/shared-store-server.js).
//
// The sessions live in another process, reached over the network, exactly
// like Redis or a database. The app server keeps nothing itself.
export class HttpStore {
  kind = 'shared';
  label = 'built-in key-value store';

  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async get(id) {
    const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    await ensureOk(res);
    return res.json();
  }

  async set(id, session) {
    const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(session),
    });
    await ensureOk(res);
  }

  async entries() {
    const res = await fetch(`${this.baseUrl}/sessions`);
    await ensureOk(res);
    return res.json();
  }

  async clear() {
    const res = await fetch(`${this.baseUrl}/sessions`, { method: 'DELETE' });
    await ensureOk(res);
  }
}

async function ensureOk(res) {
  if (!res.ok) throw new Error(`Shared store responded ${res.status}: ${await res.text()}`);
}
