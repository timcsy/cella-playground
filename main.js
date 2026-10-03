// Cella Playground — main.js
// Tutorial system + free mode

// 檢查器來自 npm 套件 cella-lang（2026-10-03 使用者決定：只發一個 npm 套件，playground 自己也用它）。
// 發布出去的 playground 有 `cella-lang.json`（釘住的版本），從 jsDelivr 載入；本機開發沒有那個檔，讀本地的 pkg/、stdlib.cell、modules/。
// F339：檢查器跑在 Worker 裡（checker-worker.js）——還原 stdlib、疊模組包（nat 約 2 秒）、長的檢查都不凍住頁面。下面這些都回傳 Promise。
const checkerWorker = new Worker(new URL('./checker-worker.js', import.meta.url), { type: 'module' });
let rpcSeq = 0;
const rpcPending = new Map();
checkerWorker.onmessage = ({ data }) => {
  const p = rpcPending.get(data.id);
  rpcPending.delete(data.id);
  if (p) data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
};
function rpc(fn, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    rpcPending.set(id, { resolve, reject });
    checkerWorker.postMessage({ id, fn, args });
  });
}
const check = (s) => rpc('check', s);
const compile_wasm = (s) => rpc('compile_wasm', s);
const inspect = (s) => rpc('inspect', s);
const goals_at = (s, l, c) => rpc('goals_at', s, l, c);
const type_at = (s, l, c) => rpc('type_at', s, l, c);
const imported_modules = (s) => rpc('imported_modules', s);
const absolute = (u) => new URL(u, location.href).href;
let ASSET_BASE = './';
async function loadCellaLang() {
  let entry = './pkg/cella.js';
  try {
    const r = await fetch('cella-lang.json', { cache: 'no-cache' });
    if (r.ok) {
      const { version } = await r.json();
      ASSET_BASE = `https://cdn.jsdelivr.net/npm/cella-lang@${version}/`;
      entry = ASSET_BASE + 'cella.js';
    }
  } catch { /* 本機開發 */ }
  await rpc('__load', absolute(entry));
}

// --- State ---
let editor = null;
let wasmReady = false;
let stdlibLoaded = false;
let currentMode = 'select'; // 'select' | 'tutorial' | 'free'
let currentRoute = null;    // route object
let currentLevels = [];     // levels array
let currentLevelIdx = -1;
let progress = loadProgress();

// --- DOM refs ---
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const btnCheck = document.getElementById('btn-check');
const btnRun = document.getElementById('btn-run');
const btnInspect = document.getElementById('btn-inspect');
const btnHome = document.getElementById('btn-home');
const btnFree = document.getElementById('btn-free');
const editorEl = document.getElementById('editor');
const routeSelectEl = document.getElementById('route-select');
const playgroundEl = document.getElementById('playground');
const sidebarTitle = document.getElementById('sidebar-title');
const sidebarContent = document.getElementById('sidebar-content');
const tutorialPanel = document.getElementById('tutorial-panel');
const tutorialConcept = document.getElementById('tutorial-concept');
const tutorialProgress = document.getElementById('tutorial-progress');
const tutorialDescription = document.getElementById('tutorial-description');
const tutorialComparison = document.getElementById('tutorial-comparison');
const tutorialHint = document.getElementById('tutorial-hint');

// --- Progress persistence ---
function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem('cella-tutorial-progress') || '{}');
  } catch { return {}; }
}

function saveProgress() {
  localStorage.setItem('cella-tutorial-progress', JSON.stringify(progress));
}

function isLevelCompleted(routeId, levelId) {
  return (progress[routeId] || []).includes(levelId);
}

function markLevelCompleted(routeId, levelId) {
  if (!progress[routeId]) progress[routeId] = [];
  if (!progress[routeId].includes(levelId)) {
    progress[routeId].push(levelId);
    saveProgress();
  }
}

