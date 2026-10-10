// Does the picture ever reach the recognizer?  Measured 2026-10-11.
//
// Drives one real (non-headless) Chrome window with a throwaway profile:
//
//   PART A  fetch each file from a local static server, run
//           AudioContext.decodeAudioData(), record the exact decoded geometry.
//   PART B  navigate to the live page and hand each file to the page's own
//           #file-input, then read back the page's own status line and its own
//           output text.
//
// Nothing here touches any user browser profile. Change the constants at the
// top before running this elsewhere.
//
//   node run-video-track.mjs
//
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/d1-video-test';
const SITE = 'https://clipquill.com/';
const PORT = 9741;
const HTTP_PORT = 9742;

const FILES = [
  'a-only.m4a', 'a-only.mp3',
  'v-64.mp4', 'v-320.mp4', 'v-1080.mp4', 'v-1080.mov', 'v-1080.mkv',
  'no-audio.mp4', 'v-320-otheraudio.mp4',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-d1-'));

const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  if (name === 'index.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><meta charset=utf-8><title>d1</title><body>d1');
  }
  const p = path.join(DIR, path.basename(name));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'access-control-allow-origin': '*',
    'content-length': fs.statSync(p).size,
  });
  fs.createReadStream(p).pipe(res);
});

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--window-size=1100,900', 'about:blank',
], { stdio: 'ignore' });

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      }
    });
  }
  send(method, params = {}, timeout = 300000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('TIMEOUT ' + method)); } }, timeout);
    });
  }
}

let cdp = null;
let ev = null;
const out = { partA: [], partB: [] };

async function connect() {
  let v = null;
  for (let i = 0; i < 120 && !v; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) v = await r.json(); } catch {}
    if (!v) await sleep(500);
  }
  if (!v) throw new Error('devtools did not come up');
  console.log('[chrome] ' + v.Browser);
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const t = list.find((x) => x.type === 'page');
    if (t) ws = new WebSocket(t.webSocketDebuggerUrl); else await sleep(500);
  }
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable'); await cdp.send('Log.enable');
  ev = async (expr, t = 300000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, t);
    if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r && r.result ? r.result.value : undefined;
  };
}

async function partA() {
  console.log('\n===== PART A  decode geometry =====');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/index.html' });
  await sleep(1500);
  for (const f of FILES) {
    const expr = `(async () => {
      try {
        const r = await fetch('/${f}');
        const b = await r.arrayBuffer();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        try {
          const ab = await ctx.decodeAudioData(b);
          const o = { ok: true, dur: ab.duration, ch: ab.numberOfChannels, sr: ab.sampleRate, bytes: b.byteLength };
          ctx.close(); return o;
        } catch (e) { try { ctx.close(); } catch (_) {} return { ok: false, bytes: b.byteLength, note: String(e && (e.name + ': ' + e.message) || e) }; }
      } catch (e) { return { ok: false, note: 'fetch failed: ' + e.message }; }
    })()`;
    let r;
    try { r = await ev(expr, 120000); } catch (e) { r = { ok: false, note: 'evaluate: ' + e.message.slice(0, 160) }; }
    out.partA.push({ file: f, ...r });
    console.log('  ' + f.padEnd(22) + (r.ok
      ? 'DECODED  ' + r.dur.toFixed(3) + ' s / ' + r.ch + ' ch / ' + r.sr + ' Hz'
      : 'REFUSED  ' + (r.note || '').slice(0, 90)));
  }
}

async function partB() {
  console.log('\n===== PART B  the live page =====');
  for (const f of FILES) {
    const abs = path.join(DIR, f);
    await cdp.send('Page.navigate', { url: SITE });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        if (await ev("document.readyState==='complete'&&!!document.querySelector('#file-input')", 20000)) { ready = true; break; }
      } catch {}
      await sleep(400);
    }
    if (!ready) { out.partB.push({ file: f, outcome: 'PAGE_NOT_READY' }); console.log('  ' + f.padEnd(22) + 'PAGE_NOT_READY'); continue; }
    await sleep(600);
    const before = (await ev("(document.querySelector('#status')||{}).textContent||''", 20000)) || '';
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
    const t0 = Date.now();
    await cdp.send('DOM.setFileInputFiles', { files: [abs], nodeId });
    let verdict = 'TIMEOUT', msg = before, text = '';
    while (Date.now() - t0 < 180000) {
      let s = null;
      try { s = await ev("(document.querySelector('#status')||{}).textContent||''", 20000); } catch {}
      if (s && s !== before) msg = s;
      if (s && s !== before && /could not decode|does not support|not support the Web Audio|no audio/i.test(s)) { verdict = 'REFUSED'; break; }
      if (s && /^Done\./i.test(s)) { verdict = 'TRANSCRIBED'; break; }
      await sleep(600);
    }
    try { text = (await ev("(()=>{const r=document.querySelector('#result-body');return r?(r.value||r.innerText||'').trim():''})()", 20000)) || ''; } catch {}
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    out.partB.push({ file: f, outcome: verdict, seconds: Number(secs), status: String(msg).slice(0, 220), text, textChars: text.length });
    console.log('  ' + f.padEnd(22) + verdict.padEnd(13) + String(secs).padStart(6) + 's  ' + JSON.stringify(String(msg).slice(0, 96)));
  }
}

try {
  await new Promise((res) => server.listen(HTTP_PORT, '127.0.0.1', res));
  await connect();
  await partA();
  await partB();
} catch (e) {
  console.log('ERROR ' + e.message);
} finally {
  try { cdp && cdp.ws.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  try { server.close(); } catch {}
  await sleep(1500);
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(profile)) break;
    await sleep(1500);
  }
}

fs.writeFileSync(path.join(DIR, 'd1-result.json'), JSON.stringify(out, null, 2));
console.log('\n===== SUMMARY =====');
console.log('PART A decoded: ' + out.partA.filter((r) => r.ok).length + '/' + out.partA.length);
console.log('PART B transcribed: ' + out.partB.filter((r) => r.outcome === 'TRANSCRIBED').length + '/' + out.partB.length);
