// 换档后重跑计时：打 clipquill.com 线上那份代码，真窗口，真秒数
//
// 冷启动 = 清掉 Cache Storage / HTTP 缓存后重载（等价于首次访问，要重下 82 MB）
// 缓存后 = 同一个 profile 直接重载，模型已在 Cache Storage 里
//
// 报两个数：
//   应用自报（状态行 "transcribed in Xs"）—— 从调 worker 到出字，冷启动含拉模型
//   墙上时间（塞文件 → Done.）—— 含解码与读文件
// 内存峰值只算这次自己起的 Chrome 进程树，不把机主那个 Chrome 算进去
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.argv[2] || 9681);
const AUDIO_DIR = process.argv[3] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/bench-audio';
const OUT = process.argv[4] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/ab-results/timing-live-base-cap30-2026-09-18.json';
const URL_ = 'https://clipquill.com/';

const PLAN = [
  { file: 't13.mp3', secs: 13, mode: 'cold' },
  { file: 't13.mp3', secs: 13, mode: 'warm' },
  { file: 't60.mp3', secs: 60, mode: 'cold' },
  { file: 't60.mp3', secs: 60, mode: 'warm' },
  { file: 't277.mp3', secs: 277, mode: 'cold' },
  { file: 't277.mp3', secs: 277, mode: 'warm' },
  { file: 't1610.mp3', secs: 1610, mode: 'cold' },
  { file: 't1610.mp3', secs: 1610, mode: 'warm' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 固定 profile 目录，不用 mkdtemp —— 内存采样器在外面按 CommandLine 认进程，
// 命令行里必须能匹配到一个已知字符串。
const profile = process.argv[5] || path.join(path.dirname(OUT), '_tlprofile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1100,900',
  'about:blank',
], { stdio: 'ignore' });

// 内存峰值：只算这次自己起的 Chrome 进程树，不把机主那个 Chrome 算进去。
// 做法：浏览器级 CDP 的 SystemInfo.getProcessInfo 给出本实例的进程 id，
// 再拿 tasklist 的 WorkingSetSize 按 id 求和。不依赖 PowerShell（bash 里 spawn 不出来），
// 也不依赖会被时限掐断的外部采样器。
const memSeries = [];
let memPeakAll = 0;
let memTimer = null;
async function startMemSampler() {
  try {
    const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const bc = cdpOpen(v.webSocketDebuggerUrl);
    await bc.ready;
    memTimer = setInterval(async () => {
      try {
        const r = await bc.send('SystemInfo.getProcessInfo');
        const ids = new Set((r.processInfo || []).map((p) => p.id));
        const out = execFileSync('tasklist', ['/fo', 'csv', '/nh', '/fi', 'imagename eq chrome.exe'], { windowsHide: true }).toString();
        let sum = 0;
        for (const line of out.split('\n')) {
          const m = line.match(/"chrome\.exe","(\d+)","[^"]*","[^"]*","([\d,\.]+)\s*K"/i);
          if (m && ids.has(Number(m[1]))) sum += Number(m[2].replace(/[,\s]/g, '')) || 0;
        }
        const mb = Math.round(sum / 1024);
        if (mb > 0) { memSeries.push({ t: Date.now(), mb }); if (mb > memPeakAll) memPeakAll = mb; }
      } catch {}
    }, 3000);
  } catch (e) { console.log('[内存采样器没起来] ' + e.message); }
}
function peakBetween(t0, t1) {
  let mx = 0;
  for (const p of memSeries) if (p.t >= t0 - 3000 && p.t <= t1 + 3000 && p.mb > mx) mx = p.mb;
  return mx;
}

async function getWs() {
  for (let i = 0; i < 80; i++) {
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
  // 页面主线程在模型加载/推理时会被占住，Runtime.evaluate 可能几十秒不回。
  // 所以每个调用可以单独给超时，超时不等于失败 —— 只说明"还在忙"。
  return { ready,
    send(method, params = {}, timeoutMs = 180000) {
      const mid = ++id;
      return new Promise((res, rej) => {
        waiters.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (waiters.has(mid)) { waiters.delete(mid); rej(new Error(method + ' 超时')); } }, timeoutMs);
      });
    },
    close: () => ws.close() };
}

