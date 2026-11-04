// Designsystemets UI-kontroll: startar appen, öppnar dess sidor i headless
// Chrome på 390×844 i ljust och mörkt läge och mäter
//   overflow  sidan är bredare än skärmen
//   wraps     gränssnittstext som bryts till två rader (löptext undantagen)
//   contrast  text under 4,5:1 (stor text 3:1)
//   taps      tryckbart under --tap
//
//   node ds-check/check.mjs [ds-check.json]
//
// Kräver Node 22 (inbyggd WebSocket) och Chrome på PATH — inga npm-paket.
// Konfigurationen ligger i appens rot (ds-check.json), se README.md här.
// Finns det fel ger "gate" (de kategorier som ska fälla CI) exit 1; allt annat
// rapporteras bara.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = (() => { try { return readFileSync(join(here, 'VERSION'), 'utf8').trim(); } catch { return '?'; } })();
const PROBE = readFileSync(join(here, 'probe.js'), 'utf8');
const KINDS = ['overflow', 'wraps', 'contrast', 'taps'];
const VIEW = { width: 390, height: 844 };

const cfgPath = resolve(process.argv[2] || 'ds-check.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const root = dirname(cfgPath);
const base = cfg.base.replace(/\/$/, '');
const gate = cfg.gate ?? KINDS;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (typeof WebSocket === 'undefined') {
  console.error('Node saknar WebSocket — kör med Node 22 eller nyare.');
  process.exit(2);
}

function findChrome() {
  for (const bin of [process.env.CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean)) {
    try { execFileSync('which', [bin], { stdio: 'pipe' }); return bin; } catch { /* nästa */ }
  }
  console.error('Hittade ingen Chrome på PATH.');
  process.exit(2);
}

// ---- appen -------------------------------------------------------------------
let app = null;
const children = [];
function stopAll() { for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill(); } catch {} } } }
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));

