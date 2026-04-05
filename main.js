// Cella Playground — main.js
// Loads WASM module, wires editor and buttons.

import init, { check, run, init_stdlib, dump_celc } from './pkg/playground_wasm.js';

// --- State ---
let editor = null;       // CodeMirror EditorView
let wasmReady = false;
let stdlibLoaded = false;

// --- DOM refs ---
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const btnCheck = document.getElementById('btn-check');
const btnRun = document.getElementById('btn-run');
const btnInspect = document.getElementById('btn-inspect');
const editorEl = document.getElementById('editor');
const examplesListEl = document.getElementById('examples-list');

// --- Output helpers ---
function setOutput(text, cls = '') {
  outputEl.textContent = text;
  outputEl.className = cls;
}

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}

function getSource() {
  if (editor) return editor.state.doc.toString();
  return '';
}

function setSource(text) {
  if (editor) {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text }
    });
  }
}

// --- Format results ---
function formatCheckResult(json) {
  try {
    const result = JSON.parse(json);
    if (result.ok) {
      const defs = result.defs || [];
      return `✓ ${defs.length} definition${defs.length !== 1 ? 's' : ''} checked: ${defs.join(', ')}`;
    } else {
      const errors = result.errors || [];
      return errors.map(e => `✗ ${e.message}`).join('\n');
    }
  } catch (e) {
    return json;
  }
}

function formatRunResult(json) {
  try {
    const result = JSON.parse(json);
    if (result.ok) {
      const out = result.output || '';
      const defs = result.defs || [];
      let text = `✓ ${defs.length} definition${defs.length !== 1 ? 's' : ''} checked\n`;
      if (out) text += `\n--- Output ---\n${out}`;
      else text += '\n(no output)';
      return text;
    } else {
      const errors = result.errors || [];
      return errors.map(e => `✗ ${e.message}`).join('\n');
    }
  } catch (e) {
    return json;
  }
}

// --- Button handlers ---
btnCheck.addEventListener('click', () => {
  if (!wasmReady) return;
  const source = getSource();
  const result = check(source);
  const isOk = result.includes('"ok":true');
  setOutput(formatCheckResult(result), isOk ? 'success' : 'error');
});

btnRun.addEventListener('click', () => {
  if (!wasmReady) return;
  const source = getSource();
  const result = run(source);
  const isOk = result.includes('"ok":true');
  setOutput(formatRunResult(result), isOk ? 'success' : 'error');
});

btnInspect.addEventListener('click', async () => {
  try {
    const resp = await fetch('stdlib.celc');
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      setOutput(dump_celc(bytes), 'info');
    } else {
      setOutput('No stdlib.celc available. Run stdlib-cache to generate it.', 'info');
    }
  } catch (e) {
    setOutput('Failed to load stdlib.celc: ' + e.message, 'error');
  }
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

// --- Examples ---
async function loadExamples() {
  try {
    const resp = await fetch('examples.json');
    if (!resp.ok) return;
    const examples = await resp.json();
    renderExamples(examples);
  } catch (e) {
    // examples.json not available yet — that's ok
  }
}

function renderExamples(examples) {
  const levels = {};
  for (const ex of examples) {
    if (!levels[ex.level]) levels[ex.level] = [];
    levels[ex.level].push(ex);
  }
  examplesListEl.innerHTML = '';
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
    examplesListEl.appendChild(group);
  }
}

// --- Init ---
const DEFAULT_SOURCE = `-- Cella Playground
-- 在這裡輸入程式碼，然後點 Check 或 Run。
-- 符號提示：== 等於 ≡，-> 等於 →，* 等於 ×
-- 也可以用上方的符號按鈕插入特殊字元。

def id (A : Type) (a : A) : A := a

-- 試試看：點 Check 驗證型別！
`;

async function main() {
  // 1. Init WASM
  try {
    await init();
    wasmReady = true;
    btnCheck.disabled = false;
    btnRun.disabled = false;
    btnInspect.disabled = false;
    setStatus('Ready', 'loaded');
  } catch (e) {
    setStatus('WASM load failed: ' + e.message, 'error');
    setOutput('Failed to load WASM module: ' + e.message, 'error');
    return;
  }

  // 2. Init CodeMirror
  try {
    const { EditorView, basicSetup } = await import('https://esm.sh/@codemirror/basic-setup@0.20.0');
    const { EditorState } = await import('https://esm.sh/@codemirror/state@6');
    const { oneDark } = await import('https://esm.sh/@codemirror/theme-one-dark@6');

    editor = new EditorView({
      state: EditorState.create({
        doc: DEFAULT_SOURCE,
        extensions: [basicSetup, oneDark],
      }),
      parent: editorEl,
    });
  } catch (e) {
    // Fallback: use a simple textarea
    const ta = document.createElement('textarea');
    ta.style.cssText = 'width:100%;height:100%;background:#1e1e2e;color:#cdd6f4;border:none;padding:0.5rem;font:inherit;resize:none;';
    ta.value = DEFAULT_SOURCE;
    editorEl.appendChild(ta);
    editor = {
      state: { doc: { toString: () => ta.value, length: ta.value.length } },
      dispatch: ({ changes }) => { ta.value = changes.insert; }
    };
  }

  // 3. Init stdlib (embedded in WASM module)
  try {
    const defCount = init_stdlib();
    if (defCount > 0) {
      stdlibLoaded = true;
      setStatus(`Ready (stdlib: ${defCount} defs)`, 'loaded');
    } else {
      setStatus('Ready (no stdlib)', '');
    }
  } catch (e) {
    setStatus('Ready (stdlib init failed)', 'error');
  }

  // 4. Load examples
  await loadExamples();
}

main();
