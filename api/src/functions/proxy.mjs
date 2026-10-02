// CUE proxy — Azure Static Web Apps managed function. Forwards the browser's calls with the server-side keys,
// under per-visitor and global daily caps so a public visitor spends the owner's money within limits.
//   /api/openai/*        Azure OpenAI Responses (the cue sheet) and, until 2026-10-15, Sora videos
//   /api/speech/*        Azure Speech fast transcription
//   /api/higgsfield/*    Higgsfield (Kling / Wan / Seedance) — create, status, and fetch of the finished CDN file
//   /api/local/* /api/box2/*   the owner's cue_render.py boxes (bearer token server-side)
// App settings: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_SPEECH_REGION, AZURE_SPEECH_KEY, HIGGSFIELD_KEY ("id:secret"),
// CUE_LOCAL_URL + CUE_LOCAL_TOKEN, CUE_BOX2_URL + CUE_BOX2_TOKEN, CUE_DAILY_DOLLARS (global/day, default 40),
// CUE_VISITOR_DOLLARS (per visitor/day, default 6), CUE_CHAT_DEPLOYMENT. Caps are held in memory per instance; move them
// to Azure Table Storage before real traffic.
import { app } from '@azure/functions';

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '');
const KEY = process.env.AZURE_OPENAI_KEY || '';
const DAILY = +(process.env.CUE_DAILY_DOLLARS || 40), PER_VISITOR = +(process.env.CUE_VISITOR_DOLLARS || 6);
const usage = { day: '', total: 0, visitors: new Map() };
function today() { return new Date().toISOString().slice(0, 10); }
function visitorId(req) { return (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim() + '|' + (req.headers.get('user-agent') || '').slice(0, 40); }
function charge(req, dollars) {
  if (usage.day !== today()) { usage.day = today(); usage.total = 0; usage.visitors.clear(); }
  const v = visitorId(req), mine = usage.visitors.get(v) || 0;
  if (usage.total + dollars > DAILY) return { ok: false, why: 'The site has spent its footage budget for today. Try tomorrow, or add your own keys in SETUP.' };
  if (mine + dollars > PER_VISITOR) return { ok: false, why: `That would pass today's per-visitor limit ($${PER_VISITOR} of footage). Add your own keys in SETUP for more.` };
  usage.total += dollars; usage.visitors.set(v, mine + dollars); return { ok: true };
}
// the same per-second rates the client shows (js/engines.js MODELS); the proxy charges its caps by the path it forwards
const RATE = { 'kling-video/v3.0/std/text-to-video': 0.084, 'kling-video/v3.0-turbo/text-to-video': 0.14, 'kling-video/v3.0/pro/text-to-video': 0.168, 'wan/v2.6/text-to-video': 0.15, 'bytedance/seedance-2.5/text-to-video': 1.14 };
const pass = async (r) => ({ status: r.status, headers: { 'Content-Type': r.headers.get('content-type') || 'application/json' }, body: r.body });
const err = (status, message) => ({ status, jsonBody: { error: { message }, detail: message } });

app.http('openai', {
  methods: ['GET', 'POST'], route: 'openai/{*path}', authLevel: 'anonymous',
  handler: async (req) => {
    if (!ENDPOINT || !KEY) return err(503, 'Proxy not configured.');
    const path = req.params.path || '';
    if (!/^(responses|videos(\/[\w-]+(\/content)?)?)$/.test(path)) return err(404, 'Not proxied.');
    let body = null;
    if (req.method === 'POST') {
      body = await req.text();
      if (path === 'videos') { let j; try { j = JSON.parse(body); } catch { return { status: 400 }; } const secs = parseInt(j.seconds || '4', 10); if (![4, 8, 12].includes(secs)) return { status: 400, jsonBody: { error: { message: `Invalid value: '${j.seconds}'. Supported values are: '4', '8', and '12'.`, param: 'seconds', code: 'invalid_value' } } }; const c = charge(req, secs * 0.10); if (!c.ok) return err(429, c.why); j.model = 'sora-2'; body = JSON.stringify(j); }
      if (path === 'responses') { let j; try { j = JSON.parse(body); } catch { return { status: 400 }; } if (JSON.stringify(j.input || '').length > 80000) return { status: 413 }; j.model = process.env.CUE_CHAT_DEPLOYMENT || 'gpt-6-astra'; body = JSON.stringify(j); }
    }
    const url = `${ENDPOINT}/openai/v1/${path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    return pass(await fetch(url, { method: req.method, headers: { 'api-key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body }));
  },
});

app.http('speech', {
  methods: ['POST'], route: 'speech/transcribe', authLevel: 'anonymous',
  handler: async (req) => {
    const region = process.env.AZURE_SPEECH_REGION, key = process.env.AZURE_SPEECH_KEY;
    if (!region || !key) return err(503, 'Speech proxy not configured.');
    const form = await req.formData();
    return pass(await fetch(`https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: form }));
  },
});

