import { MemoryStore } from './memory-store.js';
import { HttpStore } from './http-store.js';

/**
 * kind = 'memory' -> sessions inside this process   (stateful server)
 * kind = 'http'   -> built-in shared store process  (stateless server)
 * kind = 'redis'  -> Redis                          (stateless server)
 */
export async function createStore(kind, url) {
  switch (kind) {
    case 'memory':
      return new MemoryStore();
    case 'http':
      return new HttpStore(url);
    case 'redis': {
      const { RedisStore } = await import('./redis-store.js');
      return RedisStore.connect(url);
    }
    default:
      throw new Error(`Unknown store kind: ${kind}`);
  }
}
