// A/B 对照跑分：同一台机器、同一个浏览器、同一个真窗口，一档跑 A（冷启动，含下载）再跑 B（热启动）
//
// 用法: node tests/run-ab.mjs --model whisper-tiny --a <A音频> --b <B音频>
//
// 报的数：
//   一 错误数：漏字/错字/多字，逐词对参照文本（dp 对齐，不是简单按位比）
//   二 耗时：从塞进文件到出文字，真秒数
//   三 首次下载多少兆：服务端 bytes.json 里 /models/ 的真实下发字节
//   四 卡不卡（rAF 最大掉帧间隔）、有没有报错、内存有没有爆（JS 堆峰值）
import { spawn, exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 内存峰值：模型跑在 worker 里，页面 target 的 JS 堆看不到它。
// 直接问操作系统要 chrome.exe 进程树的实际占用，这个才是"会不会爆"。
let memPeak = 0;
const memTimer = setInterval(() => {
  exec('tasklist /fi "imagename eq chrome.exe" /fo csv /nh', { windowsHide: true }, (err, out) => {
    if (err || !out) return;
    let sum = 0;
    for (const line of out.split('\n')) {
      const m = line.match(/"chrome\.exe","\d+","[^"]*","\d+","([\d,\.]+)\s*K"/i);
      if (m) sum += Number(m[1].replace(/[,\s]/g, '')) || 0;
    }
    const mb = Math.round(sum / 1024);
    if (mb > memPeak) memPeak = mb;
  });
}, 2000);

const argv = process.argv.slice(2);
const get = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const MODEL = get('model', 'whisper-tiny');
const DIR = path.resolve(get('dir', path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))), '..', 'ab-samples')));
const FILES = get('files', 'A-clean.mp3,B-hard.mp3').split(',').filter(Boolean).map((f) => path.join(DIR, f));
const REPEAT_B = Number(get('repeat-b', 1));
const PORT = Number(get('cdp', 9477));
const HTTP = Number(get('http', 8901));
const URL_ = `http://127.0.0.1:${HTTP}/index.html`;

const HERE = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const BENCH = path.resolve(path.join(path.dirname(HERE), '..', 'ab-bench'));
const OUT = path.resolve(path.join(path.dirname(HERE), '..', 'ab-results'));
fs.mkdirSync(OUT, { recursive: true });
const BYTES = path.join(BENCH, '..', 'bytes.json');
const CHROME = process.env.BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!FILES.length) { console.error('缺 --files'); process.exit(2); }
for (const f of FILES) if (!fs.existsSync(f)) { console.error('找不到样本: ' + f); process.exit(2); }

// ── 把 worker.js 切到目标档（只改本地 bench 副本，线上文件不动）──
const wpath = path.join(BENCH, 'assets', 'worker.js');
const orig = fs.readFileSync(wpath, 'utf8');
let src = orig;
// 本地整文件直接给，不需要线上那个 25MB 分片拼接的 fetch 拦截
src = src.replace(/const nativeFetch = self\.fetch\.bind\(self\);[\s\S]*?\n};\n/, '');
src = src.replace(/const MODEL_ID = '[^']*';/, `const MODEL_ID = '${MODEL}';`);
if (src === orig || !src.includes(`MODEL_ID = '${MODEL}'`)) { console.error('worker.js 改写失败'); process.exit(2); }
fs.writeFileSync(wpath, src);
console.log(`[model] ${MODEL}  (worker.js 已切档，分片拦截已去掉 —— 本地整文件下发)`);

const readBytes = () => { try { return JSON.parse(fs.readFileSync(BYTES, 'utf8')); } catch { return { models: {}, all: 0 }; } };
const b0 = readBytes();

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cqab-'));
console.log('[profile] ' + profile);
const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--js-flags=--max-old-space-size=3072',
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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method) this.events.push(m); }); }
  send(method, params = {}, timeout = 3600000) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('TIMEOUT ' + method)); } }, timeout); }); }
}
const ev = (cdp, e, t = 30000) => cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: false }, t).then((r) => (r && r.result ? r.result.value : undefined));
const evA = (cdp, e, t = 120000) => cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, t).then((r) => (r && r.result ? r.result.value : undefined));

