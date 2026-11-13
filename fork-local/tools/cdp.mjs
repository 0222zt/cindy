// Cindy Local: minimal CDP driver for the dev Electron app.
// Usage:
//   node cdp.mjs targets
//   node cdp.mjs eval "<js expression>" [--url=<substr>]
//   node cdp.mjs shot <out.png> [--url=<substr>]
//
// Requires the app to run with --remote-debugging-port=9222.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const BASE = `http://127.0.0.1:${PORT}`;

async function listTargets() {
  const res = await fetch(`${BASE}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list -> ${res.status}`);
  return res.json();
}

function pickTarget(targets, urlFilter) {
  const pages = targets.filter((t) => t.type === 'page');
  if (urlFilter) {
    const found = pages.find((t) => t.url.includes(urlFilter));
    if (!found) throw new Error(`no page target matching ${urlFilter}`);
    return found;
  }
  // Main window heuristic: no window-specific query flags, no hash route.
  const main = pages.find((t) => /\/$/.test(new URL(t.url).pathname) && !t.url.includes('?'))
    ?? pages[0];
  return main;
}

async function connect(target) {
  if (typeof WebSocket === 'undefined') throw new Error('global WebSocket unavailable');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message ?? 'unknown'}`)), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30_000);
  });
  return { ws, send };
}

const [cmd, ...rest] = process.argv.slice(2);
const urlFilter = (rest.find((a) => a.startsWith('--url=')) ?? '').slice(6);
const args = rest.filter((a) => !a.startsWith('--url='));

try {
  const targets = await listTargets();
  if (cmd === 'targets') {
    console.log(JSON.stringify(targets.map((t) => ({ id: t.id, type: t.type, title: t.title, url: t.url })), null, 2));
    process.exit(0);
  }
  const target = pickTarget(targets, urlFilter);
  const { ws, send } = await connect(target);
  if (cmd === 'eval') {
    const expression = args.join(' ');
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      console.error('EXCEPTION:', result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
      process.exitCode = 1;
    } else {
      const value = result.result?.value;
      console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
  } else if (cmd === 'shot') {
    const file = args[0] ?? 'shot.png';
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log(`screenshot -> ${file} (${fs.statSync(file).size} bytes)`);
  } else if (cmd === 'click') {
    // Real mouse click so Radix/React pointer handlers fire like a user click.
    const selector = args.join(' ');
    const finder = selector.startsWith('text=')
      ? `(() => { const want = ${JSON.stringify(selector.slice(5))};
          const nodes = Array.from(document.querySelectorAll('button,[role=menuitem],[role=option],a'));
          return nodes.find((e) => (e.innerText || '').trim().includes(want)) ?? null; })()`
      : `document.querySelector(${JSON.stringify(selector)})`;
    const rect = await send('Runtime.evaluate', {
      expression: `(() => { const el = ${finder};
        if (!el) return null; el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      returnByValue: true,
    });
    const point = rect.result?.value;
    if (!point) throw new Error(`no element for selector: ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: point.x, y: point.y, button: 'left', clickCount: 1,
      });
    }
    console.log(`clicked ${selector} @ ${Math.round(point.x)},${Math.round(point.y)}`);
  } else if (cmd === 'type') {
    const text = args.join(' ');
    const focused = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector('[contenteditable="true"], textarea');
        if (!el) return false; el.focus(); return true; })()`,
      returnByValue: true,
    });
    if (!focused.result?.value) throw new Error('no editable element found');
    await send('Input.insertText', { text });
    console.log(`typed ${text.length} chars`);
  } else {
    console.error('usage: cdp.mjs targets | eval <expr> | shot <file> | click <selector> [--url=substr]');
    process.exitCode = 2;
  }
  ws.close();
  await sleep(50);
  process.exit(process.exitCode ?? 0);
} catch (e) {
  console.error('CDP error:', e.message);
  process.exitCode = 1;
}
