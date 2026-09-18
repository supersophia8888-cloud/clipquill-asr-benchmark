// 验页面的两条 limit 声明：60 分钟 / 512 MB 的文件**开始前就被拦下**。
//
//   > 512 MB  ：纯大小检查，根本不进 decode —— 真文件测。
//   > 60 min  ：要 decode 一次才知道总秒数；为不在 60 分钟里泡着，
//             用一个一次性 monkey-patch 把 decodeAudioData 替换成返回 3605 秒的
//             AudioBuffer（只测"拒收"那一段代码，不测真实 decode 的耗电）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8908/index.html';
const PORT = 9777;
const DIR = process.argv[3] || 'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/limits';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-lim-'));

const tooLong  = path.join(DIR, 'over60min.mp3');
const tooHeavy = path.join(DIR, 'over512mb.wav');
if (!fs.existsSync(tooLong) || !fs.existsSync(tooHeavy)) { console.log('缺测试文件'); process.exit(2); }

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

let cdp;
async function runCase(label, file, expectSubstring, mock) {
  console.log('\n─── ' + label + ' ───');
  const before = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("#status,#status-line,.status")?.innerText || ""', returnByValue: true });
  // 重置
  await cdp.send('Runtime.evaluate', { expression: '(()=>{const r=document.querySelector("#btn-reset");r&&r.click();return 1;})()' });
  await sleep(600);

  // 可选：在页面里注入 mock decodeAudioData，让超长文件也能"立刻"解出来
  if (mock) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(()=>{
        const fake = new AudioContext();
        const buf = fake.createBuffer(1, 16000 * 3605, 16000);
        fake.close();
        const proto = AudioContext.prototype;
        proto.decodeAudioData = function(arr){ return Promise.resolve(buf); };
        return 'mocked';
      })()`,
      returnByValue: true });
    if (r.exceptionDetails) throw new Error('注入 mock 失败');
  }

  // 找 #file-input
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
  const { node } = await cdp.send('DOM.describeNode', { nodeId });
  await cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId: node.backendNodeId });
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("#file-input").dispatchEvent(new Event("change",{bubbles:true}))' });

  // 必须等终态（err 或 Done.），不能一看到状态变了就退 ——
  // "Reading the file…" 也是一次变化，那样只会测到"开始读了"。
  let status = '', cls = '';
  for (let i = 0; i < 200; i++) {   // 最多 100 秒
    await sleep(500);
    const r = await cdp.send('Runtime.evaluate', { expression: '(()=>{const s=document.querySelector("#status,#status-line,.status"); return s?{t:(s.innerText||"").replace(/\\s+/g," ").trim(), c:s.className}:{t:"",c:""}})()', returnByValue: true });
    status = r.result.value.t; cls = r.result.value.c;
    if (cls.includes('err') || /Done\./.test(status)) break;
  }
  const isErr = cls.includes('err');
  const hit = status.includes(expectSubstring);
  console.log(`  status="${status.slice(0,160)}"`);
  console.log(`  cls   ="${cls}"`);
  console.log(`  err=${isErr}  hit="${expectSubstring}"=${hit}`);
  return isErr && hit;
}

try {
  await sleep(1500);
  cdp = cdpOpen(await getWs());
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await sleep(2500);

  const r1 = await runCase('>512 MB 文件 (513 MB)', tooHeavy, 'past 512 MB it will not fit', false);
  // 重置 + 注入 mock 后测 >60min
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("#btn-reset")?.click()' });
  await sleep(600);
  const r2 = await runCase('>60 分钟文件 (3605 s, decode mock 为 3605)', tooLong, 'longest file we have measured is 60 minutes', true);

  console.log('\n=== 结论 ===');
  console.log('>512 MB  : ' + (r1 ? '✅ 拒收' : '❌ 没拒'));
  console.log('>60 min  : ' + (r2 ? '✅ 拒收' : '❌ 没拒'));
  process.exit((r1 && r2) ? 0 : 1);
} catch (e) {
  console.log('ERROR ' + e.message);
  process.exit(2);
} finally {
  try { cdp && cdp.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  await sleep(1500);
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(profile)) break;
    await sleep(1500);
  }
  console.log('临时 profile 已清理: ' + (!fs.existsSync(profile)));
}