// 词级对齐：返回 命中 / 替换(错字) / 删除(漏字) / 插入(多字)
function align(refWords, hypWords) {
  const n = refWords.length, m = hypWords.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const bp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) { d[i][0] = i; bp[i][0] = 2; }
  for (let j = 0; j <= m; j++) { d[0][j] = j; bp[0][j] = 3; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    if (refWords[i - 1] === hypWords[j - 1]) { d[i][j] = d[i - 1][j - 1]; bp[i][j] = 1; }
    else {
      const s = d[i - 1][j - 1] + 1, del = d[i - 1][j] + 1, ins = d[i][j - 1] + 1;
      const mn = Math.min(s, del, ins);
      d[i][j] = mn; bp[i][j] = mn === s ? 1 : (mn === del ? 2 : 3);
    }
  }
  let i = n, j = m, hit = 0, sub = 0, del = 0, ins = 0;
  while (i > 0 || j > 0) {
    const b = bp[i][j];
    if (b === 1) { if (refWords[i - 1] === hypWords[j - 1]) hit++; else sub++; i--; j--; }
    else if (b === 2) { del++; i--; }
    else { ins++; j--; }
  }
  return { hit, sub, del, ins };
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

async function once(cdp, file, label, cold) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
  // 每次都先把上一次的状态清掉（点 Clear），保证是从干净状态起跑
  await ev(cdp, "(()=>{const r=document.querySelector('#btn-reset'); if(r && !document.querySelector('#result').hidden) r.click(); return 1})()");
  await sleep(400);
  // 装一个 rAF 探针测掉帧（= 页面卡不卡）
  await ev(cdp, "window.__g=0;window.__l=performance.now();window.__f=0;(function L(){const t=performance.now();const g=t-window.__l;window.__l=t;if(g>window.__g)window.__g=g;window.__f++;requestAnimationFrame(L)})();'ok'");

  const t0 = Date.now();
  const before = readBytes();
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId });
  let done = false, last = '';
  while (Date.now() - t0 < 30 * 60 * 1000) {
    let s = null;
    // 超时必须放宽：重模型会把主线程长时间占满，evaluate 几秒不回是常态，不是崩了
    try { s = await ev(cdp, "(document.querySelector('#status')||{}).textContent||''", 180000); } catch {}
    const key = (s || '').replace(/\d+(\.\d+)?/g, '#');
    if (s && key !== last) { console.log('    [' + ((Date.now() - t0) / 1000).toFixed(0) + 's] ' + s); last = key; }
    if (s && /transcribed in/.test(s)) { done = true; break; }
    if (s && /Something went wrong|Could not decode|will not fit|out of memory/i.test(s)) break;
    await sleep(1000);
  }
  const secs = (Date.now() - t0) / 1000;
  const txt = (await ev(cdp, "(document.querySelector('#result-body')||{}).innerText||''")) || '';
  const gap = await ev(cdp, 'Math.round(window.__g||0)');
  const frames = await ev(cdp, 'window.__f||0');
  const after = readBytes();
  const dlModel = (after.models?.[MODEL] || 0) - (before.models?.[MODEL] || 0);
  const dlAll = (after.all || 0) - (before.all || 0);
  let heap = null;
  const memAt = memPeak;
  // 收集本段产生的控制台条目
  const logs = [];
  for (const e of cdp.events) {
    if (e.method === 'Runtime.consoleAPICalled') logs.push({ lv: e.params.type, t: (e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
    else if (e.method === 'Log.entryAdded') logs.push({ lv: 'log:' + (e.params.entry || {}).level, t: ((e.params.entry || {}).text || '') });
  }
  cdp.events.length = 0;
  return { label, cold, done, secs: +secs.toFixed(1), txt: txt.trim(), gap, frames, dlModel, dlAll, memPeak: memAt, logs };
}

async function run() {
  const results = [];
  try {
    await waitDevtools();
    const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL_), { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Log.enable'); await cdp.send('DOM.enable'); await cdp.send('Performance.enable');
    await cdp.send('Page.navigate', { url: URL_ });
    for (let i = 0; i < 240; i++) {
      if (await ev(cdp, "document.readyState==='complete'&&!!document.querySelector('#file-input')")) break;
      await sleep(500);
    }
    console.log('  crossOriginIsolated = ' + await ev(cdp, 'String(crossOriginIsolated)'));

    // 第一段冷启动（含模型下载），之后都是热启动。
    // 这台机器只有 2 核且常年有别的东西在跑，单次耗时会被 CPU 争用污染，
    // 所以每段重复 repeatB 次取范围，不拿单次数字下结论。
    for (let fi = 0; fi < FILES.length; fi++) {
      const f = FILES[fi];
      const lab = path.basename(f).replace(/\.[^.]+$/, '');
      for (let i = 1; i <= REPEAT_B; i++) {
        const cold = fi === 0 && i === 1;
        console.log(`\n  ── ${lab}${REPEAT_B > 1 ? ` (第 ${i}/${REPEAT_B} 次)` : ''}${cold ? '  [冷启动，含模型下载]' : '  [热启动]'}`);
        results.push(await once(cdp, f, lab, cold));
      }
    }

    ws.close();
  } catch (e) { console.error('[error] ' + (e && e.stack ? e.stack : e)); }
  finally {
    clearInterval(memTimer);
    try { chrome.kill('SIGKILL'); } catch {}
    let gone = false;
    for (let i = 0; i < 15 && !gone; i++) { await sleep(1500); try { fs.rmSync(profile, { recursive: true, force: true }); gone = !fs.existsSync(profile); } catch {} }
    console.log(gone ? '[cleanup] profile 已删' : '[cleanup] !!! 删不掉 ' + profile);
  }

  const refs = {};
  for (const f of FILES) { const lab = path.basename(f).replace(/\.[^.]+$/, ''); refs[lab] = fs.readFileSync(path.join(DIR, lab + '.txt'), 'utf8'); }
  const out = { model: MODEL, at: new Date().toISOString(), machine: { cores: os.cpus().length, memGB: +(os.totalmem() / 1073741824).toFixed(1) }, runs: [] };
  console.log('\n=== ' + MODEL + ' 结果 ===');
  for (const r of results) {
    const rw = norm(refs[r.label]).split(' ').filter(Boolean);
    const hw = norm(r.txt).split(' ').filter(Boolean);
    const a = align(rw, hw);
    const errs = a.sub + a.del + a.ins;
    const wer = rw.length ? (errs / rw.length) * 100 : NaN;
    const rec = { ...r, refWords: rw.length, hypWords: hw.length, ...a, errs, wer: +wer.toFixed(1) };
    out.runs.push(rec);
    console.log(`  ${r.label}  ${r.cold ? '冷' : '热'}`);
    console.log(`    耗时        ${r.secs} s${r.done ? '' : '   (!! 没跑到完成)'}`);
    console.log(`    参照词数    ${rw.length}   实际词数 ${hw.length}`);
    console.log(`    漏字 ${a.del}   错字 ${a.sub}   多字 ${a.ins}   合计错 ${errs}   WER ${wer.toFixed(1)}%`);
    console.log(`    下载        ${(r.dlModel / 1048576).toFixed(1)} MB (模型) / ${(r.dlAll / 1048576).toFixed(1)} MB (全部)`);
    console.log(`    最长掉帧    ${r.gap} ms   (共 ${r.frames} 帧)`);
    console.log(`    内存峰值     ${r.memPeak} MB (chrome.exe 进程树)`);
    console.log(`    控制台      ${r.logs.length} 条` + (r.logs.length ? '：' + r.logs.slice(0, 6).map((l) => `[${l.lv}] ${l.t.slice(0, 90)}`).join(' | ') : ''));
    console.log(`    转写原文    ${JSON.stringify(r.txt.slice(0, 200))}`);
  }
  // 按样本分组汇总（重复跑的取中位）
  const byLab = {};
  for (const r of out.runs) (byLab[r.label] = byLab[r.label] || []).push(r);
  console.log('\n  ── 汇总（每段：WER / 中位耗时 / 漏错多）──');
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  let sumT = 0, sumB = 0, sumH = 0;
  for (const [lab, rs] of Object.entries(byLab)) {
    const r0 = rs[0];
    const t = med(rs.map((r) => r.secs));
    console.log(`    ${lab.padEnd(22)} WER ${String(r0.wer.toFixed(1) + '%').padStart(6)}   中位 ${String(t).padStart(6)}s   漏${r0.del} 错${r0.sub} 多${r0.ins}   (共${r0.refWords}词)`);
    sumT += r0.refWords; sumB += r0.errs;
  }
  // 全样本加权 WER = 总错误 / 总参照词数，比逐段平均更实在
  console.log(`\n    全样本加权 WER = ${sumB} / ${sumT} = ${(sumB / sumT * 100).toFixed(1)}%`);
  fs.writeFileSync(path.join(OUT, `ab-${MODEL}.json`), JSON.stringify(out, null, 2));
  console.log('\n[写盘] ' + path.join(OUT, `ab-${MODEL}.json`));
}
run().then(() => process.exit(0));
