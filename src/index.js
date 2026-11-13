// Starts the whole demo:
//
//   - a shared store (real Redis if REDIS_URL is set, otherwise a tiny built-in one)
//   - a STATEFUL cluster:  load balancer :8080 + servers that keep sessions in memory
//   - a STATELESS cluster: load balancer :8081 + servers that keep sessions in the shared store
//   - the dashboard on :3000
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCluster } from './cluster.js';
import { createDashboard } from './dashboard.js';
import { startProcess, stopProcess } from './processes.js';
import { createStore } from './stores/index.js';

const SHARED_STORE_SERVER = fileURLToPath(new URL('./shared-store-server.js', import.meta.url));

export async function startDemo({
  dashboardPort = 3000, // null = no dashboard
  statefulPort = 8080,
  statelessPort = 8081,
  serversPerCluster = 3,
  redisUrl = process.env.REDIS_URL,
  host = process.env.HOST, // undefined = all interfaces
  verbose = true,
} = {}) {
  const log = verbose ? (msg) => console.log(msg) : () => {};
  const cleanup = [];

  try {
    // 1. The shared store used by the stateless cluster.
    let storeEnv;
    if (redisUrl) {
      log(`Using Redis at ${redisUrl}`);
      storeEnv = { STORE: 'redis', STORE_URL: redisUrl };
    } else {
      const { child, port } = await startProcess(SHARED_STORE_SERVER, { PORT: '0' }, 'shared store');
      cleanup.push(() => stopProcess(child));
      log(`No REDIS_URL set, using the built-in shared store (pid ${child.pid}, port ${port})`);
      storeEnv = { STORE: 'http', STORE_URL: `http://127.0.0.1:${port}` };
    }
    // The dashboard's own connection to the store, used only to display it.
    const sharedStore = await createStore(storeEnv.STORE, storeEnv.STORE_URL);
    cleanup.push(() => sharedStore.close?.());

    // 2. Two clusters running the exact same app-server.js. Only STORE differs.
    const clusters = {
      stateful: createCluster({ id: 'stateful', storeEnv: { STORE: 'memory' }, log }),
      stateless: createCluster({ id: 'stateless', storeEnv, log }),
    };
    for (const cluster of Object.values(clusters)) {
      cleanup.push(() => cluster.stop());
      for (let i = 0; i < serversPerCluster; i++) await cluster.addServer();
    }

    // 3. One load balancer in front of each cluster.
    const lbUrls = {};
    for (const [id, port] of [['stateful', statefulPort], ['stateless', statelessPort]]) {
      const server = await clusters[id].lb.listen(port, host);
      cleanup.push(() => closeServer(server));
      lbUrls[id] = `http://localhost:${server.address().port}`;
    }

    // 4. The dashboard.
    let dashboardUrl = null;
    if (dashboardPort !== null) {
      const dashboard = createDashboard({ clusters, sharedStore, lbUrls, serversPerCluster });
      await new Promise((resolve, reject) => {
        dashboard.once('error', reject);
        dashboard.listen(dashboardPort, host, resolve);
      });
      cleanup.push(() => closeServer(dashboard));
      dashboardUrl = `http://localhost:${dashboard.address().port}`;
    }

    return {
      clusters,
      sharedStore,
      urls: { dashboard: dashboardUrl, ...lbUrls },
      stop: () => runCleanup(cleanup),
    };
  } catch (err) {
    await runCleanup(cleanup);
    throw err;
  }
}

async function runCleanup(cleanup) {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      // keep cleaning up
    }
  }
  cleanup.length = 0;
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

// `node src/index.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = await startDemo();
  console.log(`
  Dashboard           ${demo.urls.dashboard}
  Stateful cluster    ${demo.urls.stateful}   (sessions in each server's memory)
  Stateless cluster   ${demo.urls.stateless}   (sessions in ${demo.sharedStore.label})

  Open the dashboard in your browser. Load balancer traffic is logged below.
  Press Ctrl+C to stop.
`);
  const shutdown = async () => {
    await demo.stop();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
