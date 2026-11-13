// A cluster = one load balancer + N app server processes.
import { fileURLToPath } from 'node:url';
import { createLoadBalancer } from './load-balancer.js';
import { startProcess, stopProcess } from './processes.js';

const APP_SERVER = fileURLToPath(new URL('./app-server.js', import.meta.url));

/**
 * @param {object} options
 * @param {string} options.id         'stateful' or 'stateless'
 * @param {object} options.storeEnv   STORE / STORE_URL passed to every server
 * @param {(msg: string) => void} [options.log]
 */
export function createCluster({ id, storeEnv, log = () => {} }) {
  const lb = createLoadBalancer({ log: (msg) => log(`[${id} LB] ${msg}`) });
  const servers = new Map(); // name -> { name, port, child }
  let created = 0;

  async function addServer() {
    const name = serverName(created++);
    const { child, port } = await startProcess(
      APP_SERVER,
      { SERVER_NAME: name, PORT: '0', ...storeEnv },
      `${id} server ${name}`,
    );
    servers.set(name, { name, port, child });
    // Starting it is step one. Step two: tell the load balancer about it.
    lb.add({ name, host: '127.0.0.1', port });
    log(`[${id}] server ${name} started (pid ${child.pid}, port ${port})`);
    return { name, port };
  }

  async function removeServer(name) {
    const server = servers.get(name);
    if (!server) return false;
    lb.remove(name);
    servers.delete(name);
    await stopProcess(server.child);
    log(`[${id}] server ${name} stopped`);
    return true;
  }

  /** What every server currently remembers, read directly (not through the LB). */
  async function status() {
    return Promise.all(
      [...servers.values()].map(async ({ name, port }) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/internal/state`);
          return { ...(await res.json()), port };
        } catch {
          return { server: name, port, down: true, sessions: [] };
        }
      }),
    );
  }

  /** Kill every server and start fresh ones. Whatever they had in memory is gone. */
  async function reset(count) {
    await stop();
    lb.clear();
    created = 0;
    for (let i = 0; i < count; i++) await addServer();
  }

  async function stop() {
    await Promise.all([...servers.keys()].map(removeServer));
  }

  return { id, lb, addServer, removeServer, status, reset, stop };
}

function serverName(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `S${index + 1}`;
}
