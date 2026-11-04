#!/usr/bin/env node
// Talk to the app's WebView over Chrome DevTools (run `make devtools` first).
//   node tools/cdp.mjs list
//   node tools/cdp.mjs eval '<expression>'      (awaits promises, prints JSON)
//   node tools/cdp.mjs shot out.png
//   node tools/cdp.mjs run file.js [file2.js ...]  (evaluate files in order: hot-reload the injected UI)
//   node tools/cdp.mjs resources [type]            (what the page has loaded: Font, Stylesheet, Image…)
//   node tools/cdp.mjs save <url> <file>           (a loaded resource's content, e.g. a font)
//   node tools/cdp.mjs frames                      (every frame's url, iframes included)
//   node tools/cdp.mjs evalin <url-part> '<expr>'  (evaluate inside the frame whose url contains url-part)
//   node tools/cdp.mjs profile <seconds>           (JS CPU profile + style/layout counters: where the time goes)
//   node tools/cdp.mjs trace <seconds>             (renderer main-thread time by event: Paint, Layout, decode…)
//   node tools/cdp.mjs layers <seconds>            (composited layers: which ones repaint, and why they exist)
// Picks the last page target: popups (sign-in) come after the main page.
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, arg] = process.argv.slice(2);
const targets = (await (await fetch('http://localhost:9222/json')).json()).filter(t => t.type === 'page');
if (cmd === 'list') {
  for (const t of targets) console.log(t.id, t.url, t.title);
  process.exit(0);
}
// TARGET=<url-part> picks a specific page (e.g. the sign-in popup); default: the last one.
const target = process.env.TARGET ? targets.find((t) => t.url.includes(process.env.TARGET)) : targets.at(-1);
if (!target) { console.error('no page targets'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const contexts = [], traceEvents = [];
let layerTree = null;
const painted = new Map();
let traceDone = null;
ws.onmessage = m => {
  const msg = JSON.parse(m.data);
  if (msg.method === 'Tracing.dataCollected') traceEvents.push(...msg.params.value);
  if (msg.method === 'Tracing.tracingComplete' && traceDone) traceDone();
  if (msg.method === 'LayerTree.layerTreeDidChange' && msg.params.layers) layerTree = msg.params.layers;
  if (msg.method === 'LayerTree.layerPainted') painted.set(msg.params.layerId, (painted.get(msg.params.layerId) || 0) + 1);
  if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const call = (method, params = {}) => new Promise(res => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise(r => ws.onopen = r);

if (cmd === 'eval') {
  const r = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r.error ?? r, null, 2));
} else if (cmd === 'run') {
  for (const f of process.argv.slice(3)) {
    const r = await call('Runtime.evaluate', { expression: readFileSync(f, 'utf8'), awaitPromise: true, returnByValue: true });
    const ex = r.result?.exceptionDetails;
    console.log(f, ex ? 'ERROR ' + (ex.exception?.description || ex.text) : 'ok');
  }
} else if (cmd === 'resources' || cmd === 'save') {
  await call('Page.enable');
  const tree = (await call('Page.getResourceTree')).result.frameTree;
  const all = [];
  (function walk(f) { for (const r of f.resources || []) all.push({ frame: f.frame.id, ...r }); (f.childFrames || []).forEach(walk); })(tree);
  if (cmd === 'resources') {
    for (const r of all) if (!arg || r.type === arg) console.log(r.type, r.contentSize || '', r.url);
  } else {
    const r = all.find((x) => x.url === arg);
    if (!r) { console.error('not loaded:', arg); process.exit(1); }
    const res = await call('Page.getResourceContent', { frameId: r.frame, url: r.url });
    const c = res.result;
    if (!c) { console.error('no content:', JSON.stringify(res.error)); process.exit(1); }
    writeFileSync(process.argv[4], Buffer.from(c.content, c.base64Encoded ? 'base64' : 'utf8'));
    console.log('saved', process.argv[4]);
  }
} else if (cmd === 'frames' || cmd === 'evalin') {
  const tree = (await call('Page.getFrameTree')).result.frameTree;
  const frames = [];
  (function walk(f, d) { frames.push({ id: f.frame.id, url: f.frame.url, d }); (f.childFrames || []).forEach((c) => walk(c, d + 1)); })(tree, 0);
  if (cmd === 'frames') { for (const f of frames) console.log('  '.repeat(f.d) + f.url.slice(0, 140)); }
  else {
    await call('Runtime.enable');
    await new Promise((r) => setTimeout(r, 300));
    const f = frames.find((x) => x.url.includes(arg));
    const ctx = f && contexts.find((c) => c.auxData && c.auxData.frameId === f.id && c.auxData.isDefault);
    if (!ctx) { console.error('no frame/context for', arg); process.exit(1); }
    const r = await call('Runtime.evaluate', { expression: process.argv[4], contextId: ctx.id, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 2));
  }
} else if (cmd === 'profile') {
  const secs = Number(arg || 10);
  await call('Performance.enable');
  const m0 = Object.fromEntries((await call('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));
  await call('Profiler.enable');
  await call('Profiler.setSamplingInterval', { interval: 500 });
  await call('Profiler.start');
  await new Promise((r) => setTimeout(r, secs * 1000));
  const prof = (await call('Profiler.stop')).result.profile;
  const m1 = Object.fromEntries((await call('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));
  const per = (k) => ((m1[k] - m0[k]) / secs).toFixed(2);
  console.log('per second: script', per('ScriptDuration'), 's | style', per('RecalcStyleDuration'), 's (' + per('RecalcStyleCount') + 'x) | layout',
    per('LayoutDuration'), 's (' + per('LayoutCount') + 'x) | tasks', per('TaskDuration'), 's');
  console.log('heap', (m1.JSHeapUsedSize / 1048576).toFixed(1), 'MB | nodes', m1.Nodes, '| listeners', m1.JSEventListeners);
  // Self time by function (sample deltas), grouped by script.
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = prof.timeDeltas;
  prof.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
  const agg = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const n = byId.get(id), f = n.callFrame;
    const file = (f.url || '').split('/').pop().split('?')[0] || (f.url ? f.url : '(native)');
    const key = (f.functionName || '(anon)') + '  ' + file + (f.lineNumber >= 0 ? ':' + (f.lineNumber + 1) : '');
    agg.set(key, (agg.get(key) || 0) + us);
    total += us;
  }
  const rows = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('profile', (total / 1e6).toFixed(2), 's sampled over', secs, 's');
  for (const [k, us] of rows) console.log(String((us / 1000 / secs).toFixed(1)).padStart(7), 'ms/s ', k);
} else if (cmd === 'trace') {
  const secs = Number(arg || 6);
  setTimeout(() => { console.error('trace: no data (another trace running?)'); process.exit(1); }, secs * 1000 + 30000);
  const started = await call('Tracing.start', { transferMode: 'ReportEvents',
    traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu',
      ...(process.env.TRACE_CATS ? process.env.TRACE_CATS.split(',') : [])] } });
  if (started.error) { console.error('trace:', started.error.message); process.exit(1); }
  await new Promise((r) => setTimeout(r, secs * 1000));
  const done = new Promise((r) => { traceDone = r; });
  await call('Tracing.end');
  await done;
  if (process.env.TRACE_OUT) writeFileSync(process.env.TRACE_OUT, JSON.stringify(traceEvents));
  // Main thread = the thread running the most "RunTask"-level work in the renderer.
  const byThread = new Map();
  for (const e of traceEvents) if (e.ph === 'X' && e.dur) byThread.set(e.pid + ':' + e.tid, (byThread.get(e.pid + ':' + e.tid) || 0) + e.dur);
  const names = new Map();
  for (const e of traceEvents) if (e.ph === 'M' && e.name === 'thread_name') names.set(e.pid + ':' + e.tid, e.args.name);
  for (const [k, v] of [...byThread].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log('thread', names.get(k) || k, (v / 1000 / secs).toFixed(1), 'ms/s (nested sum)');
  const main = [...names].find(([, n]) => n === 'CrRendererMain');
  // Self time per event on the renderer main thread (own duration minus nested events), and counts.
  const ev = traceEvents.filter((e) => main && e.pid + ':' + e.tid === main[0] && e.ph === 'X' && e.dur != null)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map(), count = new Map(), stack = [];
  for (const e of ev) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) self.set(parent.name, (self.get(parent.name) || 0) - e.dur);
    self.set(e.name, (self.get(e.name) || 0) + e.dur);
    count.set(e.name, (count.get(e.name) || 0) + 1);
    stack.push(e);
  }
  const top = ev.filter((e) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  console.log('main thread busy', (top.reduce((a, e) => a + e.dur, 0) / 1000 / secs).toFixed(1), 'ms/s;',
    'frames', ((count.get('ProxyMain::BeginMainFrame') || 0) / secs).toFixed(1), '/s');
  console.log('self ms/s   count/s  event');
  for (const [n, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP || 24)))
    console.log(String((us / 1000 / secs).toFixed(1)).padStart(7), String(((count.get(n) || 0) / secs).toFixed(1)).padStart(8), ' ', n);
} else if (cmd === 'layers') {
  await call('DOM.enable');
  await call('LayerTree.enable');
  await new Promise((r) => setTimeout(r, 500));
  painted.clear();
  await new Promise((r) => setTimeout(r, Number(arg || 3) * 1000));
  const layers = layerTree || [];
  const n0 = painted.size ? [...painted.values()].reduce((a, b) => a + b) : 0;
  console.log(layers.length, 'layers,', n0, 'layer paints in', arg || 3, 's');
  for (const l of layers.sort((a, b) => (painted.get(b.layerId) || 0) - (painted.get(a.layerId) || 0))) {
    let who = '';
    if (l.backendNodeId) {
      const d = await call('DOM.describeNode', { backendNodeId: l.backendNodeId });
      const n = d.result && d.result.node;
      const ci = n && n.attributes ? n.attributes.indexOf('class') : -1;
      if (n) who = n.localName + (ci >= 0 ? '.' + n.attributes[ci + 1] : '');
    }
    const why = (await call('LayerTree.compositingReasons', { layerId: l.layerId })).result;
    console.log(String(painted.get(l.layerId) || 0).padStart(4), 'repaints', Math.round(l.width) + 'x' + Math.round(l.height), l.drawsContent ? 'draws' : '-----', who.slice(0, 50),
      (why && why.compositingReasonIds || []).join(','));
  }
} else if (cmd === 'shot') {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg || 'shot.png', Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg || 'shot.png');
} else {
  console.error('usage: cdp.mjs list | eval <expr> | run <files> | resources [type] | save <url> <file> | shot <file>');
}
ws.close();
