// 验 30 分钟上限是真的在拦，不是只写在页面上
//
// 手法：把页面的 decodeAudioData 换成直接返回指定秒数的 AudioBuffer，
// 这样不用真去等 30 分钟解码，只测"超过上限就拒收"那一段判定。
// 打的是 clipquill.com 线上那份。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.argv[2] || 9788);
const AUDIO = process.argv[3] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/bench-audio/t13.mp3';
const URL_ = 'https://clipquill.com/';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-cap-'));

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,800', URL_,
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } };
  return { ready,
    send(method, params = {}, t = 60000) {
      const mid = ++id;
      return new Promise((res, rej) => {
        waiters.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (waiters.has(mid)) { waiters.delete(mid); rej(new Error(method + ' 超时')); } }, t);
      });
    }, close: () => ws.close() };
}

let cdp;
const results = [];
async function runCase(label, seconds, expect) {
  console.log('\n─── ' + label + ' ───');
  // 每个用例重载一次页面，保证 mock 是干净的
  await cdp.send('Page.navigate', { url: URL_ });
  await sleep(3000);
  for (let i = 0; i < 60; i++) {
    const ok = await cdp.send('Runtime.evaluate', { expression: `!!document.querySelector('input[type=file]')`, returnByValue: true }, 8000)
      .then((r) => r.result.value).catch(() => false);
    if (ok) break;
    await sleep(1000);
  }
  const mk = await cdp.send('Runtime.evaluate', {
    expression: `(()=>{ const fake=new AudioContext(); const buf=fake.createBuffer(1,16000*${seconds},16000); fake.close();
      AudioContext.prototype.decodeAudioData = function(){ return Promise.resolve(buf); }; return 'mocked ${seconds}s'; })()`,
    returnByValue: true });
  if (mk.exceptionDetails) { console.log('  注入 mock 失败: ' + JSON.stringify(mk.exceptionDetails).slice(0, 200)); results.push({ label, pass: false }); return; }

  const doc = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  const desc = await cdp.send('DOM.describeNode', { nodeId });
  await cdp.send('DOM.setFileInputFiles', { files: [AUDIO], backendNodeId: desc.node.backendNodeId });

  let status = '', cls = '';
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const r = await cdp.send('Runtime.evaluate',
      { expression: `(()=>{const s=document.getElementById('status'); return s?JSON.stringify({t:(s.innerText||'').replace(/\\s+/g,' ').trim(), c:s.className}):'{}'})()`, returnByValue: true }, 8000)
      .then((r) => r.result.value).catch(() => '{}');
    const o = JSON.parse(r || '{}');
    status = o.t || ''; cls = o.c || '';
    if (/\berr\b/.test(cls) || /^Done\./.test(status)) break;
  }
  const isErr = /\berr\b/.test(cls);
  const hit = status.includes(expect);
  console.log(`  status = "${status.slice(0, 200)}"`);
  console.log(`  err=${isErr}  含预期文案 "${expect}" = ${hit}`);
  results.push({ label, seconds, pass: isErr && hit, status });
}

try {
  await sleep(2500);
  cdp = cdpOpen(await getWs());
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await sleep(2000);
  await runCase('60 分 05 秒（3605 s）', 3605, 'This page stops at 30 minutes');
  await runCase('30 分 05 秒（1805 s）', 1805, 'This page stops at 30 minutes');
} catch (e) {
  console.log('ERROR ' + e.message);
  results.push({ label: '异常', pass: false, status: e.message });
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
console.log('\n=== 结论 ===');
results.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.label}`));
console.log(`${results.filter((r) => r.pass).length} 通过 / ${results.filter((r) => !r.pass).length} 失败`);
