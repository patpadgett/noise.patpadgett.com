#!/usr/bin/env python3
"""CUE render server — Wan 2.2 TI2V-5B behind the job API that js/engines.js speaks.

    POST /jobs            {prompt, size:"1280x720"|"720x1280", seconds:1..5, key}   → {id}
    GET  /jobs/{id}       → {status: queued|running|done|failed, progress, eta, position, error}
    GET  /jobs/{id}/video → video/mp4
    GET  /health          → {gpu, queue, model}
    Authorization: Bearer <CUE_RENDER_TOKEN> on every call. CORS answers the CUE origin(s).

Runs in two places with the same file:
  - this box:  CUE_RENDER_TOKEN=… CUE_RENDER_BACKEND=comfy python3 render/cue_render.py   (ComfyUI on :8188 does the work)
  - Modal:     modal deploy render/modal_app.py                                            (backend=diffusers, A100, $30/month free)
One GPU, one job at a time; the queue is in memory and jobs live for RETENTION_H hours. Stdlib + (optionally) torch.
"""
import json, os, sys, time, uuid, threading, subprocess, glob, shutil, urllib.request, urllib.error, io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get('CUE_RENDER_TOKEN', '')
BACKEND = os.environ.get('CUE_RENDER_BACKEND', 'comfy')          # comfy | diffusers
ORIGINS = [o.strip() for o in os.environ.get('CUE_RENDER_ORIGINS', 'https://noise.patpadgett.com,http://127.0.0.1:8766,http://127.0.0.1:8768,http://localhost:8766').split(',') if o.strip()]
WORK = os.environ.get('CUE_RENDER_WORK', '/tmp/cue-render'); os.makedirs(WORK, exist_ok=True)
RETENTION_H = float(os.environ.get('CUE_RENDER_RETENTION_H', '24'))
COMFY = os.environ.get('COMFY_URL', 'http://127.0.0.1:8188'); COMFY_OUT = os.environ.get('COMFY_OUTPUT', '/data/comfy/ComfyUI/output')
# Two ways to run Wan 2.2 5B on a small GPU, measured on a Tesla T4 (fp16, 1280x704):
#   quality: base checkpoint, 20 steps, CFG 5, uni_pc, shift 8      ~5 min per second of footage (sampling ~45 s/step)
#   turbo:   Wan2.2-TI2V-5B-Turbo (DMD-distilled) — 25x faster sampling, but on a T4 (fp16, no bf16) every configuration tried
#            (LoRA on base; fused checkpoint, euler; fused checkpoint on its trained t=1000/750/500/250 schedule, LCM) came out as
#            unresolved noise with melting objects. Kept selectable for cards with bf16; NOT the default.
MODE = os.environ.get('CUE_RENDER_MODE', 'quality')
MODEL = os.environ.get('WAN_MODEL', 'Wan2_2-TI2V-5B-Turbo_fp16.safetensors' if MODE == 'turbo' else 'wan2.2_ti2v_5B_fp16.safetensors')
STEPS = int(os.environ.get('CUE_RENDER_STEPS', '4' if MODE == 'turbo' else '20')); CFG = float(os.environ.get('CUE_RENDER_CFG', '1.0' if MODE == 'turbo' else '5.0')); SHIFT = float(os.environ.get('CUE_RENDER_SHIFT', '5.0' if MODE == 'turbo' else '8.0'))
FPS = 24
SEC_PER_SEC = float(os.environ.get('CUE_RENDER_SEC_PER_SEC', '75' if MODE == 'turbo' else '300'))
PERSIST = os.path.join(WORK, 'jobs.json')  # the queue survives a restart: an overnight sheet must not depend on the browser or this process staying up
NEG = ('色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走, '
       'text, watermark, subtitles, logo, caption')

jobs, order, lock = {}, [], threading.Lock()
by_key = {}

def frames_for(seconds): return int(round(max(1, min(5, int(seconds))) * FPS / 4)) * 4 + 1   # Wan 2.2 VAE: 4n+1 frames
def dims(size): return (704, 1280) if size == '720x1280' else (1280, 704)

