import { fork } from 'node:child_process';

/** Start a Node script as its own process and wait until it is listening. */
export async function startProcess(script, env, label, timeoutMs = 15_000) {
  const child = fork(script, [], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} did not start within ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('message', (msg) => {
      if (msg?.type !== 'ready') return;
      clearTimeout(timer);
      resolve(msg.port);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited during startup (code ${code})`));
    });
  });

  return { child, port };
}

/** Kill a process and wait until it is gone. */
export function stopProcess(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
}
