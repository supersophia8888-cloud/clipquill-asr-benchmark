// 验页面这句话："of those 99 we have run English audio and one short Chinese clip ourselves"
//
// 99 那个数已经从 shipped 的 tokenizer.json 里数出来确认了；
// 这里验后半句 —— 真的把一段中文音频塞进去，语言选 zh，看吐出来什么。
//
// 跑的是 dist-clipquill（已核对：app.js / worker.js 的 md5 跟 clipquill.com 线上一致），
// 本地起 COOP/COEP 的服务端，页面才有 crossOriginIsolated，跟线上同一条执行路径。
//
// 中文没有天然的词边界，所以用 CER（字符错误率）而不是 WER。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.argv[2] || 9677);
const HTTP = Number(process.argv[3] || 8912);
const ROOT = process.argv[4] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-16-15-52-49/dist-clipquill';
const AUDIO = process.argv[5] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-16-15-52-49/audio/zh20.mp3';
const REF = process.argv[6] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-16-15-52-49/zh20.txt';
const LANG = process.argv[7] || 'zh';
const OUT = process.argv[8] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/ab-results/zh-2026-09-18.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 本地服务端（带隔离头，否则 crossOriginIsolated=false，跟线上不是一条路）──
const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const PY = 'C:/Users/Administrator/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe';
const srv = spawn(PY, [path.join(HERE, 'serve-ab.py'), String(HTTP), ROOT], { stdio: ['ignore', 'ignore', 'pipe'] });
let srvLog = '';
srv.stderr.on('data', (d) => { srvLog += d.toString(); });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-zh-'));
console.log('[profile] ' + profile);

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1000,800',
  `http://127.0.0.1:${HTTP}/index.html`,
], { stdio: 'ignore' });

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
        setTimeout(() => { if (waiters.has(mid)) { waiters.delete(mid); rej(new Error(method + ' 超时')); } }, 120000);
      });
    },
    close: () => ws.close() };
}

// ── 字符级 DP 对齐，报替换/插入/删除各多少 ──
function align(ref, hyp) {
  const R = Array.from(ref), H = Array.from(hyp);
  const n = R.length, m = H.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(
        d[i - 1][j - 1] + (R[i - 1] === H[j - 1] ? 0 : 1),
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
      );
    }
  }
  let i = n, j = m, sub = 0, del = 0, ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (R[i - 1] === H[j - 1] ? 0 : 1)) {
      if (R[i - 1] !== H[j - 1]) sub++;
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { del++; i--; }
    else { ins++; j--; }
  }
  return { refLen: n, hypLen: m, sub, del, ins, err: sub + del + ins, cer: n ? (sub + del + ins) / n : null };
}

const stripPunct = (s) => Array.from(s.replace(/[\s，。、；：？！「」『』（）()《》〈〉,.!?;:"'`—\-…·]/g, '')).join('');

let cdp, result = null;
try {
  await sleep(2500);
  cdp = cdpOpen(await getWs());
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await sleep(1500);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };

  console.log('浏览器: ' + (await ev('navigator.userAgent')).slice(0, 80));
  console.log('crossOriginIsolated = ' + (await ev('self.crossOriginIsolated')));

  // 错误钩子要在塞文件之前装好
  await ev(`(() => { window.__errs = []; window.addEventListener('error', e => window.__errs.push('error: ' + (e.message||'')));
    window.addEventListener('unhandledrejection', e => window.__errs.push('reject: ' + String(e.reason)));
    const ce = console.error; console.error = function(...a){ window.__errs.push('console.error: ' + a.map(String).join(' ').slice(0,200)); return ce.apply(this, a); };
    return true; })()`);

  // 选语言：app.js 在第 285 行读 el.lang.value，所以改了要派发 change（顺带写 localStorage）
  const langSet = await ev(`(() => { const s = document.getElementById('lang'); if (!s) return 'no-select';
    s.value = '${LANG}'; s.dispatchEvent(new Event('change'));
    return 'value=' + s.value + ' localStorage=' + localStorage.getItem('cq-lang'); })()`);
  console.log('语言选择器: ' + langSet);

  // 塞文件
  const doc = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!nodeId) throw new Error('页面里找不到 input[type=file]');
  const desc = await cdp.send('DOM.describeNode', { nodeId });
  await cdp.send('DOM.setFileInputFiles', { files: [AUDIO], backendNodeId: desc.node.backendNodeId });

  const t0 = Date.now();
  let statusText = '';
  for (let i = 0; i < 400; i++) {
    await sleep(1000);
    const s = await ev(`(() => { const p = document.getElementById('status');
      return JSON.stringify({ t: p ? p.textContent : '', c: p ? p.className : '' }); })()`);
    const o = JSON.parse(s || '{}');
    statusText = o.t || '';
    if (/^Done\./.test(statusText) || / err$/.test(o.c || '') || /\berr\b/.test(o.c || '')) break;
  }
  const elapsed = (Date.now() - t0) / 1000;

  const text = await ev(`(() => { const b = document.getElementById('result-body'); return b ? b.innerText : ''; })()`);
  const errs = await ev('JSON.stringify(window.__errs || [])');

  result = { lang: LANG, audio: path.basename(AUDIO), elapsedSec: Number(elapsed.toFixed(1)), status: statusText, text, errs: JSON.parse(errs || '[]') };
} catch (e) {
  console.log('ERROR ' + e.message);
  result = { error: e.message };
} finally {
  try { cdp && cdp.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  try { srv.kill('SIGKILL'); } catch {}
  await sleep(1000);
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(profile)) break;
    await sleep(1500);
  }
}

console.log('\n=== 状态行 ===');
console.log(result.status || result.error);
console.log('\n=== 转写结果 ===');
console.log(result.text || '（空）');

if (result.text) {
  const ref = stripPunct(fs.readFileSync(REF, 'utf8'));
  const hyp = stripPunct(result.text);
  const a = align(ref, hyp);
  console.log('\n=== 对照参照文本（已去标点空格，按字算）===');
  console.log('参照: ' + ref);
  console.log('转写: ' + hyp);
  console.log(`\n参照字数 ${a.refLen} / 转写字数 ${a.hypLen}`);
  console.log(`错字(替换) ${a.sub}  漏字(删除) ${a.del}  多字(插入) ${a.ins}`);
  console.log(`总错误 ${a.err}  →  CER ${(a.cer * 100).toFixed(1)}%`);
  result.cer = Number((a.cer * 100).toFixed(1));
  result.counts = a;
}
console.log('\n耗时: ' + result.elapsedSec + 's');
console.log('页面错误: ' + (result.errs && result.errs.length ? JSON.stringify(result.errs).slice(0, 300) : '无'));
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(result, null, 2)); console.log('\n写入 ' + OUT); } catch {}