const rows = [];
let cdp;
let loggedIso = false;
try {
  await sleep(2500);
  cdp = cdpOpen(await getWs());
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Network.enable');
  await startMemSampler();
  await sleep(1500);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  console.log('UA: ' + (await ev('navigator.userAgent')).slice(0, 70));
  console.log('CPUs = ' + (await ev('navigator.hardwareConcurrency')));
  console.log('（crossOriginIsolated 要在导航到线上之后再量，about:blank 上恒为 false）');
  console.log('');

  for (const step of PLAN) {
    const key = `${step.secs}s-${step.mode}`;
    // 冷启动：把 Cache Storage 和 HTTP 缓存清干净再重载
    if (step.mode === 'cold') {
      await cdp.send('Storage.clearDataForOrigin', { origin: 'https://clipquill.com', storageTypes: 'all' }).catch(() => {});
      await cdp.send('Network.clearBrowserCache').catch(() => {});
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
    } else {
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
    }

    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(3500);
    for (let i = 0; i < 90; i++) {
      const ok = await cdp.send('Runtime.evaluate',
        { expression: `!!document.querySelector('input[type=file]')`, returnByValue: true }, 8000)
        .then((r) => r.result.value).catch(() => false);
      if (ok) break;
      await sleep(1000);
    }
    await ev(`(() => { window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.message||'')));
      const ce = console.error; console.error = function(...a){ window.__errs.push(a.map(String).join(' ').slice(0,160)); return ce.apply(this,a); }; return true; })()`).catch(() => {});

    if (!loggedIso) {
      loggedIso = true;
      console.log('线上页面 location = ' + (await ev('location.href')));
      console.log('线上 crossOriginIsolated = ' + (await ev('self.crossOriginIsolated')) +
        '   SharedArrayBuffer = ' + (await ev('typeof SharedArrayBuffer !== "undefined"')));
      console.log('');
    }

    if (step.mode === 'cold') {
      // 冷启动计时：从重载那一刻起，模型要重新下
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
    }

    const audio = path.join(AUDIO_DIR, step.file);
    const doc = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    if (!nodeId) { rows.push({ ...step, ok: false, note: '找不到 file input' }); continue; }
    const desc = await cdp.send('DOM.describeNode', { nodeId });

    const t0 = Date.now();
    await cdp.send('DOM.setFileInputFiles', { files: [audio], backendNodeId: desc.node.backendNodeId });

    let statusText = '', cls = '';
    let busyTicks = 0, lastPrint = 0;
    for (let i = 0; i < 3600; i++) {
      await sleep(2000);
      const s = await cdp.send('Runtime.evaluate',
        { expression: `(() => { const p = document.getElementById('status'); return JSON.stringify({t:p?p.textContent:'',c:p?p.className:''}); })()`, returnByValue: true },
        8000).then((r) => r.result.value).catch(() => null);
      if (s === null) { busyTicks++; } else {
        const o = JSON.parse(s || '{}');
        statusText = o.t || ''; cls = o.c || '';
        if (/^Done\./.test(statusText) || /\berr\b/.test(cls)) break;
      }
      const el = (Date.now() - t0) / 1000;
      if (el - lastPrint >= 30) { lastPrint = el; console.log(`    …${key} 已跑 ${el.toFixed(0)}s${busyTicks ? '（主线程忙 ' + busyTicks + ' 次采样）' : ''}`); }
    }
    const t1 = Date.now();
    const wall = (t1 - t0) / 1000;
    const m = statusText.match(/in\s+([\d.]+)s/);
    const appSec = m ? Number(m[1]) : null;
    const errs = JSON.parse((await ev('JSON.stringify(window.__errs||[])').catch(() => '[]')) || '[]');
    const memPeakMB = peakBetween(t0, t1);
    if (memPeakMB > memPeakAll) memPeakAll = memPeakMB;

    rows.push({ secs: step.secs, file: step.file, mode: step.mode, ok: /^Done\./.test(statusText),
      appSec, wallSec: Number(wall.toFixed(1)), memPeakMB, status: statusText, errs });
    console.log(`  ${String(step.secs).padStart(4)}s ${step.mode.padEnd(4)} ` +
      `${/^Done\./.test(statusText) ? '✅' : '❌'} 应用自报 ${appSec === null ? '—' : appSec + 's'}  ` +
      `墙上 ${wall.toFixed(1)}s  内存峰值 ${memPeakMB} MB` +
      (errs.length ? `  ⚠ ${errs[0].slice(0, 80)}` : ''));
    fs.writeFileSync(OUT, JSON.stringify({ ua: 'Chrome', plan: PLAN, rows, memPeakAllMB: memPeakAll }, null, 2));
  }
} catch (e) {
  console.log('ERROR ' + e.message);
  rows.push({ error: e.message });
} finally {
  try { cdp && cdp.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  await sleep(1500);
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(profile)) break;
    await sleep(1500);
  }
}

console.log('\n=== 汇总 ===');
console.log('时长   冷启动(自报/墙上)      缓存后(自报/墙上)     内存峰值(冷/热)');
for (const secs of [13, 60, 277, 1610]) {
  const c = rows.find((r) => r.secs === secs && r.mode === 'cold');
  const w = rows.find((r) => r.secs === secs && r.mode === 'warm');
  const f = (r) => (r && r.ok) ? `${r.appSec}s / ${r.wallSec}s` : '跑不出来';
  console.log(`${String(secs).padStart(4)}s  ${f(c).padEnd(20)}  ${f(w).padEnd(20)}  ${c ? c.memPeakMB + ' MB' : '—'} / ${w ? w.memPeakMB + ' MB' : '—'}`);
}
console.log(`\n全程内存峰值 ${memPeakAll} MB`);
console.log('写入 ' + OUT);
