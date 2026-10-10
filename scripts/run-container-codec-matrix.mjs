// Container x codec decode matrix, real (non-headless) Chrome window.
// Runs AudioContext.decodeAudioData() on each file; records pass/fail + duration.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/fmat2';
const PORT = 9677;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-fmt2-'));

const files = fs.readdirSync(DIR).filter((f) => /\.(mp4|mov|mkv|webm|avi|wmv|flv|m4a|aac|mp3|ogg|wav)$/i.test(f)).sort();

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=900,700',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find((x) => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP unreachable');
}
function cdpOpen(url) {
  const ws = new WebSocket(url);
  const waiters = new Map();
  let id = 0;
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  return { ready,
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((res, rej) => {
        waiters.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (waiters.has(mid)) { waiters.delete(mid); rej(new Error(method + ' timeout')); } }, 60000);
      });
    },
    close: () => ws.close() };
}

let cdp;
const rows = [];
try {
  await sleep(1500);
  cdp = cdpOpen(await getWs());
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(1500);
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(1200);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  console.log('UA: ' + (await ev('navigator.userAgent')).slice(0, 100));
  console.log('crossOriginIsolated = ' + (await ev('self.crossOriginIsolated')));
  console.log('');

  for (const f of files) {
    const p = path.join(DIR, f);
    const b64 = fs.readFileSync(p).toString('base64');
    const expr = `(async () => {
      const b = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      try {
        const ab = await ctx.decodeAudioData(b.buffer.slice(0));
        const r = { ok: true, dur: ab.duration, ch: ab.numberOfChannels, sr: ab.sampleRate };
        ctx.close(); return r;
      } catch (e) { try { ctx.close(); } catch {} return { ok: false, note: String(e && (e.name + ': ' + e.message) || e) }; }
    })()`;
    let r;
    try { r = await ev(expr); } catch (e) { r = { ok: false, note: 'evaluate failed: ' + e.message.slice(0, 140) }; }
    rows.push({ file: f, ...r, bytes: fs.statSync(p).size });
    console.log(`${f.padEnd(24)} ${r.ok ? 'DECODED ' : 'REFUSED '} ` +
      (r.ok ? `${r.dur.toFixed(2)}s / ${r.ch}ch / ${r.sr}Hz` : (r.note || '').slice(0, 100)));
  }
} catch (e) {
  console.log('ERROR ' + e.message);
} finally {
  try { cdp && cdp.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  await sleep(1200);
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(profile)) break;
    await sleep(1500);
  }
}

fs.writeFileSync(path.join(DIR, '..', 'decode-matrix-result.json'), JSON.stringify(rows, null, 2));
const ok = rows.filter((r) => r.ok);
console.log('\n=== RESULT ===');
console.log(`decoded: ${ok.length}/${rows.length}`);
console.log('decoded: ' + ok.map((r) => r.file).join(', '));
console.log('refused: ' + (rows.filter((r) => !r.ok).map((r) => r.file).join(', ') || '(none)'));
