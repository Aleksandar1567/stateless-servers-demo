// Sessions kept in Redis, shared by every app server.
//
// Loaded only when REDIS_URL is set, so the demo also runs without
// installing anything.
import { createClient } from 'redis';

const PREFIX = 'session:';
const TTL_SECONDS = 60 * 60;

export class RedisStore {
  kind = 'shared';
  label = 'Redis';

  static async connect(url) {
    const client = createClient({ url });
    client.on('error', (err) => console.error(`[redis] ${err.message}`));
    await client.connect();
    return new RedisStore(client);
  }

  constructor(client) {
    this.client = client;
  }

  async get(id) {
    const raw = await this.client.get(PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  }

  async set(id, session) {
    await this.client.set(PREFIX + id, JSON.stringify(session), { EX: TTL_SECONDS });
  }

  // Used only by the dashboard to draw what is inside Redis.
  // KEYS is fine for a demo; use SCAN on a real, large Redis.
  async entries() {
    const keys = await this.client.keys(PREFIX + '*');
    if (keys.length === 0) return [];
    const values = await this.client.mGet(keys);
    return keys
      .map((key, i) => values[i] && { id: key.slice(PREFIX.length), ...JSON.parse(values[i]) })
      .filter(Boolean);
  }

  async clear() {
    const keys = await this.client.keys(PREFIX + '*');
    if (keys.length > 0) await this.client.del(keys);
  }

  async close() {
    await this.client.quit();
  }
}