async function startApp() {
  if (!cfg.start) return;
  const env = { ...process.env, ...(cfg.env || {}) };
  // $TMP i env eller start = en tom katalog för just den här körningen (databas, data/).
  const tmp = mkdtempSync(join(tmpdir(), 'dscheck-'));
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') env[k] = v.replaceAll('$TMP', tmp);
  env.DSCHECK_TMP = tmp;
  app = spawn('sh', ['-c', cfg.start.replaceAll('$TMP', tmp)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(app);
  let log = '';
  app.stdout.on('data', d => { log += d; });
  app.stderr.on('data', d => { log += d; });
  const ready = base + (cfg.ready || '/');
  for (let i = 0; i < (cfg.readySeconds || 60) * 4; i++) {
    if (app.exitCode !== null) break;
    try { const r = await fetch(ready, { redirect: 'manual' }); if (r.status < 500) return; } catch { /* inte uppe än */ }
    await sleep(250);
  }
  console.error(`Appen kom aldrig upp på ${ready}.\n--- appens logg ---\n${log.slice(-3000)}`);
  process.exit(2);
}

// Inloggning och låtsasdata: vanliga HTTP-anrop före mätningen. Cookies sparas
// och skickas med både här och i Chrome.
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function request(r) {
  const headers = { ...(r.headers || {}) };
  let body;
  if (r.json !== undefined) { body = JSON.stringify(r.json); headers['Content-Type'] = 'application/json'; }
  else if (r.form) { body = new URLSearchParams(r.form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (jar.size) headers.Cookie = cookieHeader();
  headers.Origin = headers.Origin || base;
  const res = await fetch(base + r.path, { method: r.method || (body ? 'POST' : 'GET'), headers, body, redirect: 'manual' });
  for (const c of res.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';'); const i = kv.indexOf('=');
    jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
  const ok = res.status < 400;
  if (!ok && !r.optional) {
    console.error(`${r.method || 'GET'} ${r.path} gav ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(2);
  }
  return res;
}

// ---- Chrome via DevTools-protokollet ------------------------------------------
async function chrome() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDir = mkdtempSync(join(tmpdir(), 'dscheck-chrome-'));
  const c = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
    '--disable-extensions', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  children.push(c);
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) ws = page.webSocketDebuggerUrl;
    } catch { /* startar */ }
    if (!ws) await sleep(250);
  }
  if (!ws) { console.error('Chrome startade inte.'); process.exit(2); }
  const sock = new WebSocket(ws);
  await new Promise((ok, fail) => { sock.onopen = ok; sock.onerror = fail; });
  let id = 0;
  const pending = new Map(), listeners = [];
  sock.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result); }
    else if (m.method) for (const l of [...listeners]) l(m);
  };
  const send = (method, params = {}) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); sock.send(JSON.stringify({ id: i, method, params })); });
  const once = (pred, ms) => new Promise(ok => {
    const t = setTimeout(() => { listeners.splice(listeners.indexOf(f), 1); ok(false); }, ms);
    const f = m => { if (pred(m)) { clearTimeout(t); listeners.splice(listeners.indexOf(f), 1); ok(true); } };
    listeners.push(f);
  });
  return { send, once };
}

// ---- körningen ---------------------------------------------------------------
await startApp();
for (const r of cfg.requests || []) await request(r);
const { send, once } = await chrome();
await send('Page.enable');
await send('Page.setLifecycleEventsEnabled', { enabled: true });
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 3, mobile: true });
if (jar.size) await send('Network.setExtraHTTPHeaders', { headers: { Cookie: cookieHeader() } });

const found = Object.fromEntries(KINDS.map(k => [k, new Map()]));
const keep = (kind, f, where) => {
  const key = JSON.stringify(f);
  if (!found[kind].has(key)) found[kind].set(key, { ...f, where: new Set() });
  found[kind].get(key).where.add(where);
};
let errors = 0;

for (const theme of ['light', 'dark']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  for (const page of cfg.pages) {
    const path = typeof page === 'string' ? page : page.path;
    const name = page.name || (page.menu ? `${path} → ${page.menu}` : page.click ? `${path} → ${page.click}` : path);
    const where = `${name} ${theme === 'dark' ? 'mörkt' : 'ljust'}`;
    const idle = once(m => m.method === 'Page.lifecycleEvent' && m.params.name === 'networkIdle', 10000);
    const nav = await send('Page.navigate', { url: base + path });
    if (nav.errorText) { console.log(`✗ ${where}: ${nav.errorText}`); errors++; continue; }
    await idle;
    await sleep(cfg.settleMs ?? 400);
    // Sidan kan be om ett klick först (öppna menyn, ett ark …), eller en post i
    // huvudmenyn: designsystemets meny öppnas med [aria-controls=huvudmeny] och
    // posten väljs på sin text — så når man vyerna i en ensidesapp.
    if (page.menu) {
      const js = `(async () => {
        const open = () => document.getElementById('huvudmeny');
        const btn = document.querySelector('[aria-controls="huvudmeny"]');
        if (!btn) return 'ingen menyknapp';
        if (!open() || open().hidden) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
        const want = ${JSON.stringify(page.menu)}.toLowerCase();
        const item = [...(open()?.querySelectorAll('a, button') || [])].find(b => b.textContent.trim().toLowerCase().startsWith(want));
        if (!item) return 'ingen menypost';
        item.click();
        return '';
      })()`;
      const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
      if (r.result.value) { console.log(`✗ ${where}: ${r.result.value}`); errors++; continue; }
      await once(m => m.method === 'Page.lifecycleEvent' && m.params.name === 'networkIdle', 3000);
      await sleep(cfg.settleMs ?? 400);
    }
    if (page.click) await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(page.click)})?.click()` }), await sleep(500);
    await send('Runtime.evaluate', { expression: `window.__DS_CHECK_BG = ${JSON.stringify(page.background || null)}` });
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) { console.log(`✗ ${where}: ${exceptionDetails.exception?.description || exceptionDetails.text}`); errors++; continue; }
    const r = JSON.parse(result.value);
    const at = (await send('Runtime.evaluate', { expression: 'location.pathname + location.hash', returnByValue: true })).result.value;
    const want = path.replace(/\?[^#]*/, '');
    const moved = at && at !== want && at !== want.replace(/\/$/, '') + '/' ? ` (hamnade på ${at})` : '';
    if (r.overflow > 0) keep('overflow', { px: r.overflow }, where);
    for (const f of r.wraps) keep('wraps', f, where);
    for (const f of r.contrast) keep('contrast', f, where);
    if (theme === 'light') for (const f of r.taps) keep('taps', f, where);
    const n = (r.overflow > 0 ? 1 : 0) + r.wraps.length + r.contrast.length + (theme === 'light' ? r.taps.length : 0);
    console.log(`${n ? '•' : '✓'} ${where}${moved}${n ? `  ${n} fynd` : ''}`);
  }
}

const title = { overflow: 'Spiller över skärmens bredd', wraps: 'Gränssnittstext på två rader', contrast: 'Kontrast under kravet', taps: 'Träffytor under --tap' };
const line = {
  overflow: f => `+${f.px}px`,
  wraps: f => `${f.el}  "${f.text}" (${f.lines} rader)`,
  contrast: f => `${f.ratio}:1 < ${f.need}  ${f.el} ${f.size}px  "${f.text}"`,
  taps: f => `${f.w}×${f.h}  ${f.el}  "${f.text}"`,
};
let gated = 0;
for (const k of KINDS) {
  if (!found[k].size) continue;
  const g = gate.includes(k);
  if (g) gated += found[k].size;
  console.log(`\n${title[k]} (${found[k].size}, ${g ? 'grind' : 'rapport'}):`);
  for (const f of found[k].values()) {
    const w = [...f.where];
    console.log(`  ${line[k](f)}  — ${w.slice(0, 3).join(', ')}${w.length > 3 ? ` +${w.length - 3}` : ''}`);
  }
}
console.log(`\nds-check ${VERSION}: ${cfg.pages.length} sidor × ljust/mörkt, 390×844.`);
if (errors) { console.error(`${errors} sida(or) gick inte att mäta.`); process.exit(1); }
if (gated) { console.error(`${gated} fynd i grindade kategorier (${gate.join(', ')}).`); process.exit(1); }
console.log(gate.length ? 'Inga fynd i grindade kategorier.' : 'Bara rapport (ingen grind).');
process.exit(0);
