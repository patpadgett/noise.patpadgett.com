# vendor/

Third-party code shipped with NOISE. Nothing here is modified.

## lamejs.js
`@breezystack/lamejs` 1.2.7, LGPL-3.0 (see `LAMEJS-LICENSE`). MP3 encoder used by SAVE MP3.

## demucs_free.js, demucs_free.wasm
Demucs v4 hybrid-transformer inference, C++ (`demucs.cpp` by Sevag Hanssian) compiled to WebAssembly with Emscripten. MIT (see `DEMUCS-WASM-LICENSE`).

- Source repo: https://github.com/sevagh/free-music-demixer (archived), commit `8229982d` ("Recompile wasm modules without ffast-math", 2024-10-10), files `web/demucs_free.js` and `web/demucs_free.wasm`.
- sha256 `demucs_free.wasm`: `7a273398b3c3804d9ffaa10ec8c3baefe724afeb1d21aba44f2b887c3d7829e6`
- sha256 `demucs_free.js`: `758a4aba932b06eb5c3a81697abe3605b511ae51298d878b697849fc6ad7cd04`
- Exports used: `_malloc`, `_free`, `_modelInit(ptr, bytes)`, `_modelDemixSegment(L, R, n, drumsL, drumsR, bassL, bassR, otherL, otherR, vocalsL, vocalsR, 0,0,0,0,0,0, batch)`. Single-threaded, no SharedArrayBuffer, ~1.9 GB heap while demixing.
- Progress and logs arrive through `postMessage({msg:'PROGRESS_UPDATE'|'WASM_LOG'})` from the module's EM_JS glue; `js/separate.worker.js` wraps `postMessage` to catch them.

## Model weights (not in the repo)
`ggml-model-htdemucs-4s-f16.bin`, 83 994 361 bytes, sha256 `72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064`. Meta's `htdemucs` weights (MIT) converted to ggml f16 by the demucs.cpp project; fetched at runtime from `https://huggingface.co/datasets/Retrobear/demucs.cpp/resolve/main/` (CORS `*`) and stored in Cache Storage (`noise-demucs-v1`). For tests, symlink a local copy to `.impeccable/build/model.bin` (gitignored) and `tests/neural.mjs` points the page at it.