# ---------------------------------------------------------------- backends: frames → mp4 path ----
def render_comfy(job):
    w, h = dims(job['size']); n = frames_for(job['seconds']); name = f"cue_{job['id']}"
    g = {
      "1": {"class_type": "UNETLoader", "inputs": {"unet_name": MODEL, "weight_dtype": "default"}},
      "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "default"}},
      "3": {"class_type": "VAELoader", "inputs": {"vae_name": "wan2.2_vae.safetensors"}},
      "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": job['prompt']}},
      "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
      "6": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["1", 0], "shift": SHIFT}},
      "7": {"class_type": "Wan22ImageToVideoLatent", "inputs": {"vae": ["3", 0], "width": w, "height": h, "length": n, "batch_size": 1}},
      "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
      "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": name}},
    }
    if MODE == 'turbo':
        # the distilled checkpoint's own schedule (CueDMDSigmas, custom_nodes/cue_dmd_sigmas.py), LCM sampler, no CFG
        g["14"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "lcm"}}
        g["15"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": job['seed']}}
        g["16"] = {"class_type": "CFGGuider", "inputs": {"model": ["6", 0], "positive": ["4", 0], "negative": ["5", 0], "cfg": CFG}}
        g["18"] = {"class_type": "CueDMDSigmas", "inputs": {"shift": SHIFT, "steps": "1000,750,500,250"}}
        g["8"] = {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["15", 0], "guider": ["16", 0], "sampler": ["14", 0], "sigmas": ["18", 0], "latent_image": ["7", 0]}}
    else:
        g["8"] = {"class_type": "KSampler", "inputs": {"model": ["6", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["7", 0], "seed": job['seed'], "steps": STEPS, "cfg": CFG, "sampler_name": "uni_pc", "scheduler": "simple", "denoise": 1.0}}
    req = urllib.request.Request(COMFY + '/prompt', data=json.dumps({"prompt": g, "client_id": "cue-render"}).encode(), headers={'Content-Type': 'application/json'})
    try: pid = json.load(urllib.request.urlopen(req, timeout=60))['prompt_id']
    except urllib.error.HTTPError as e: raise RuntimeError('ComfyUI rejected the graph: ' + e.read().decode()[:400])
    t0 = time.time(); est = job['seconds'] * SEC_PER_SEC
    while True:
        h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}", timeout=60))
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error':
                msgs = [m[1].get('exception_message', '') for m in st.get('messages', []) if m[0] == 'execution_error']
                raise RuntimeError('render failed: ' + (msgs[0] if msgs else 'unknown')[:400])
            break
        job['progress'] = min(0.95, (time.time() - t0) / est); job['eta'] = max(0, int(est - (time.time() - t0)))
        time.sleep(2)
    pngs = sorted(glob.glob(f"{COMFY_OUT}/{name}_*.png"))
    if not pngs: raise RuntimeError('render produced no frames')
    mp4 = f"{WORK}/{job['id']}.mp4"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-pattern_type', 'glob', '-i', f"{COMFY_OUT}/{name}_*.png", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4], check=True)
    for p in pngs: os.remove(p)
    return mp4

_pipe = None
def render_diffusers(job):
    """Modal path: Wan 2.2 TI2V-5B through diffusers, loaded once per container."""
    global _pipe
    import torch
    from diffusers import WanPipeline, AutoencoderKLWan, UniPCMultistepScheduler
    from diffusers.utils import export_to_video
    if _pipe is None:
        mid = os.environ.get('WAN_MODEL', 'Wan-AI/Wan2.2-TI2V-5B-Diffusers')
        vae = AutoencoderKLWan.from_pretrained(mid, subfolder='vae', torch_dtype=torch.float32)
        _pipe = WanPipeline.from_pretrained(mid, vae=vae, torch_dtype=torch.bfloat16)
        _pipe.scheduler = UniPCMultistepScheduler.from_config(_pipe.scheduler.config, flow_shift=SHIFT)
        _pipe.to('cuda')
    w, h = dims(job['size']); n = frames_for(job['seconds'])
    t0 = time.time(); est = job['seconds'] * SEC_PER_SEC
    def cb(pipe, i, t, kw): job['progress'] = min(0.95, (i + 1) / STEPS); job['eta'] = max(0, int(est - (time.time() - t0))); return kw
    out = _pipe(prompt=job['prompt'], negative_prompt=NEG, height=h, width=w, num_frames=n, guidance_scale=CFG, num_inference_steps=STEPS, generator=torch.Generator('cuda').manual_seed(job['seed']), callback_on_step_end=cb).frames[0]
    mp4 = f"{WORK}/{job['id']}.mp4"; export_to_video(out, mp4, fps=FPS)
    return mp4