// --- Output helpers ---
function setOutput(text, cls = '') {
  outputEl.textContent = text;
  // 只換結果類別：直接設 className 會蓋掉 collapse-body，輸出面板就失去捲動與版面
  outputEl.classList.remove('success', 'error', 'info', 'warning');
  if (cls) outputEl.classList.add(cls);
}

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}

function getSource() {
  if (editor && editor.state) return editor.state.doc.toString();
  return '';
}

function setSource(text) {
  if (editor && editor.dispatch) {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text }
    });
  }
}

// --- Simple markdown renderer ---
function renderMarkdown(md) {
  let result = md;

  // Step 1: Extract ``` fences first, protect from all further processing
  const codeBlocks = [];
  result = result.replace(/```([^`]*)```/gs, (m, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push('<pre class="md-codeblock">' + code.trim() + '</pre>');
    return '\n%%CODEBLOCK' + idx + '%%\n';
  });

  // Step 2: Extract and render tables (after code blocks are protected)
  result = result.replace(/(\|.+\|[\n])+/g, (block) => {
    const rows = block.trim().split('\n').filter(r => r.includes('|'));
    let html = '<table class="md-table">';
    let isFirst = true;
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1); // remove leading/trailing empty
      // Skip separator rows (|---|---|)
      if (cells.every(c => /^\s*[-:]+\s*$/.test(c))) continue;
      const tag = isFirst ? 'th' : 'td';
      html += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      isFirst = false;
    }
    html += '</table>';
    return html;
  });

  // Preserve leading whitespace in non-code lines (convert spaces to &nbsp;)
  result = result.replace(/\n([ ]{2,})/g, (m, spaces) => {
    return '\n' + '&nbsp;'.repeat(spaces.length);
  });

  result = result
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');

  // Restore code blocks (break out of <p> context)
  codeBlocks.forEach((block, idx) => {
    result = result.replace('%%CODEBLOCK' + idx + '%%', '</p>' + block + '<p>');
  });

  return result;
}

// --- Format results ---
// F320：帶界的通過——界寫在判決的假設裡（在哪個模型底下、模型內容的雜湊），不寫在「通過」本身。
function ratingLines(r) {
  const op = { le: '≤', lt: '<', ge: '≥', gt: '>', eq: '=', abs_le: '的絕對值 ≤' };
  return (r.assumptions || []).filter(a => a.kind === 'rating').map(a =>
    `⚖ 額定：${a.var} ${op[a.op] || a.op} ${a.bound.num}/${a.bound.den}（在模型 ${a.model} 底下；${a.model_hash.slice(0, 15)}…）`);
}

function formatCheckResult(json) {
  try {
    const r = JSON.parse(json);
    if (r.ok) {
      const defs = r.defs || [];
      return [`✓ ${defs.length} definition${defs.length !== 1 ? 's' : ''} checked: ${defs.join(', ')}`, ...ratingLines(r)].join('\n');
    } else if (r.verdict === 'unknown') {
      return [formatUnknown(r), ...ratingLines(r)].join('\n');
    } else {
      return (r.errors || []).map(formatError).join('\n');
    }
  } catch { return json; }
}

// F320：欠定——以 `missing.kind`（閉集）選句型、以 `direction`（名字）填空；不認得的 kind 用英文的 detail。
function underdeterminedText(u) {
  const vars = (u.direction || []).map(d => d.var).join('、');
  switch (u.missing && u.missing.kind) {
    case 'pin_one_of': return `欠定：缺一條定下 ${vars} 其中之一的方程（解可以沿這些變數一起移動）`;
    default: return `欠定：${u.detail}`;
  }
}

// 判決三態（Feature 247）：不知道不是通過、也不是錯誤 —— 說清楚哪一條、為什麼。
// ⚠️ 2026-09-29 之前含洞的程式在這裡印「✓ checked」。
function formatUnknown(r) {
  const why = (u) => {
    switch (u.reason) {
      case 'hole': return '有未填的洞';
      case 'depends_on_unknown': return `用到 ${u.detail}，而它還不知道對不對`;
      case 'out_of_budget': return `檢查用完了預算（${u.detail}）`;
      case 'kernel_skipped': return `第二個 kernel 看不到（${u.detail}）`;
      case 'underdetermined': return underdeterminedText(u);
      default: return u.reason;
    }
  };
  const lines = (r.unknown || []).map(u => `? ${u.def}：${why(u)}`);
  return ['? 還不知道對不對：', ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// F319：IDE 功能——邊打字邊檢查（紅色底線）、滑鼠懸停顯示型別、游標處的證明目標
// 全部在瀏覽器裡由 wasm 算，不需要 server。
// ---------------------------------------------------------------------------

// 檢查結果裡的行、列（1 起算）→ 編輯器的位置
function posOf(doc, line, col) {
  if (!line || line < 1 || line > doc.lines) return 0;
  const l = doc.line(line);
  return Math.min(l.from + Math.max((col || 1) - 1, 0), l.to);
}

// F336：寫了 `import X` 才下載 X 的模組包（`modules/X.cell`）與它還沒載入的依賴，依依賴順序疊上去。
// 清單（`modules/index.json`）第一次需要時才抓。疊加依序進行（下一個包疊在上一個之上），失敗的下次再試。
let moduleIndex = null;
const loadedModules = new Set();
let loading = Promise.resolve();
function fetchModuleIndex() {
  if (!moduleIndex) {
    moduleIndex = fetch(ASSET_BASE + 'modules/index.json')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .catch(e => { moduleIndex = null; throw e; });
  }
  return moduleIndex;
}
async function ensureSnapshotFor(source) {
  if (!stdlibLoaded) return;
  let wanted;
  try { wanted = JSON.parse(await imported_modules(source)); } catch { return; }
  if (!wanted.length) return;
  loading = loading.then(async () => {
    let index;
    try { index = await fetchModuleIndex(); } catch (e) {
      console.error('modules/index.json failed to load', e);
      return;
    }
    const todo = [];
    for (const m of wanted) {
      for (const d of (index.modules[m] || { deps: [] }).deps) {
        if (!loadedModules.has(d) && !todo.includes(d)) todo.push(d);
      }
    }
    if (!todo.length) return;
    let n = 0;
    for (const d of todo) {
      setStatus(`載入模組 ${d}…`);
      try {
        n = await rpc('__pack', absolute(`${ASSET_BASE}modules/${d}.cell`));
        if (!n) throw new Error('load failed');
        loadedModules.add(d);
      } catch (e) {
        console.error(`modules/${d}.cell failed to load`, e);
        setStatus(`模組 ${d} 載入失敗（請重試）`, 'error');
        return;
      }
    }
    setStatus(`Ready (stdlib: ${n} defs)`, 'loaded');
  });
  return loading;
}

async function lintSource(view) {
  if (!stdlibLoaded) return [];
  await ensureSnapshotFor(view.state.doc.toString());
  const doc = view.state.doc;
  let r;
  try { r = JSON.parse(await check(doc.toString())); } catch { return []; }
  if (view.state.doc !== doc) return [];   // 檢查期間又改了：這份結果已過時
  const out = [];
  for (const e of r.errors || []) {
    const from = posOf(doc, e.line, e.col);
    let to = e.endLine ? posOf(doc, e.endLine, e.endCol) : from + 1;
    if (to <= from) to = Math.min(from + 1, doc.length);
    out.push({ from, to, severity: 'error', message: e.message });
  }
  for (const u of r.unknown || []) {
    if (!u.line) continue;
    const from = posOf(doc, u.line, u.col);
    const what = u.reason === 'hole' ? '這裡還沒填（洞）'
      : u.reason === 'underdetermined' ? underdeterminedText(u)
      : `還不知道（${u.reason}${u.detail ? '：' + u.detail : ''}）`;
    out.push({ from, to: Math.min(from + 1, doc.length), severity: 'warning', message: what });
  }
  return out;
}

async function showGoals(view) {
  const el = document.getElementById('goals');
  if (!el || !stdlibLoaded) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  let r;
  try { r = JSON.parse(await goals_at(view.state.doc.toString(), line.number, pos - line.from + 1)); } catch { return; }
  el.textContent = r.goals == null ? '（游標不在 by { … } 裡）' : r.goals;
}

function ideExtensions({ EditorView, hoverTooltip, linter, lintGutter }) {
  let goalsTimer = null;
  return [
    linter(lintSource, { delay: 400 }),
    lintGutter(),
    hoverTooltip(async (view, pos) => {
      if (!stdlibLoaded) return null;
      const line = view.state.doc.lineAt(pos);
      let r;
      try { r = JSON.parse(await type_at(view.state.doc.toString(), line.number, pos - line.from + 1)); } catch { return null; }
      if (r.type == null) return null;
      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-type-tooltip';
          dom.textContent = `${r.expr} : ${r.type}`;
          return { dom };
        },
      };
    }, { hoverTime: 350 }),
    EditorView.updateListener.of((u) => {
      if (!(u.selectionSet || u.docChanged)) return;
      clearTimeout(goalsTimer);
      goalsTimer = setTimeout(() => showGoals(u.view), 300);
    }),
  ];
}

// 錯誤要指到學生寫的那一行。
//
// 在 2026-09-25 之前這裡只印 e.message —— 而更糟的是 e.line 裝的是**位元組偏移**，
// 所以就算印了也是錯的。座標系修好之後才值得顯示。
function formatError(e) {
  const where = (e.line && e.col) ? `第 ${e.line} 行第 ${e.col} 欄` : null;
  return where ? `✗ ${where}：${e.message}` : `✗ ${e.message}`;
}

function formatRunResult(json) {
  try {
    const r = JSON.parse(json);
    if (r.ok) {
      const defs = r.defs || [];
      // 跑得動不等於檢查通過（Feature 247）：不知道的要先說。
      let text = r.verdict === 'unknown'
        ? formatUnknown(r) + '\n'
        : `✓ ${defs.length} definition${defs.length !== 1 ? 's' : ''} checked\n`;
      const out = r.output || '';
      if (out) text += `\n--- Output ---\n${out}`;
      else text += '\n(no output)';
      return text;
    } else {
      return (r.errors || []).map(formatError).join('\n');
    }
  } catch { return json; }
}

// --- Mode switching ---
function showRouteSelect() {
  currentMode = 'select';
  routeSelectEl.style.display = '';
  playgroundEl.style.display = 'none';
  btnHome.style.display = 'none';
  btnFree.style.display = 'none';
}

function showPlayground() {
  routeSelectEl.style.display = 'none';
  playgroundEl.style.display = '';
  btnHome.style.display = '';
  btnFree.style.display = currentMode === 'tutorial' ? '' : 'none';

  // Mobile: output collapsed by default
  if (window.innerWidth <= 768) {
    document.querySelector('.output-panel')?.classList.add('collapsed');
  }
}

function enterFreeMode() {
  currentMode = 'free';
  currentRoute = null;
  currentLevels = [];
  currentLevelIdx = -1;
  tutorialPanel.style.display = 'none';
  sidebarTitle.textContent = 'Examples';
  btnFree.style.display = 'none';
  loadExamples();
  setSource(DEFAULT_SOURCE);
  setOutput('', '');
  showPlayground();
}

async function enterTutorial(routeId) {
  currentMode = 'tutorial';

  // Load route data
  try {
    const resp = await fetch(`tutorials/route-${routeId}.json`);
    if (!resp.ok) {
      setOutput(`Cannot load route-${routeId}.json`, 'error');
      return;
    }
    currentLevels = await resp.json();
  } catch (e) {
    setOutput(`Error loading tutorial: ${e.message}`, 'error');
    return;
  }

  // Find route info
  currentRoute = { id: routeId };
  sidebarTitle.textContent = '章節';
  renderLevelsSidebar();
  tutorialPanel.style.display = '';

  // Load first incomplete level (or first level)
  const firstIncomplete = currentLevels.findIndex(l => !isLevelCompleted(routeId, l.id));
  loadLevel(firstIncomplete >= 0 ? firstIncomplete : 0);

  // Mobile: collapse sidebar by default to save space
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('collapsed');
  }

  showPlayground();
}

// --- Tutorial rendering ---
function renderLevelsSidebar() {
  sidebarContent.innerHTML = '';
  let lastSection = null;
  currentLevels.forEach((level, idx) => {
    // Insert section header if level has a new section
    if (level.section && level.section !== lastSection) {
      const header = document.createElement('div');
      header.className = 'section-header';
      header.textContent = level.section;
      sidebarContent.appendChild(header);
      lastSection = level.section;
    }
    const btn = document.createElement('button');
    btn.className = 'level-item' + (idx === currentLevelIdx ? ' active' : '') +
      (isLevelCompleted(currentRoute.id, level.id) ? ' completed' : '');
    const status = isLevelCompleted(currentRoute.id, level.id) ? '✅' : (idx === currentLevelIdx ? '📖' : '　');
    btn.innerHTML = `<span class="level-status">${status}</span> ${level.title}`;
    btn.addEventListener('click', () => loadLevel(idx));
    sidebarContent.appendChild(btn);
  });
}

function loadLevel(idx) {
  if (idx < 0 || idx >= currentLevels.length) return;
  currentLevelIdx = idx;
  const level = currentLevels[idx];

  // Update sidebar active state
  renderLevelsSidebar();

  // Concept
  tutorialConcept.textContent = `💡 ${level.concept}`;
  tutorialProgress.textContent = `${idx + 1} / ${currentLevels.length}`;

  // Description
  tutorialDescription.innerHTML = renderMarkdown(level.description);

  // Comparison box
  if (level.comparison) {
    tutorialComparison.style.display = '';
    const renderCompCol = (text) => text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
    tutorialComparison.innerHTML = `
      <div class="comparison-title">${level.comparison.title || '比較'}</div>
      <div class="comparison-body">
        <div class="comparison-col">
          <div class="col-label">${level.comparison.math ? '數學' : 'Lean4 / Agda / Coq'}</div>
          <div class="col-content">${renderCompCol(level.comparison.others || level.comparison.math || level.comparison.lean4 || '')}</div>
        </div>
        <div class="comparison-col">
          <div class="col-label">Cella</div>
          <div class="col-content">${renderCompCol(level.comparison.cella || '')}</div>
        </div>
      </div>
      ${level.comparison.diff ? `<div class="comparison-diff">→ ${level.comparison.diff}</div>` : ''}
    `;
  } else {
    tutorialComparison.style.display = 'none';
  }

  // Hint
  if (level.hint) {
    tutorialHint.style.display = '';
    tutorialHint.textContent = `💡 提示：${level.hint}`;
  } else {
    tutorialHint.style.display = 'none';
  }

  // Load code
  setSource(level.code);
  setOutput('', '');
}

// --- Check with tutorial awareness ---
async function handleCheck() {
  if (!wasmReady) return;
  const source = getSource();
  await ensureSnapshotFor(source);
  const result = await check(source);
  const isOk = result.includes('"ok":true');

  setOutput(formatCheckResult(result), isOk ? 'success' : 'error');

  // Auto-expand output panel when there's a result
  document.querySelector('.output-panel')?.classList.remove('collapsed');

  // Tutorial: mark level complete on success
  if (isOk && currentMode === 'tutorial' && currentRoute && currentLevelIdx >= 0) {
    const level = currentLevels[currentLevelIdx];
    if (!isLevelCompleted(currentRoute.id, level.id)) {
      markLevelCompleted(currentRoute.id, level.id);
      renderLevelsSidebar();

      // Congratulations
      const completed = (progress[currentRoute.id] || []).length;
      const total = currentLevels.length;
      if (completed === total) {
        setOutput(formatCheckResult(result) + '\n\n🎉 恭喜！你已完成這條路線的所有關卡！', 'success');
      } else {
        setOutput(formatCheckResult(result) + `\n\n✅ 過關！（${completed}/${total}）`, 'success');
      }
    }
  }
}

// --- F335：執行走統一的 wasm 後端 ---
// 程式編成 WasmGC 模組，由瀏覽器原生執行。宿主（`env.*` 匯入）與 `crates/wasm-backend/src/host.rs` 逐項對應。
// 在 Web Worker 裡跑：瀏覽器沒有步數計量，逾時就終止 Worker（無窮迴圈不凍住分頁）。
const RUN_TIMEOUT_MS = 10000;
const WASM_ERRORS = {
  3: 'this IO action is not supported by the wasm backend',
  4: 'no `main` definition',
  5: 'putStr: the value is not a closed string',
};
const WORKER_SRC = `
const ERRORS = ${JSON.stringify(WASM_ERRORS)};
const FFI = ['readFile', 'writeFile', 'getEnv', 'getArgs', 'exit'];
class Exit { constructor(code) { this.code = code; } }
onmessage = async (ev) => {
  const lines = [];
  let buf = '', cur = '', reg = [], args = [], error = null;
  const put = (s) => { reg = Array.from(s); return BigInt(reg.length); };
  const env = {
    put_nat: (n) => lines.push(n.toString()),
    error: (code) => { error = code; },
    put_char: (cp) => { buf += String.fromCodePoint(cp); },
    put_line: () => { lines.push(buf); buf = ''; },
    read_line: () => { reg = []; return -1n; },          // 瀏覽器沒有標準輸入：EOF（讀到空行）
    line_char: (i) => BigInt(reg[Number(i)]?.codePointAt(0) ?? 0),
    read_nat: () => 0n,                                   // 回傳大數（BigInt）；瀏覽器沒有標準輸入：0
    // F337：超過 i64 的 Nat——BigInt，約定與 homotopy::nat::compute 相同（減法截斷、除以 0 得 0、對 0 取餘得原數）
    big_op: (op, a, b) => [a + b, a >= b ? a - b : 0n, a * b, b === 0n ? 0n : a / b, b === 0n ? a : a % b][op],
    big_cmp: (op, a, b) => ((op === 0 ? a === b : op === 1 ? a < b : a <= b) ? 1 : 0),
    big_from: (n) => BigInt.asUintN(64, n),
    big_small: (a) => (a <= 0x7fffffffffffffffn ? a : -1n),
    put_big: (a) => lines.push(a.toString()),
    big_lit: () => { const n = BigInt(cur); cur = ''; return n; },
    str_char: (cp) => { cur += String.fromCodePoint(cp); },
    str_end: () => { args.push(cur); cur = ''; },
    ffi: (i) => {
      const a = args; args = [];
      switch (FFI[i]) {
        case 'readFile': case 'writeFile': return -put(a[0] + ': no file system in the playground') - 1n;
        case 'getEnv': return -1n;
        case 'getArgs': return 0n;
        default: return -put('unknown IO primitive') - 1n;
      }
    },
    prog_arg: () => put(''),
    exit: (code) => { throw new Exit(Number(code)); },
  };
  try {
    const { instance } = await WebAssembly.instantiate(ev.data, { env });
    instance.exports._start();
    postMessage({ lines });
  } catch (e) {
    if (e instanceof Exit) postMessage({ lines, exit: e.code });
    else postMessage({ lines, error: error !== null ? (ERRORS[error] || 'error ' + error) : String(e) });
  }
};`;
const workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));

function runWasm(bytes) {
  return new Promise((resolve) => {
    const w = new Worker(workerUrl);
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ lines: [], error: `執行超過 ${RUN_TIMEOUT_MS / 1000} 秒，已停止` });
    }, RUN_TIMEOUT_MS);
    w.onmessage = (ev) => { clearTimeout(timer); w.terminate(); resolve(ev.data); };
    w.onerror = (ev) => { clearTimeout(timer); w.terminate(); resolve({ lines: [], error: ev.message }); };
    w.postMessage(bytes);
  });
}

/// 檢查（判決照舊）→ 編成 wasm → 在 Worker 裡執行。回傳與舊的 `run` 相同形狀的 JSON（`formatRunResult` 吃的）。
async function runProgram(source) {
  const checked = JSON.parse(await check(source));
  if ((checked.errors || []).length > 0) return JSON.stringify(checked);
  let bytes;
  try {
    bytes = await compile_wasm(source);
  } catch (e) {
    const msg = String(e?.message ?? e);
    try {
      const j = JSON.parse(msg);
      if (j.refused) return JSON.stringify({ ok: false, errors: j.refused.map(m => ({ message: 'cannot run: ' + m })) });
      return msg;
    } catch { return JSON.stringify({ ok: false, errors: [{ message: msg }] }); }
  }
  const r = await runWasm(bytes);
  if (r.error) {
    return JSON.stringify({ ok: false, errors: [{ message: 'runtime error: ' + r.error }], output: r.lines.join('\n') });
  }
  return JSON.stringify({ ...checked, ok: true, output: r.lines.length ? r.lines.join('\n') + '\n' : '' });
}

// --- Button handlers ---
btnCheck.addEventListener('click', handleCheck);

btnRun.addEventListener('click', async () => {
  if (!wasmReady) return;
  const source = getSource();
  await ensureSnapshotFor(source);
  const result = await runProgram(source);
  const isOk = result.includes('"ok":true');
  setOutput(formatRunResult(result), isOk ? 'success' : 'error');
  document.querySelector('.output-panel')?.classList.remove('collapsed');

  // Also mark tutorial complete on Run success
  if (isOk && currentMode === 'tutorial' && currentRoute && currentLevelIdx >= 0) {
    const level = currentLevels[currentLevelIdx];
    if (!isLevelCompleted(currentRoute.id, level.id)) {
      markLevelCompleted(currentRoute.id, level.id);
      renderLevelsSidebar();
    }
  }
});

btnInspect.addEventListener('click', async () => {
  await ensureSnapshotFor(getSource());
  // F319：你寫的每個定義展開成什麼——型別、elaborate 後的本體（隱式參數、記號、字面量、match 都展開）、
  // 資料值再算到正規形（⇝）
  try {
    setOutput(await inspect(getSource()), 'info');
  } catch (e) {
    setOutput('Failed: ' + e.message, 'error');
  }
});

btnHome.addEventListener('click', showRouteSelect);
btnFree.addEventListener('click', enterFreeMode);

// --- Collapsible sections ---
document.querySelectorAll('.collapse-header').forEach(header => {
  header.addEventListener('click', () => {
    const parent = header.parentElement;
    parent.classList.toggle('collapsed');
  });
});

// --- Symbol buttons ---
document.querySelectorAll('.sym-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sym = btn.dataset.sym;
    if (editor && editor.dispatch) {
      const pos = editor.state.selection.main.head;
      editor.dispatch({ changes: { from: pos, insert: sym } });
      editor.focus();
    }
  });
});

// --- Free mode examples ---
async function loadExamples() {
  try {
    const resp = await fetch('examples.json');
    if (!resp.ok) return;
    const examples = await resp.json();
    renderExamples(examples);
  } catch {}
}

function renderExamples(examples) {
  const levels = {};
  for (const ex of examples) {
    if (!levels[ex.level]) levels[ex.level] = [];
    levels[ex.level].push(ex);
  }
  sidebarContent.innerHTML = '';
  for (const [level, items] of Object.entries(levels).sort()) {
    const group = document.createElement('div');
    group.className = 'example-group';
    group.innerHTML = `<h3>${level}</h3>`;
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'example-item';
      btn.textContent = item.name;
      btn.title = item.description || '';
      btn.addEventListener('click', () => {
        setSource(item.code);
        setOutput(`Loaded: ${item.name}`, 'info');
      });
      group.appendChild(btn);
    }
    sidebarContent.appendChild(group);
  }
}

// --- Route selection ---
async function initRouteSelect() {
  try {
    const resp = await fetch('tutorials/routes.json');
    if (!resp.ok) return;
    const routes = await resp.json();
    const container = document.getElementById('route-cards');
    container.innerHTML = '';
    for (const route of routes) {
      const card = document.createElement('div');
      card.className = 'route-card';
      const completed = (progress[route.id] || []).length;
      const progressText = completed > 0 ? `<div style="font-size:0.7rem;color:#a6adc8;margin-top:0.5rem">進度：${completed} 關完成</div>` : '';
      card.innerHTML = `
        <div class="icon">${route.icon}</div>
        <div class="name">${route.name}</div>
        <div class="subtitle">${route.subtitle}</div>
        ${progressText}
      `;
      card.addEventListener('click', () => enterTutorial(route.id));
      container.appendChild(card);
    }
  } catch {}
}

document.getElementById('btn-free-mode').addEventListener('click', enterFreeMode);

// --- Init ---
const DEFAULT_SOURCE = `-- Cella Playground
-- 在這裡輸入程式碼，然後點 Check 或 Run。
-- 符號提示：== 等於 ≡，-> 等於 →，* 等於 ×

