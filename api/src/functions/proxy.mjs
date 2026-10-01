// CUE proxy — Azure Static Web Apps managed function. Forwards the browser's Azure OpenAI calls
// (Responses + Videos) with the server-side key, under per-visitor and global daily caps so a
// public visitor spends the owner's Azure within limits. Deploy: SWA with this api/ folder;
// app settings: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, CUE_DAILY_SECONDS (global Sora seconds/day,
// default 1800 ≈ $180), CUE_VISITOR_SECONDS (per visitor/day, default 240 ≈ $24).
// Caps are held in memory per instance; move them to Azure Table Storage before real traffic.
import { app } from '@azure/functions';

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '');
const KEY = process.env.AZURE_OPENAI_KEY || '';
const DAILY = +(process.env.CUE_DAILY_SECONDS || 1800), PER_VISITOR = +(process.env.CUE_VISITOR_SECONDS || 240);
const usage = { day: '', total: 0, visitors: new Map() };
function today() { return new Date().toISOString().slice(0, 10); }
function visitorId(req) { return (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim() + '|' + (req.headers.get('user-agent') || '').slice(0, 40); }
function charge(req, seconds) {
  if (usage.day !== today()) { usage.day = today(); usage.total = 0; usage.visitors.clear(); }
  const v = visitorId(req), mine = usage.visitors.get(v) || 0;
  if (usage.total + seconds > DAILY) return { ok: false, why: 'The site has spent its footage budget for today. Try tomorrow, or add your own Azure keys in SETUP.' };
  if (mine + seconds > PER_VISITOR) return { ok: false, why: `That would pass today's per-visitor limit (${PER_VISITOR}s of footage). Add your own Azure keys in SETUP for more.` };
  usage.total += seconds; usage.visitors.set(v, mine + seconds); return { ok: true };
}

app.http('openai', {
  methods: ['GET', 'POST'], route: 'openai/{*path}', authLevel: 'anonymous',
  handler: async (req) => {
    if (!ENDPOINT || !KEY) return { status: 503, jsonBody: { error: { message: 'Proxy not configured.' } } };
    const path = req.params.path || '';
    if (!/^(responses|videos(\/[\w-]+(\/content)?)?)$/.test(path)) return { status: 404, jsonBody: { error: { message: 'Not proxied.' } } };
    let body = null;
    if (req.method === 'POST') {
      body = await req.text();
      if (path === 'videos') { let j; try { j = JSON.parse(body); } catch { return { status: 400 }; } const secs = Math.min(20, Math.max(1, parseInt(j.seconds || '4', 10))); const c = charge(req, secs); if (!c.ok) return { status: 429, jsonBody: { error: { message: c.why } } }; j.model = 'sora-2'; body = JSON.stringify(j); }
      if (path === 'responses') { let j; try { j = JSON.parse(body); } catch { return { status: 400 }; } if (String(j.input || '').length > 60000) return { status: 413 }; j.model = process.env.CUE_CHAT_DEPLOYMENT || 'gpt-6-astra'; body = JSON.stringify(j); }
    }
    const url = `${ENDPOINT}/openai/v1/${path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    const r = await fetch(url, { method: req.method, headers: { 'api-key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
    const headers = { 'Content-Type': r.headers.get('content-type') || 'application/json' };
    return { status: r.status, headers, body: r.body };
  },
});

app.http('speech', {
  methods: ['POST'], route: 'speech/transcribe', authLevel: 'anonymous',
  handler: async (req) => {
    const region = process.env.AZURE_SPEECH_REGION, key = process.env.AZURE_SPEECH_KEY;
    if (!region || !key) return { status: 503, jsonBody: { error: { message: 'Speech proxy not configured.' } } };
    const form = await req.formData();
    const r = await fetch(`https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: form });
    return { status: r.status, headers: { 'Content-Type': 'application/json' }, body: r.body };
  },
});
