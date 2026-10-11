// 檢查器在這個 Worker 裡跑：還原 stdlib、疊模組包、檢查、編譯都不佔主執行緒，頁面不會凍住。
// 主執行緒（main.js）以 `{id, fn, args}` 呼叫，這裡回 `{id, ok, result | error}`；一次處理一個（排隊，依序）。
//
// 檢查時遞迴太深會用完瀏覽器的堆疊（wasm 的 trap）。wasm 的 panic 不回捲：模組裡的 RefCell 停在借用中，
// 之後每一次呼叫都失敗（「RefCell already borrowed」），直到重新載入頁面。所以 trap 之後換一份新的模組實例
// （URL 加世代參數才會得到新的實例與記憶體），重放已載入的 stdlib 與模組包（位元組留在記憶體裡，不重新下載）。
let m = null;
let entry = null;
let gen = 0;
let stdlib = null;
const packs = [];

async function boot() {
  const url = gen === 0 ? entry : `${entry}${entry.includes('?') ? '&' : '?'}gen=${gen}`;
  m = await import(url);
  await m.default();
  if (stdlib) m.init_stdlib_cached(stdlib);
  for (const p of packs) m.load_module_pack(p);
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

const isTrap = (e) => e instanceof RangeError || (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError);

async function handle({ id, fn, args }) {
  try {
    let result;
    if (fn === '__load') {
      // args: [cella.js 的絕對 URL]——wasm-bindgen 依 import.meta.url 找同目錄的 cella_bg.wasm
      entry = args[0];
      await boot();
      result = true;
    } else if (fn === '__stdlib') {
      const bytes = await fetchBytes(args[0]);
      result = m.init_stdlib_cached(bytes);
      if (result) stdlib = bytes;
    } else if (fn === '__pack') {
      const bytes = await fetchBytes(args[0]);
      result = m.load_module_pack(bytes);
      if (result) packs.push(bytes);
    } else {
      result = m[fn](...args);
    }
    const transfer = result instanceof Uint8Array ? [result.buffer] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    if (isTrap(e) && entry) {
      gen += 1;
      try {
        await boot();
      } catch (e2) {
        self.postMessage({ id, ok: false, error: `檢查器停止了，重新啟動也失敗（${String(e2?.message ?? e2)}）——請重新整理頁面` });
        return;
      }
      const why = e instanceof RangeError ? '遞迴太深，用完瀏覽器的堆疊' : String(e?.message ?? e);
      self.postMessage({ id, ok: false, error: `檢查器停止了（${why}），已重新啟動` });
      return;
    }
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
}

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data));
};
