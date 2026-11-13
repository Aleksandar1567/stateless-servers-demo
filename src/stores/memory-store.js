// Sessions kept in this process's own memory.
//
// This is what makes a server STATEFUL: the data lives inside one server,
// so only that server can see it. Another server (another process) has its
// own, separate Map, and a restart wipes it.
export class MemoryStore {
  kind = 'memory';
  label = "this server's memory";
  #sessions = new Map();

  async get(id) {
    const session = this.#sessions.get(id);
    return session ? structuredClone(session) : null;
  }

  async set(id, session) {
    this.#sessions.set(id, structuredClone(session));
  }

  async entries() {
    return [...this.#sessions].map(([id, session]) => ({ id, ...session }));
  }

  async clear() {
    this.#sessions.clear();
  }
}
