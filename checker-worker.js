// 檢查器在這個 Worker 裡跑（F339）：還原 stdlib、疊模組包、檢查、編譯都不佔主執行緒，頁面不會凍住。
// 主執行緒（main.js）以 `{id, fn, args}` 呼叫，這裡回 `{id, ok, result | error}`；一次處理一個（訊息依序到達）。
let m = null;

self.onmessage = async ({ data: { id, fn, args } }) => {
  try {
    let result;
    if (fn === '__load') {
      // args: [cella.js 的絕對 URL]——wasm-bindgen 依 import.meta.url 找同目錄的 cella_bg.wasm
      m = await import(args[0]);
      await m.default();
      result = true;
    } else if (fn === '__stdlib' || fn === '__pack') {
      const r = await fetch(args[0]);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${args[0]}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      result = fn === '__stdlib' ? m.init_stdlib_cached(bytes) : m.load_module_pack(bytes);
    } else {
      result = m[fn](...args);
    }
    const transfer = result instanceof Uint8Array ? [result.buffer] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