RENDER = render_comfy if BACKEND == 'comfy' else render_diffusers

# ---------------------------------------------------------------- persistence: the queue outlives the process ----
save_lock = threading.Lock()
def save():
    with lock:
        snap = {jid: dict(j) for jid, j in jobs.items()}; o = list(order); bk = dict(by_key)
    with save_lock:  # several request threads may finish at once; one writer at a time, atomic replace
        tmp = f"{PERSIST}.{threading.get_ident()}.tmp"
        with open(tmp, 'w') as f: json.dump({'order': o, 'jobs': snap, 'by_key': bk}, f)
        os.replace(tmp, PERSIST)
def load():
    if not os.path.exists(PERSIST): return
    try: d = json.load(open(PERSIST))
    except Exception: return
    with lock:
        for jid in d.get('order', []):
            j = d['jobs'].get(jid)
            if not j: continue
            if j['status'] == 'running': j['status'] = 'queued'; j['progress'] = 0.0   # was mid-render when we died: do it again
            if j['status'] == 'done' and not (j.get('path') and os.path.exists(j['path'])): j['status'] = 'queued'; j['progress'] = 0.0
            jobs[jid] = j; order.append(jid)
        by_key.update(d.get('by_key', {}))
    print(f"restored {len(order)} jobs ({sum(1 for j in jobs.values() if j['status'] == 'queued')} queued)", flush=True)

# ---------------------------------------------------------------- the worker: one job at a time ----
def worker():
    while True:
        job = None
        with lock:
            for jid in order:
                if jobs[jid]['status'] == 'queued': job = jobs[jid]; job['status'] = 'running'; job['started'] = time.time(); break
        if not job: time.sleep(1); continue
        save()
        try:
            job['path'] = RENDER(job); job['status'] = 'done'; job['progress'] = 1.0; job['eta'] = 0
        except Exception as e:
            job['status'] = 'failed'; job['error'] = str(e)[:500]
        job['finished'] = time.time()
        sweep(); save()

def sweep():
    cut = time.time() - RETENTION_H * 3600
    with lock:
        for jid in list(order):
            j = jobs[jid]
            if j.get('finished', 0) and j['finished'] < cut:
                if j.get('path') and os.path.exists(j['path']): os.remove(j['path'])
                order.remove(jid); by_key.pop(j.get('key'), None); jobs.pop(jid, None)

def position_of(job):
    """(jobs ahead in the line, seconds of GPU work ahead) — the running job counts only for what it has left."""
    with lock:
        ahead = [jobs[j] for j in order if jobs[j]['status'] in ('queued', 'running') and jobs[j]['created'] < job['created']]
    secs = 0.0
    for j in ahead:
        if j['status'] == 'running' and j.get('eta') is not None: secs += j['eta'] / SEC_PER_SEC
        else: secs += j['seconds']
    return len(ahead), secs

def gpu_name():
    try: return subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True, timeout=5).stdout.strip().split('\n')[0]
    except Exception: return None

