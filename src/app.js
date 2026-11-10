import { createGame, stepGame, addRoad, removeRoad, applyUpgrade, serializeGame, restoreGame } from './engine.js';
import { Board } from './board.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'little-roads-save-v1';
const BEST_KEY = 'little-roads-best-v1';
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } },
};
let saved = restoreGame(storage.get(SAVE_KEY));
let state = saved || createGame(Date.now() >>> 0);
let best = Number(storage.get(BEST_KEY)) || 0;
let paused = true;
let started = false;
let speed = 1;
let tool = 'road';
let grid = true;
let sound = false;
let audio;
let modalKind = '';
let previousFocus;
let history = [];
let stroke = [];
let lastTime = performance.now();
let saveTime = 0;
let uiTime = 0;
let toastTimer;
let lastToast = '';
let lastMessage = state.message || '';

function toast(message) {
  if (!message) return;
  if (lastToast === message && $('toast').classList.contains('visible')) return;
  lastToast = message;
  $('toast').textContent = message;
  $('toast').hidden = false;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').classList.remove('visible'); $('toast').hidden = true; }, 2800);
}

function playTone(frequency = 440) {
  if (!sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.13);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.15);
  } catch { sound = false; }
}

function roadAction(a, b, erase = false) {
  if (!started || modalKind || state.status === 'gameover') return;
  const result = erase ? removeRoad(state, a, b) : addRoad(state, a, b);
  if (result.ok && result.changed) {
    stroke.push({ a: { ...a }, b: { ...b }, erase });
    playTone(erase ? 220 : 360 + (stroke.length % 5) * 40);
    if (result.pending) toast('灰色道路等待車輛返家後，才會回收資源。');
    updateUI();
  } else if (!result.ok && result.reason && (!erase || result.reason !== '這裡沒有道路')) toast(result.reason);
  return result;
}

const board = new Board($('game-canvas'), {
  onRoad: (a, b) => roadAction(a, b),
  onErase: (a, b) => roadAction(a, b, true),
  onGestureEnd: () => {
    if (stroke.length) { history.push(stroke); history = history.slice(-30); stroke = []; save(); updateUI(); }
  },
  onMessage: toast,
  onViewChange: updateViewControls,
});
board.setState(state);
board.setGrid(grid);

