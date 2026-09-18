// 站点最值钱的承诺："零上传 —— 文件不出浏览器"。
// 实测办法：跑完整转录，把所有 network 事件录下来。
//   - 上行字节 = 任何 POST/PUT 的请求体字节；按页面承诺应该几乎为 0。
//   - 下行字节 = 模型文件 + 页面静态资源 + 转录输出 0（输出在内存里，不流回服务器）。
// 任何超出同源（clipquill.com）资源拉取的写入流量，就是合约违约。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8908/index.html';
const FILE = process.argv[3] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/bench-audio/t13.mp3';
const PORT = 9888;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-priv-'));

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1100,800',
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
  let eventCb = null;
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    else if (!m.id && eventCb) eventCb(m);
  };
  return { ready,
    onEvent: (cb) => { eventCb = cb; },
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

let cdp;
const requests = [];
const onEvt = (m) => {
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request;
    requests.push({ phase: 'start', method: r.method, url: r.url, type: r.type, ts: m.params.timestamp, post: r.hasPostData ? (r.postData || '').length : 0 });
  } else if (m.method === 'Network.responseReceived') {
    const p = m.params.response;
    requests.push({ phase: 'recv', url: p.url, status: p.status, size: p.encodedDataLength, fromCache: !!p.fromDiskCache, ts: m.params.timestamp });
  }
};

try {
  await sleep(1500);
  cdp = cdpOpen(await getWs());
  cdp.onEvent(onEvt);
  await cdp.ready;
  await cdp.send('Network.enable', { maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024 });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await sleep(2500);

  // 把页面先刷新一次以拿到冷启动的所有请求
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(2500);

  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result.value;
  };

  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
  const { node } = await cdp.send('DOM.describeNode', { nodeId });
  await cdp.send('DOM.setFileInputFiles', { files: [FILE], backendNodeId: node.backendNodeId });
  await ev('document.querySelector("#file-input").dispatchEvent(new Event("change",{bubbles:true}))');

  // 等到 "Done." 或 err，最多 120 秒
  let status = '';
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    status = await ev('(()=>{const s=document.querySelector("#status,#status-line,.status"); return s ? (s.innerText||"").replace(/\\s+/g," ").trim() : "";})()');
    if (/Done\./.test(status) || /err/.test(status)) break;
  }
  await sleep(2000);

  console.log('终态: ' + status.slice(0, 100));

  // 汇总
  const u = new URL(URL_);
  const base = u.origin;
  const starts = requests.filter((r) => r.phase === 'start');
  const recvs  = requests.filter((r) => r.phase === 'recv');
  const uploaded = recvs.filter((r) => r.url === 'ws://localhost/' || r.url.startsWith('http://127.0.0.1:'));  // 这都不是真的 outbound
  const byMethod = {};
  for (const r of starts) byMethod[r.method] = (byMethod[r.method] || 0) + 1;
  console.log('请求方法分布: ' + JSON.stringify(byMethod));

  const nonGetStarts = starts.filter((r) => r.method !== 'GET');
  console.log('非 GET 请求数: ' + nonGetStarts.length);
  if (nonGetStarts.length) for (const r of nonGetStarts.slice(0, 10)) console.log('  ' + r.method + ' ' + r.url);

  const offsite = starts.filter((r) => {
    try { const u2 = new URL(r.url); return u2.origin !== base && !r.url.startsWith('ws://127.0.0.1') && !r.url.startsWith('http://127.0.0.1'); }
    catch { return false; }
  });
  console.log('非同源请求数: ' + offsite.length);
  if (offsite.length) for (const r of offsite.slice(0, 10)) console.log('  ' + r.method + ' ' + r.url);

  // 转写文本是否含有本次音频的痕迹（哈希类签名）—— 简化：只比对文本长度
  const txt = await ev('document.querySelector("#result-body, .result-body, #transcript, .transcript")?.innerText || ""');
  console.log('转写文本长度: ' + txt.length + ' 字符');

  console.log('\n=== 结论 ===');
  console.log('总请求: ' + starts.length);
  console.log('非 GET: ' + nonGetStarts.length);
  console.log('非同源: ' + offsite.length);
  console.log((nonGetStarts.length === 0 && offsite.length === 0) ? '✅ 零上传、零跨源 —— 承诺成立' : '❌ 有写操作或跨源');
} catch (e) {
  console.log('ERROR ' + e.message);
} finally {
  try { cdp && cdp.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  await sleep(1500);
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(profile)) break;
    await sleep(1500);
  }
  console.log('临时 profile 已清理');
}