# ---------------------------------------------------------------- HTTP ----
class H(BaseHTTPRequestHandler):
    server_version = 'cue-render/1'
    def log_message(self, format, *args): pass
    def cors(self):
        o = self.headers.get('Origin', '')
        if o in ORIGINS or any(o.startswith(p) for p in ORIGINS):
            self.send_header('Access-Control-Allow-Origin', o); self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'authorization,content-type'); self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); self.send_header('Access-Control-Max-Age', '600')
    def send(self, code, body=None, ctype='application/json'):
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        self.send_response(code); self.cors(); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def authed(self):
        if not TOKEN: return True
        return self.headers.get('Authorization', '') == f'Bearer {TOKEN}'
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if not self.authed(): return self.send(401, {'error': 'bad token'})
        p = self.path.split('?')[0]
        if p == '/health':
            with lock: q = sum(1 for j in jobs.values() if j['status'] in ('queued', 'running'))
            return self.send(200, {'ok': True, 'gpu': gpu_name(), 'queue': q, 'model': f"Wan 2.2 TI2V-5B {'Turbo' if MODE == 'turbo' else ''}".strip(), 'mode': MODE, 'backend': BACKEND, 'secPerSec': SEC_PER_SEC})
        if p.startswith('/jobs/'):
            parts = p.split('/'); jid = parts[2]; job = jobs.get(jid)
            if not job: return self.send(404, {'error': 'no such job'})
            if len(parts) > 3 and parts[3] == 'video':
                if job['status'] != 'done': return self.send(409, {'error': 'not finished'})
                with open(job['path'], 'rb') as f: return self.send(200, f.read(), 'video/mp4')
            pos, secs_ahead = position_of(job)
            eta = job.get('eta') if job['status'] == 'running' else int(secs_ahead * SEC_PER_SEC + job['seconds'] * SEC_PER_SEC) if job['status'] == 'queued' else 0
            return self.send(200, {'id': jid, 'status': job['status'], 'progress': job.get('progress', 0), 'eta': eta, 'position': pos if job['status'] == 'queued' else 0, 'error': job.get('error'), 'seconds': job['seconds']})
        self.send(404, {'error': 'not found'})
    def do_POST(self):
        if not self.authed(): return self.send(401, {'error': 'bad token'})
        if self.path.split('?')[0] != '/jobs': return self.send(404, {'error': 'not found'})
        try: body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0') or 0)) or b'{}')
        except Exception: return self.send(400, {'error': 'bad json'})
        prompt = str(body.get('prompt', '')).strip(); seconds = int(body.get('seconds', 5) or 5); size = body.get('size', '1280x720'); key = body.get('key')
        if not prompt: return self.send(400, {'error': 'prompt required'})
        if not 1 <= seconds <= 5: return self.send(400, {'error': f'seconds must be 1..5 for this model (got {seconds})'})
        if size not in ('1280x720', '720x1280'): return self.send(400, {'error': 'size must be 1280x720 or 720x1280'})
        with lock:
            if key and key in by_key and by_key[key] in jobs: return self.send(200, {'id': by_key[key], 'deduped': True})
            jid = uuid.uuid4().hex[:12]
            jobs[jid] = {'id': jid, 'prompt': prompt[:2000], 'seconds': seconds, 'size': size, 'seed': int(time.time() * 1000) % 2**31, 'status': 'queued', 'progress': 0.0, 'eta': None, 'created': time.time(), 'key': key}
            order.append(jid)
            if key: by_key[key] = jid
        pos, secs_ahead = position_of(jobs[jid])
        save()
        self.send(200, {'id': jid, 'status': 'queued', 'position': pos, 'eta': int((secs_ahead + seconds) * SEC_PER_SEC), 'secPerSec': SEC_PER_SEC})

def serve(host='127.0.0.1', port=8790):
    load()
    threading.Thread(target=worker, daemon=True).start()
    print(f"cue-render on {host}:{port} · backend={BACKEND} · mode={MODE} · model={MODEL} · gpu={gpu_name()} · token={'set' if TOKEN else 'NONE (open!)'}", flush=True)
    ThreadingHTTPServer((host, port), H).serve_forever()

if __name__ == '__main__':
    serve(os.environ.get('CUE_RENDER_HOST', '127.0.0.1'), int(os.environ.get('CUE_RENDER_PORT', '8790')))