def id (A : Type) (a : A) : A := a
`;

async function main() {
  // 1. Init WASM
  try {
    await loadCellaLang();
    wasmReady = true;
    btnCheck.disabled = false;
    btnRun.disabled = false;
    btnInspect.disabled = false;
  } catch (e) {
    setStatus('WASM load failed: ' + e.message, 'error');
    return;
  }

  // 2. Init stdlib — snapshot first, sources as fallback.
  //
  // 只從快照還原（wasm 不帶原始碼，沒有從原始碼 elaborate 的退路）。
  try {
    let defCount = 0;
    let fromCache = false;
    try {
      // 在 Worker 裡下載並還原（F339）：主執行緒在這期間照常回應
      defCount = await rpc('__stdlib', absolute(ASSET_BASE + 'stdlib.cell'));
      fromCache = defCount > 0;
    } catch (e) {
      console.error('stdlib.cell failed to load', e);
    }
    if (fromCache) {
      stdlibLoaded = true;
      setStatus(`Ready (stdlib: ${defCount} defs)`, 'loaded');
    } else {
      setStatus('stdlib 載入失敗（請重新整理）', 'error');
    }
  } catch (e) {
    setStatus('Ready (stdlib init failed)', 'error');
  }

  // 3. Init editor — CodeMirror on desktop, textarea on mobile
  let isMobile = window.innerWidth <= 768;

  if (!isMobile) {
    try {
      // F319：CodeMirror 6 打包成本地的單一檔案（tools/playground-vendor）。⚠️ 從 CDN 分別載入各模組會載入兩份
      // @codemirror/state（各套件以不同的版本範圍引用它），lint／hover 擴充因此報「Unrecognized extension value」。
      const { basicSetup, EditorState, EditorView, hoverTooltip, linter, lintGutter, oneDark } = await import('./vendor/codemirror.js');
      const editorHeight = EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      });
      editor = new EditorView({
        state: EditorState.create({
          doc: DEFAULT_SOURCE,
          extensions: [basicSetup, oneDark, editorHeight, ...ideExtensions({ EditorView, hoverTooltip, linter, lintGutter })],
        }),
        parent: editorEl,
      });
    } catch {
      isMobile = true; // fallback to textarea
    }
  }

  if (isMobile || !editor) {
    // Mobile or fallback: plain textarea (reliable on all devices)
    const ta = document.createElement('textarea');
    ta.className = 'mobile-editor';
    ta.value = DEFAULT_SOURCE;
    ta.spellcheck = false;
    ta.autocapitalize = 'off';
    ta.autocomplete = 'off';
    editorEl.appendChild(ta);
    editor = {
      state: {
        doc: { toString: () => ta.value, length: ta.value.length },
        selection: { main: { head: ta.selectionStart || 0 } },
      },
      dispatch: ({ changes }) => {
        if (changes.insert !== undefined) ta.value = changes.insert;
      },
      focus: () => ta.focus(),
    };
  }

  // 4. Init route selection
  await initRouteSelect();

  // 5. Show route select screen
  showRouteSelect();
}

main();