app.http('higgsfield', {
  methods: ['GET', 'POST'], route: 'higgsfield/{*path}', authLevel: 'anonymous',
  handler: async (req) => {
    const key = process.env.HIGGSFIELD_KEY; if (!key) return err(503, 'Footage proxy not configured.');
    const path = req.params.path || '';
    // fetch: the finished clip from Higgsfield's CDN, streamed back (the browser never needs the CDN's CORS)
    if (path === 'fetch') { const u = new URL(req.url).searchParams.get('url') || ''; if (!/^https:\/\/[\w.-]*higgsfield[\w.-]*\//.test(u) && !/^https:\/\/[\w.-]+\.(cloudfront\.net|r2\.dev|googleapis\.com|amazonaws\.com)\//.test(u)) return err(400, 'Not a footage URL.'); return pass(await fetch(u)); }
    if (/^requests\/[\w-]+\/status$/.test(path) && req.method === 'GET') return pass(await fetch(`https://api.higgsfield.ai/${path}`, { headers: { Authorization: `Key ${key}` } }));
    if (RATE[path] && req.method === 'POST') {
      let j; try { j = JSON.parse(await req.text()); } catch { return { status: 400 }; }
      const secs = Math.max(1, Math.min(15, parseInt(j.duration || 5, 10)));
      const c = charge(req, secs * RATE[path]); if (!c.ok) return err(429, c.why);
      return pass(await fetch(`https://api.higgsfield.ai/${path}`, { method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', ...(req.headers.get('idempotency-key') ? { 'Idempotency-Key': req.headers.get('idempotency-key') } : {}) }, body: JSON.stringify(j) }));
    }
    return err(404, 'Not proxied.');
  },
});

// the owner's render boxes: free to the visitor, but one render box is one GPU, so the daily cap counts seconds of footage as cents
for (const name of ['local', 'box2']) {
  app.http(name, {
    methods: ['GET', 'POST'], route: `${name}/{*path}`, authLevel: 'anonymous',
    handler: async (req) => {
      const base = (process.env[`CUE_${name.toUpperCase()}_URL`] || '').replace(/\/+$/, ''), tok = process.env[`CUE_${name.toUpperCase()}_TOKEN`];
      if (!base || !tok) return err(503, `${name} render box not configured.`);
      const path = req.params.path || '';
      if (!/^(health|jobs|jobs\/\w+(\/video)?)$/.test(path)) return err(404, 'Not proxied.');
      let body = null;
      if (req.method === 'POST') { let j; try { j = JSON.parse(await req.text()); } catch { return { status: 400 }; } const secs = Math.max(1, Math.min(5, parseInt(j.seconds || 5, 10))); const c = charge(req, secs * 0.01); if (!c.ok) return err(429, c.why); body = JSON.stringify(j); }
      return pass(await fetch(`${base}/${path}`, { method: req.method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body }));
    },
  });
}
