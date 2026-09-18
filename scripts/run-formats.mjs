// 验页面声明的 8 个输入格式：浏览器到底能不能 decode 出来。
// 只验解码这一步（decodeAudioData），不跑 76 MB 模型 —— 快，且结论就是那条声明本身。
// 用真 Chrome 真窗口（Web Audio 的行为跟浏览器实现绑定，headless/模拟都不算数）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8908/index.html';
const PORT = 9666;
const DIR = process.argv[3] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/fmat';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-fmt-'));

const exts = ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'mov', 'webm', 'aac'];

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=900,700',
  URL_,
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
  throw new Error('CDP 连不上');
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
        setTimeout(() => { if (waiters.has(mid)) { waiters.delete(mid); rej(new Error(method + ' 超时')); } }, 60000);
      });
    },
    close: () => ws.close() };
}

const UA = await (async () => {
  const r = await spawn; return 'Chrome';
})();

let cdp;
const rows = [];
try {
  await sleep(1500);
  cdp = cdpOpen(await getWs());
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(2000);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  console.log('浏览器: ' + (await ev('navigator.userAgent')).slice(0, 90));
  console.log('crossOriginIsolated = ' + (await ev('self.crossOriginIsolated')));
  console.log('');

  for (const ext of exts) {
    const p = path.join(DIR, `tone.${ext}`);
    if (!fs.existsSync(p)) { rows.push({ ext, ok: false, note: '缺文件' }); continue; }
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
    try { r = await ev(expr); } catch (e) { r = { ok: false, note: 'evaluate 失败 ' + e.message.slice(0, 120) }; }
    rows.push({ ext, ...r, kb: Math.round(fs.statSync(p).size / 1024) });
    console.log(`  ${ext.padEnd(5)} ${r.ok ? '✅ decode 成功' : '❌ decode 失败'}  ` +
      (r.ok ? `${r.dur.toFixed(2)}s / ${r.ch}ch / ${r.sr}Hz` : r.note ? String(r.note).slice(0, 90) : ''));
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

const ok = rows.filter((r) => r.ok).map((r) => r.ext);
const bad = rows.filter((r) => !r.ok).map((r) => r.ext);
console.log('\n=== 结论 ===');
console.log('decode 成功: ' + (ok.join(', ') || '（无）'));
console.log('decode 失败: ' + (bad.join(', ') || '（无）'));
console.log(`\n${ok.length} 通过 / ${bad.length} 失败（共 ${rows.length}）`);