function updateViewControls({ zoom }) {
  $('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  $('zoom-out-btn').disabled = Boolean(modalKind) || zoom <= 1.001;
  $('zoom-in-btn').disabled = Boolean(modalKind) || zoom >= 2.999;
}

function save() {
  if (!started) return;
  storage.set(SAVE_KEY, serializeGame(state));
  if (state.score > best) { best = state.score; storage.set(BEST_KEY, String(best)); }
}

function updateUI() {
  $('score-value').textContent = state.score.toLocaleString();
  $('week-value').textContent = String(state.week);
  const day = Math.min(6, Math.floor((state.elapsed % 60) / (60 / 7)));
  $('day-value').textContent = ['一', '二', '三', '四', '五', '六', '日'][day];
  $('roads-value').textContent = String(state.roadTiles);
  $('bridges-value').textContent = String(state.bridges);
  $('best-value').textContent = Math.max(best, state.score).toLocaleString();
  const status = !started ? '準備好，畫出你的第一條路。' : tool === 'pan' ? '單指移動地圖；雙指張開可放大。' : paused ? '時間暫停中，慢慢規劃你的道路。' : tool === 'erase' ? '拖曳拆除道路，回收資源。' : '從住宅拖曳到同色目的地。';
  $('status-text').textContent = status;
  $('pause-btn').setAttribute('aria-pressed', String(paused));
  $('pause-btn').setAttribute('aria-label', paused ? '繼續遊戲' : '暫停遊戲');
  $('pause-btn').setAttribute('title', paused ? '繼續遊戲（空白鍵）' : '暫停遊戲（空白鍵）');
  $('pause-btn').classList.toggle('is-paused', paused);
  $('pause-btn').querySelector('use')?.setAttribute('href', paused ? '#i-play' : '#i-pause');
  const pauseLabel = $('pause-btn').querySelector('.tool-label');
  if (pauseLabel) pauseLabel.textContent = paused ? '繼續' : '暫停';
  $('speed-btn').setAttribute('aria-label', `速度 ${speed} 倍，點擊切換`);
  $('speed-btn').setAttribute('aria-pressed', String(speed === 2));
  const speedLabel = $('speed-btn').querySelector('[data-speed]') || $('speed-btn').querySelector('.speed-value');
  if (speedLabel) speedLabel.textContent = `${speed}×`;
  $('speed-btn').dataset.speed = String(speed);
  $('road-btn').setAttribute('aria-pressed', String(tool === 'road'));
  $('erase-btn').setAttribute('aria-pressed', String(tool === 'erase'));
  $('pan-btn').setAttribute('aria-pressed', String(tool === 'pan'));
  updateViewControls(board.getView());
  $('grid-btn').setAttribute('aria-pressed', String(grid));
  $('sound-btn').setAttribute('aria-pressed', String(sound));
  $('sound-btn').setAttribute('aria-label', sound ? '關閉音效' : '開啟音效');
  $('undo-btn').disabled = Boolean(modalKind) || history.length === 0;
}

function showModal(kind, html) {
  board.cancelGesture();
  previousFocus = document.activeElement;
  modalKind = kind;
  $('modal-content').innerHTML = html;
  $('modal').hidden = false;
  $('modal').setAttribute('role', 'dialog');
  $('modal').setAttribute('aria-modal', 'true');
  $('modal').setAttribute('aria-labelledby', 'dialog-title');
  document.querySelectorAll('button').forEach(button => {
    if (!$('modal').contains(button)) { button.dataset.wasDisabled = String(button.disabled); button.disabled = true; }
  });
  requestAnimationFrame(() => $('modal').querySelector('button')?.focus());
}

function closeModal() {
  $('modal').hidden = true;
  modalKind = '';
  document.querySelectorAll('button[data-was-disabled]').forEach(button => {
    button.disabled = button.dataset.wasDisabled === 'true'; delete button.dataset.wasDisabled;
  });
  previousFocus?.focus();
  updateUI();
}

function begin(fresh = false) {
  if (fresh) { state = createGame(Date.now() >>> 0); board.setState(state); board.resetView(); selectTool('road'); history = []; stroke = []; lastMessage = state.message || ''; }
  started = true;
  paused = false;
  closeModal();
  save();
  toast(fresh || !saved ? '先試試連接青綠色住宅與目的地。' : '歡迎回來，你的小城還在這裡。');
  saved = null;
}

function welcome() {
  showModal('welcome', `<div class="modal-card welcome-card">
    <span class="modal-eyebrow">A LITTLE CITY. YOUR OWN RHYTHM.</span>
    <div class="welcome-art" aria-hidden="true"><span class="mini-home">⌂</span><span class="mini-road"></span><span class="mini-destination">●</span></div>
    <h2 id="dialog-title">小小道路，<br>連起一座城。</h2>
    <p>畫下道路，連接同色的住宅與目的地。<br>看車子出發，讓每一次日常順利抵達。</p>
    <div class="welcome-tips"><span>↗ 單指鋪路</span><span>⤢ 雙指縮放</span><span>Ⅱ 隨時暫停</span></div>
    <div class="modal-actions"><button class="primary-btn" id="begin-btn">${saved?.status === 'gameover' ? '查看上次結果' : saved ? '繼續我的小城' : '開始我的小城'} <span aria-hidden="true">↗</span></button>${saved ? '<button class="secondary-btn" id="new-btn">重新開始</button>' : ''}</div>
    <p class="modal-footnote">為指尖設計 · 建議直向遊玩 · 自動儲存進度</p>
  </div>`);
  $('begin-btn').onclick = () => begin(false);
  if ($('new-btn')) $('new-btn').onclick = () => begin(true);
}

function showHelp() {
  showModal('help', `<div class="modal-card"><span class="modal-eyebrow">HOW TO PLAY</span><h2 id="dialog-title">讓日常，流動起來。</h2>
    <ol class="help-steps"><li><strong>連接同色建築</strong><span>每戶有兩台車，可往各方向畫直線或斜線。拖曳連接同色目的地下方的停車場；有需求才會出發，每趟服務後返家。</span></li>
    <li><strong>留意等待需求</strong><span>目的地的圓點代表等待中的旅客。外圈越滿越危險，擁塞太久就會結束。</span></li>
    <li><strong>放大，畫得更精準</strong><span>雙指張開或捏合縮放，雙指拖曳平移。選「移動」可單指平移；回到「鋪路」繼續建設。點百分比回到全圖。</span></li>
    <li><strong>善用有限資源</strong><span>每段路花費一道路；跨河另需橋梁。拆除中的灰色路段，要等車輛返家才回收。</span></li>
    <li><strong>給城市留一點空間</strong><span>每週會出現新建築，並可選擇道路或橋梁補給。暫停時也能編輯道路。</span></li></ol>
    <p class="modal-footnote">電腦快捷鍵：空白鍵暫停 · R 鋪路 · E 拆除 · H 移動 · G 格線 · 0 全圖 · Ctrl / ⌘ Z 復原<br>iPhone 可從 Safari「分享 → 加入主畫面」啟動。</p>
    <div class="modal-actions"><button class="primary-btn" id="close-help">明白了，繼續規劃 ↗</button></div></div>`);
  $('close-help').onclick = closeModal;
}

function showUpgrade() {
  history = [];
  showModal('upgrade', `<div class="modal-card"><span class="modal-eyebrow">A NEW WEEK, NEW POSSIBILITIES</span><h2 id="dialog-title">迎接第 ${state.week + 1} 週，<br>小城長大了一點。</h2><p>做得好！選擇本週補給，為新的日常留出空間。</p>
  <div class="upgrade-options"><button class="upgrade-card" data-upgrade="roads"><span class="upgrade-symbol">╋</span><strong>更多道路</strong><span>＋12 道路</span></button><button class="upgrade-card" data-upgrade="bridge"><span class="upgrade-symbol">≋</span><strong>橋梁補給</strong><span>＋8 道路 · ＋1 橋梁</span></button></div></div>`);
  $('modal').querySelectorAll('[data-upgrade]').forEach(button => button.onclick = () => {
    const result = applyUpgrade(state, button.dataset.upgrade);
    if (result.ok) { closeModal(); save(); playTone(660); toast('補給抵達，繼續你的城市故事。'); }
  });
}

function showGameOver() {
  save();
  showModal('gameover', `<div class="modal-card"><span class="modal-eyebrow">EVERY ROAD TELLS A STORY</span><h2 id="dialog-title">這一站，<br>謝謝你的照顧。</h2><p>目的地的等待人數太多了。下一座小城，試試分流車輛、縮短旅程。</p><div class="result-score">${state.score.toLocaleString()}<span>趟順利抵達的日常</span></div><p>走過 ${state.week} 週 · 最佳紀錄 ${Math.max(best, state.score).toLocaleString()} 趟</p><div class="modal-actions"><button class="primary-btn" id="again-btn">再建一座小城 ↗</button></div></div>`);
  $('again-btn').onclick = () => begin(true);
}

function selectTool(next) { tool = next; board.setTool(next); updateUI(); }
function togglePause() { if (!started || modalKind) return; paused = !paused; updateUI(); save(); }
function undo() {
  if (modalKind || !started) return;
  const action = history.pop();
  if (!action) return;
  const remaining = [];
  for (const edge of [...action].reverse()) {
    const result = edge.erase ? addRoad(state, edge.a, edge.b) : removeRoad(state, edge.a, edge.b);
    if (!result.ok) remaining.unshift(edge);
  }
  if (remaining.length) history.push(remaining);
  updateUI(); save();
  toast(remaining.length ? '部分路段暫時無法復原，請確認資源與出入口。' : state.roads.some(road => road.pendingRemoval) ? '已復原上一筆道路編輯；灰色路段仍需等待車輛返家。' : '已復原上一筆道路編輯。');
}
$('road-btn').onclick = () => selectTool('road');
$('erase-btn').onclick = () => selectTool('erase');
$('pan-btn').onclick = () => selectTool(tool === 'pan' ? 'road' : 'pan');
$('zoom-in-btn').onclick = () => board.zoomBy(1.35);
$('zoom-out-btn').onclick = () => board.zoomBy(1 / 1.35);
$('reset-view-btn').onclick = () => board.resetView();
$('pause-btn').onclick = togglePause;
$('speed-btn').onclick = () => { speed = speed === 1 ? 2 : 1; updateUI(); toast(`時間速度：${speed} 倍`); };
$('grid-btn').onclick = () => { grid = !grid; board.setGrid(grid); updateUI(); };
$('undo-btn').onclick = undo;
$('help-btn').onclick = showHelp;
$('sound-btn').onclick = () => { sound = !sound; playTone(520); updateUI(); toast(sound ? '音效已開啟' : '音效已關閉'); };
$('restart-btn').onclick = () => {
  showModal('restart', '<div class="modal-card"><span class="modal-eyebrow">A FRESH START</span><h2 id="dialog-title">再建一座小城？</h2><p>目前的道路與進度將重新開始，最佳紀錄會保留。</p><div class="modal-actions"><button class="primary-btn" id="confirm-restart">重新開始</button><button class="secondary-btn" id="cancel-restart">回到我的小城</button></div></div>');
  $('confirm-restart').onclick = () => { save(); begin(true); };
  $('cancel-restart').onclick = closeModal;
};

document.addEventListener('keydown', event => {
  if (modalKind) {
    if (event.key === 'Escape' && ['help', 'restart'].includes(modalKind)) closeModal();
    if (event.key === 'Tab') {
      const buttons = [...$('modal').querySelectorAll('button')];
      const first = buttons[0]; const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (event.code === 'Space' && !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); togglePause(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
  else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key.toLowerCase() === 'r') selectTool('road');
    if (event.key.toLowerCase() === 'e') selectTool('erase');
    if (event.key.toLowerCase() === 'h') selectTool('pan');
    if (event.key === '0') board.resetView();
    if (event.key.toLowerCase() === 'g') $('grid-btn').click();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) board.cancelGesture({ releasePointers: true });
  if (document.hidden && started) { paused = true; save(); updateUI(); }
  lastTime = performance.now();
});
window.addEventListener('pagehide', () => { board.cancelGesture({ releasePointers: true }); save(); });

function frame(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  if (started && !paused && !modalKind && !document.hidden) {
    stepGame(state, dt * speed);
    if (state.message && state.message !== lastMessage) { lastMessage = state.message; toast(state.message); }
    if (state.status === 'upgrade') showUpgrade();
    if (state.status === 'gameover') showGameOver();
  }
  board.render(time);
  if (time - uiTime > 200) { updateUI(); uiTime = time; }
  if (time - saveTime > 5000) { save(); saveTime = time; }
  requestAnimationFrame(frame);
}
updateUI();
welcome();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
