// Cella Playground — main.js
// Tutorial system + free mode

import init, { check, run, init_stdlib, dump_celc } from './pkg/playground_wasm.js';

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
  outputEl.className = cls;
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
  // First: extract and render tables
  let result = md.replace(/(\|.+\|[\n])+/g, (block) => {
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

  return result
    .replace(/```([^`]*)```/gs, '<pre class="md-codeblock">$1</pre>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n- /g, '<br>• ');
}

// --- Format results ---
function formatCheckResult(json) {
  try {
    const r = JSON.parse(json);
    if (r.ok) {
      const defs = r.defs || [];
      return `✓ ${defs.length} definition${defs.length !== 1 ? 's' : ''} checked: ${defs.join(', ')}`;
    } else {
      return (r.errors || []).map(e => `✗ ${e.message}`).join('\n');
    }
  } catch { return json; }
}

function formatRunResult(json) {
  try {
    const r = JSON.parse(json);
    if (r.ok) {
      const defs = r.defs || [];
      let text = `✓ ${defs.length} definition${defs.length !== 1 ? 's' : ''} checked\n`;
      const out = r.output || '';
      if (out) text += `\n--- Output ---\n${out}`;
      else text += '\n(no output)';
      return text;
    } else {
      return (r.errors || []).map(e => `✗ ${e.message}`).join('\n');
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
  currentLevels.forEach((level, idx) => {
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
          <div class="col-label">Lean4 / Agda / Coq</div>
          <div class="col-content">${renderCompCol(level.comparison.others)}</div>
        </div>
        <div class="comparison-col">
          <div class="col-label">Cella</div>
          <div class="col-content">${renderCompCol(level.comparison.cella)}</div>
        </div>
      </div>
      <div class="comparison-diff">→ ${level.comparison.diff}</div>
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
function handleCheck() {
  if (!wasmReady) return;
  const source = getSource();
  const result = check(source);
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

// --- Button handlers ---
btnCheck.addEventListener('click', handleCheck);

btnRun.addEventListener('click', () => {
  if (!wasmReady) return;
  const source = getSource();
  const result = run(source);
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
  try {
    const resp = await fetch('stdlib.celc');
    if (resp.ok) {
      const bytes = new Uint8Array(await resp.arrayBuffer());
      setOutput(dump_celc(bytes), 'info');
    } else {
      setOutput('No stdlib.celc available.', 'info');
    }
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
    await init();
    wasmReady = true;
    btnCheck.disabled = false;
    btnRun.disabled = false;
    btnInspect.disabled = false;
  } catch (e) {
    setStatus('WASM load failed: ' + e.message, 'error');
    return;
  }

  // 2. Init stdlib
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

  // 3. Init CodeMirror
  try {
    const { EditorView, basicSetup } = await import('https://esm.sh/@codemirror/basic-setup@0.20.0');
    const { EditorState } = await import('https://esm.sh/@codemirror/state@6');
    const { oneDark } = await import('https://esm.sh/@codemirror/theme-one-dark@6');

    // Set editor height via CodeMirror's theme API (CSS alone doesn't work on mobile)
    const isMobile = window.innerWidth <= 768;
    const editorHeight = EditorView.theme({
      "&": { height: isMobile ? "300px" : "100%" },
      ".cm-scroller": { overflow: "auto" },
    });

    editor = new EditorView({
      state: EditorState.create({
        doc: DEFAULT_SOURCE,
        extensions: [basicSetup, oneDark, editorHeight],
      }),
      parent: editorEl,
    });
  } catch {
    const ta = document.createElement('textarea');
    ta.style.cssText = 'width:100%;height:100%;background:#1e1e2e;color:#cdd6f4;border:none;padding:0.5rem;font:inherit;resize:none;';
    ta.value = DEFAULT_SOURCE;
    editorEl.appendChild(ta);
    editor = {
      state: { doc: { toString: () => ta.value, length: ta.value.length }, selection: { main: { head: ta.value.length } } },
      dispatch: ({ changes }) => { ta.value = changes.insert; },
      focus: () => ta.focus(),
    };
  }

  // 4. Init route selection
  await initRouteSelect();

  // 5. Show route select screen
  showRouteSelect();
}

main();
