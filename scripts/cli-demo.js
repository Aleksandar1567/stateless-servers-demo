// Terminal version of the demo. Starts both clusters on random ports,
// replays the scenario from the README against each one, prints what
// happened, and shuts everything down.
//
//   npm run demo:cli
import { startDemo } from '../src/index.js';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = paint(31);
const green = paint(32);
const bold = paint(1);
const dim = paint(2);

const demo = await startDemo({ dashboardPort: null, statefulPort: 0, statelessPort: 0, verbose: false });

try {
  await run('stateful', "sessions live in each server's own memory");
  await run('stateless', `sessions live in one shared store: ${demo.sharedStore.label}`);
} finally {
  await demo.stop();
}

async function run(clusterId, description) {
  console.log(`\n${bold(`${clusterId.toUpperCase()} cluster`)}  ${dim(`3 servers, ${description}`)}\n`);

  const browser = createBrowser(demo.urls[clusterId]);
  const expected = ['phone'];

  await step(browser, 'POST', '/api/cart', { item: 'phone' }, 'user adds a phone');
  for (let i = 0; i < 3; i++) await step(browser, 'GET', '/api/cart', undefined, 'user opens the cart');

  async function step(client, method, path, body, what) {
    const data = await client.request(method, path, body);
    const cart = data.cart.length ? data.cart.join(', ') : 'empty';
    const ok = data.cart.join() === expected.join();
    const verdict = ok
      ? green('OK')
      : red(`WRONG: server ${data.servedBy} has no cart for this user`);
    console.log(
      `  ${what.padEnd(20)} ${dim(`${method} ${path}`.padEnd(15))} -> server ${data.servedBy}   cart: ${cart.padEnd(6)}  ${verdict}`,
    );
  }
}

/** A tiny fetch wrapper that keeps the session cookie, like a browser does. */
function createBrowser(baseUrl) {
  let cookie = '';
  return {
    async request(method, path, body) {
      const res = await fetch(baseUrl + path, {
        method,
        headers: {
          ...(cookie && { cookie }),
          ...(body && { 'content-type': 'application/json' }),
        },
        body: body && JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return res.json();
    },
  };
}
