// 纯耗时基准：同一会话里按冷启动 → 热启动顺序跑多个文件，报真秒数
// 用法: node tests/run-timing.mjs --url <页面> --files a.mp3,b.mp3,... [--cdp 9489]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const URL_ = get('url', 'http://127.0.0.1:8902/index.html');
const FILES = get('files', '').split(',').filter(Boolean).map((f) => path.resolve(f));
const PORT = Number(get('cdp', 9489));
const LABEL = get('label', 'run');
const OUTDIR = path.resolve(get('out', path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))), '..', 'ab-results')));
fs.mkdirSync(OUTDIR, { recursive: true });

const CHROME = process.env.BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!FILES.length) { console.error('缺 --files'); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cqt-'));
console.log('[label]   ' + LABEL);
console.log('[url]     ' + URL_);
console.log('[profile] ' + profile);

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--window-size=1000,900', 'about:blank',
], { stdio: 'ignore' });

async function waitDevtools() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return await r.json(); } catch {}
    await sleep(500);
  }
  throw new Error('no devtools');
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }); }
  send(method, params = {}, timeout = 3600000) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('TIMEOUT ' + method)); } }, timeout); }); }
}
const ev = (cdp, e, t = 180000) => cdp.send('Runtime.evaluate', { expression: e, returnByValue: true }, t).then((r) => (r && r.result ? r.result.value : undefined));

async function run() {
  const out = [];
  try {
    await waitDevtools();
    const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL_), { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('DOM.enable');
    await cdp.send('Page.navigate', { url: URL_ });
    for (let i = 0; i < 240; i++) {
      if (await ev(cdp, "document.readyState==='complete'&&!!document.querySelector('#file-input')")) break;
      await sleep(500);
    }
    console.log('  crossOriginIsolated = ' + await ev(cdp, 'String(crossOriginIsolated)'));

    for (let i = 0; i < FILES.length; i++) {
      const f = FILES[i];
      const cold = i === 0;
      await ev(cdp, "(()=>{const r=document.querySelector('#btn-reset'); if(r && !document.querySelector('#result').hidden) r.click(); return 1})()");
      await sleep(600);
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
      const t0 = Date.now();
      await cdp.send('DOM.setFileInputFiles', { files: [f], nodeId });
      let done = false, lastKey = '';
      while (Date.now() - t0 < 60 * 60 * 1000) {
        let s = null;
        try { s = await ev(cdp, "(document.querySelector('#status')||{}).textContent||''", 180000); } catch {}
        if (s) {
          const key = String(s).replace(/\d+(\.\d+)?/g, '#');
          if (key !== lastKey) { console.log('    [' + ((Date.now() - t0) / 1000).toFixed(0) + 's] ' + s); lastKey = key; }
        }
        if (s && /transcribed in/.test(s)) { done = true; break; }
        if (s && /Something went wrong|Could not decode|will not fit|out of memory/i.test(s)) break;
        await sleep(1000);
      }
      const secs = +((Date.now() - t0) / 1000).toFixed(1);
      const audioSecs = Number(path.basename(f).replace(/^t/, '').replace(/\D+$/, '')) || null;
      console.log(`  >>> ${path.basename(f)}  ${cold ? '冷' : '热'}  ${secs}s${done ? '' : '  (!! 未跑到完成)'}  实时倍数 ${audioSecs ? (audioSecs / secs).toFixed(2) + 'x' : '?'}`);
      out.push({ file: path.basename(f), cold, secs, audioSecs, realtime: audioSecs ? +(audioSecs / secs).toFixed(2) : null, done });
    }
    ws.close();
  } catch (e) { console.error('[error] ' + (e && e.stack ? e.stack : e)); }
  finally {
    try { chrome.kill('SIGKILL'); } catch {}
    let gone = false;
    for (let i = 0; i < 15 && !gone; i++) { await sleep(1500); try { fs.rmSync(profile, { recursive: true, force: true }); gone = !fs.existsSync(profile); } catch {} }
    console.log(gone ? '[cleanup] profile 已删' : '[cleanup] !!! 删不掉 ' + profile);
  }
  fs.writeFileSync(path.join(OUTDIR, `timing-${LABEL}.json`), JSON.stringify({ label: LABEL, at: new Date().toISOString(), runs: out }, null, 2));
  console.log('[写盘] ' + path.join(OUTDIR, `timing-${LABEL}.json`));
}
run().then(() => process.exit(0));
