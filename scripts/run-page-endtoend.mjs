// END-TO-END through the REAL clipquill page (local build served on :8933):
// hand each file to the page's own input and read back what the page says.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WORK = 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/fmt-exp';
const SITE_URL = 'http://127.0.0.1:8933/';
const PORT = 9721;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-e2e2-'));

const chrome = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,850', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let id = 0;
function send(method, params = {}, timeoutMs = 200000) {
  return new Promise((res, rej) => {
    const mid = ++id;
    const to = setTimeout(() => { ws.removeEventListener('message', h); rej(new Error('timeout ' + method)); }, timeoutMs);
    const h = (e) => {
      const x = JSON.parse(e.data);
      if (x.id === mid) { clearTimeout(to); ws.removeEventListener('message', h); res(x); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function ev(expr, timeoutMs = 200000) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 200));
  return r.result.result.value;
}

const files = ['p1.mp4', 'p1.mkv', 'p1.mov', 'p1.ts', 'p2-ac3.mp4', 'p2-opus.mp4', 'p2-vorbis.mp4', 'p2-mp3.mp4', 'p2-aac.mp4'];
const rows = [];

try {
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find((x) => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) { wsUrl = t.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(500);
  }
  if (!wsUrl) throw new Error('no CDP page target');
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: SITE_URL });
  await sleep(5000);
  console.log('page: ' + (await ev('document.title', 20000)));

  for (const f of files) {
    const p = path.join(WORK, f);
    if (!fs.existsSync(p)) { console.log('  missing ' + f); continue; }
    const b64 = fs.readFileSync(p).toString('base64');
    const expr = `(async () => {
      const inp = document.querySelector('#file-input');
      if (!inp) return { outcome: 'NO_INPUT' };
      const bin = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
      const file = new File([bin], ${JSON.stringify(f)}, { type: 'application/octet-stream' });
      const dt = new DataTransfer(); dt.items.add(file);
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      const t0 = Date.now();
      let seen = '';
      while (Date.now() - t0 < 150000) {
        await new Promise(r => setTimeout(r, 600));
        const status = ((document.querySelector('#status') || {}).innerText || '').trim();
        const rb = document.querySelector('#result-body');
        const txt = rb ? (rb.value || rb.innerText || '').trim() : '';
        if (status) seen = status.slice(0, 200);
        if (/could not decode|does not support|not support the Web Audio/i.test(status)) {
          return { outcome: 'REFUSED', status: status.slice(0, 200), secs: Math.round((Date.now()-t0)/1000) };
        }
        if (/^Done\./i.test(status)) {
          return { outcome: 'TRANSCRIBED', text: txt.slice(0, 160), status: status.slice(0, 160),
                   secs: Math.round((Date.now() - t0) / 1000) };
        }
      }
      return { outcome: 'TIMEOUT', status: seen };
    })()`;
    let r;
    try { r = await ev(expr, 170000); } catch (e) { r = { outcome: 'ERR', status: e.message.slice(0, 150) }; }
    rows.push({ file: f, ...r });
    console.log(`  ${f.padEnd(13)} ${String(r.outcome).padEnd(9)} ${(r.status || '').slice(0, 120)}`);
    await sleep(500);
  }
} catch (e) {
  console.log('ERROR ' + e.message);
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  await sleep(1000);
  for (let i = 0; i < 12; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} if (!fs.existsSync(profile)) break; await sleep(1500); }
}
fs.writeFileSync(path.join(WORK, 'e2e-result.json'), JSON.stringify(rows, null, 2));
console.log('\n=== SUMMARY ===');
for (const r of rows) console.log(`${r.file}: ${r.outcome}${r.secs ? ' in ' + r.secs + 's' : ''}`);
