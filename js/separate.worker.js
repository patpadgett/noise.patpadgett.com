// NOISE — stem separation worker. One Demucs v4 (htdemucs, 4 stems) WASM instance per worker.
// The main thread fetches the model once (Cache Storage) and hands every worker the same bytes;
// each worker demixes the chunks it is given and posts the four stems back, chunk by chunk.
//
// WASM module: demucs.cpp compiled by sevagh (MIT, vendor/DEMUCS-WASM-LICENSE). Weights: Meta's
// htdemucs (MIT) converted to ggml f16, fetched from huggingface on first use and cached.

const SR = 44100;
let modPromise = null;

function progressHook(p) { self.postMessage({ type: 'chunk-progress', p }); }
// demucs.cpp's EM_JS glue calls postMessage({msg:'PROGRESS_UPDATE'}) and {msg:'WASM_LOG'} directly;
// wrap postMessage so those land in our protocol instead of leaking as unknown messages.
const rawPost = self.postMessage.bind(self);
self.postMessage = (m, ...rest) => {
  if (m && m.msg === 'PROGRESS_UPDATE') return progressHook(m.data);
  if (m && m.msg === 'WASM_LOG') return; // chatty per-layer logs
  return rawPost(m, ...rest);
};

async function getModule(modelBytes) {
  if (modPromise) return modPromise;
  modPromise = (async () => {
    importScripts('../vendor/demucs_free.js');
    const M = await libdemucs({ locateFile: (f) => '../vendor/' + f });
    const u8 = new Uint8Array(modelBytes);
    const p = M._malloc(u8.byteLength); M.HEAPU8.set(u8, p);
    M._modelInit(p, u8.byteLength); M._free(p);
    return M;
  })();
  return modPromise;
}

function demix(M, L, R) {
  const N = L.length;
  const alloc = (a) => { const q = M._malloc(N * 4); new Float32Array(M.HEAPF32.buffer, q, N).set(a); return q; };
  const pl = alloc(L), pr = alloc(R);
  const outs = []; for (let i = 0; i < 8; i++) outs.push(M._malloc(N * 4));
  M._modelDemixSegment(pl, pr, N, outs[0], outs[1], outs[2], outs[3], outs[4], outs[5], outs[6], outs[7], 0, 0, 0, 0, 0, 0, false);
  // order from demucs.cpp: 0 drums, 1 bass, 2 other, 3 vocals
  const stems = [];
  for (let k = 0; k < 4; k++) {
    stems.push([new Float32Array(new Float32Array(M.HEAPF32.buffer, outs[2 * k], N)), new Float32Array(new Float32Array(M.HEAPF32.buffer, outs[2 * k + 1], N))]);
  }
  M._free(pl); M._free(pr); for (const o of outs) M._free(o);
  return stems;
}

self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.type === 'init') {
      await getModule(d.model);
      rawPost({ type: 'ready' });
    } else if (d.type === 'chunk') {
      const M = await getModule(d.model);
      const t = performance.now();
      const stems = demix(M, d.L, d.R);
      const transfer = []; for (const s of stems) { transfer.push(s[0].buffer, s[1].buffer); }
      rawPost({ type: 'chunk-done', id: d.id, start: d.start, pad: d.pad, stems, ms: performance.now() - t }, transfer);
    }
  } catch (err) {
    rawPost({ type: 'error', id: d.id, error: String(err && err.stack || err) });
  }
};
