// Game viewer: the board flies forward out of the card that opened it,
// the page behind blurs, and the game can be replayed move by move with
// quality effects (brilliant, best, blunder…) from the stored analysis.
// Any piece can be moved at any time to explore another line — no engine.
import './board.css';
import { createBoard } from './boardview.js';
import { parsePgn, addMove, pathTo, isMainline, mainlineOf } from './pgn.js';
import { classifyGame, accuracy, CLASSES, winPct } from './classify.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const RESULT_TEXT = { '1-0': '1 – 0', '0-1': '0 – 1', '1/2-1/2': '½ – ½', '+/-': '1 – 0 (forfeit)', '-/+': '0 – 1 (forfeit)', '0-0': 'double forfeit', '*': 'unfinished' };
const SUMMARY_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

let openInstance = null;

/**
 * game: { pgn, analysis_pgn, white, black, white_rating, black_rating, result, event, date, opening, external_url }
 * origin: element the tile grows out of (optional)
 */
export function openGameViewer(game, origin, onClose) {
  if (openInstance) openInstance.close(true);
  const source = game.analysis_pgn || game.pgn;
  let parsed = null, error = null;
  try { parsed = source ? parsePgn(source) : null; } catch (e) { error = e.message; }
  // Analysis exports sometimes miss the game's final moves — fall back to the plain PGN when longer.
  if (parsed && game.analysis_pgn && game.pgn) {
    try { const plain = parsePgn(game.pgn); if (plain.mainline.length > parsed.mainline.length + 1) parsed = plain; } catch { /* keep analysis */ }
  }
  const root = parsed?.root;
  const tally = root ? classifyGame(root) : { w: {}, b: {} };
  const acc = root ? accuracy(root) : {};
  const hasEval = root ? mainlineOf(root).some((n) => n.eval) : false;
  const h = parsed?.headers || {};
  const white = game.white || h.White || 'White', black = game.black || h.Black || 'Black';
  const result = game.result || h.Result || '*';

  const prevFocus = document.activeElement;
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.className = 'gv-overlay';
  overlay.innerHTML = `
    <div class="gv-stage">
      <div class="gv-tile" role="dialog" aria-modal="true" aria-label="${esc(`${white} vs ${black}`)}">
        <button class="gv-close" type="button" aria-label="Close game">✕</button>
        <div class="gv-boardcol">
          <div class="gv-player top"></div>
          <div class="gv-boardwrap">
            <div class="gv-evalbar" ${hasEval ? '' : 'hidden'}><div class="gv-evalfill"></div><span class="gv-evaltxt"></span></div>
            <div class="gv-board" id="gvBoard"></div>
          </div>
          <div class="gv-player bottom"></div>
          <div class="gv-controls">
            <button type="button" data-nav="start" aria-label="Start">⏮</button>
            <button type="button" data-nav="prev" aria-label="Previous move">◀</button>
            <button type="button" data-nav="play" aria-label="Auto-play">▶︎▶︎</button>
            <button type="button" data-nav="next" aria-label="Next move">▶</button>
            <button type="button" data-nav="end" aria-label="End">⏭</button>
            <button type="button" data-nav="flip" aria-label="Flip board">⇅</button>
          </div>
        </div>
        <div class="gv-side">
          <div class="gv-head">
            <p class="gv-eyebrow">${esc([game.event || h.Event, game.date || (h.Date || '').replace(/\./g, '-').replace(/-\?\?/g, '')].filter(Boolean).join(' · '))}</p>
            <h2>${esc(white)} <span class="gv-res">${esc(RESULT_TEXT[result] || result)}</span> ${esc(black)}</h2>
            <p class="gv-sub">${esc(game.opening || h.Opening || '')}${game.external_url ? ` · <a href="${esc(game.external_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</p>
          </div>
          ${hasEval ? summaryHtml(tally, acc, white, black) : `<p class="gv-note">${root ? 'No analysis attached yet — move quality appears once an analysed PGN is uploaded.' : ''}</p>`}
          <div class="gv-moves" tabindex="0" aria-label="Moves"></div>
          <div class="gv-comment" aria-live="polite"></div>
          <div class="gv-explore" hidden>
            <span>Exploring your own line</span>
            <button type="button" data-nav="back">↩ Back to game</button>
          </div>
          <p class="gv-hint">Move any piece to explore · ← → keys · Esc closes</p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const tile = overlay.querySelector('.gv-tile');
  const movesEl = overlay.querySelector('.gv-moves');
  const commentEl = overlay.querySelector('.gv-comment');
  const exploreEl = overlay.querySelector('.gv-explore');

  if (error || !root) {
    overlay.querySelector('.gv-boardwrap').innerHTML = `<p class="gv-error">${esc(error || 'No moves have been recorded for this game yet.')}</p>`;
    overlay.querySelector('.gv-controls').hidden = true;
  }

  const board = root ? createBoard(overlay.querySelector('#gvBoard'), { movable: 'both', onMove: explore }) : null;
  let current = root;
  let playTimer = null;

  function setPlayers() {
    const flipped = board?.orientation === 'black';
    const tag = (name, rating, color) => `<span class="gv-dot ${color}"></span><b>${esc(name)}</b>${rating ? ` <span>${esc(rating)}</span>` : ''}${acc[color[0]] != null ? `<em>${acc[color[0]]}% accuracy</em>` : ''}`;
    overlay.querySelector('.gv-player.top').innerHTML = flipped ? tag(white, game.white_rating || h.WhiteElo, 'white') : tag(black, game.black_rating || h.BlackElo, 'black');
    overlay.querySelector('.gv-player.bottom').innerHTML = flipped ? tag(black, game.black_rating || h.BlackElo, 'black') : tag(white, game.white_rating || h.WhiteElo, 'white');
  }

  function evalOf(node) {
    for (let n = node; n; n = n.parent) if (n.eval) return n.eval;
    return { cp: 0 };
  }

  function show(node, { fx = false } = {}) {
    current = node;
    const cls = node.cls ? CLASSES[node.cls] : null;
    const arrows = [];
    // For a weak move, point at the alternative the analysis gave (its first variation).
    if (node.parent && ['inaccuracy', 'mistake', 'blunder'].includes(node.cls)) {
      const alt = node.parent.children.find((c) => c !== node && !c.user);
      if (alt) arrows.push({ from: alt.from, to: alt.to, tone: 'best' });
    }
    board.set(node.fen, {
      lastMove: node.from ? { from: node.from, to: node.to } : null,
      tone: cls?.tone, badge: cls, arrows, promotion: !!node.promotion,
      label: node.san ? `Position after ${Math.floor((node.ply - 1) / 2) + 1}${node.color === 'w' ? '.' : '...'} ${node.san}` : 'Starting position',
    });
    if (fx && cls && !reduceMotion()) setTimeout(() => board.effect(node.to, cls.tone), 180);
    if (hasEval) {
      const ev = evalOf(node);
      const pct = winPct(ev);
      overlay.querySelector('.gv-evalfill').style.height = `${pct}%`;
      overlay.querySelector('.gv-evaltxt').textContent = ev.mate != null ? `M${Math.abs(ev.mate)}` : (Math.abs(ev.cp) / 100).toFixed(1);
      overlay.querySelector('.gv-evalbar').classList.toggle('black-better', pct < 50);
    }
    commentEl.innerHTML = node.comment || cls ? `${cls ? `<b class="tone-${cls.tone}">${esc(node.san)} — ${cls.label}</b> ` : ''}${esc(node.comment || '')}` : '';
    exploreEl.hidden = isMainline(node);
    renderMoves();
  }

  // ---- move list ----------------------------------------------------------
  function moveBtn(n, withNo) {
    const no = Math.floor((n.ply - 1) / 2) + 1;
    const cls = n.cls ? CLASSES[n.cls] : null;
    return `<button type="button" class="gv-mv${n === current ? ' on' : ''}${n.user ? ' user' : ''}${cls ? ` tone-${cls.tone}` : ''}" data-id="${n.id}">${withNo ? `<span class="no">${no}${n.color === 'w' ? '.' : '…'}</span>` : ''}${esc(n.san)}${cls && ['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'].includes(n.cls) ? `<sup>${cls.symbol}</sup>` : ''}</button>`;
  }
  // A side line: numbered at its first move, at white moves, and after nested lines.
  function lineHtml(start) {
    const parts = [];
    let n = start, numbered = true;
    while (n) {
      parts.push(moveBtn(n, numbered || n.color === 'w'));
      const nested = n.children.slice(1);
      for (const c of nested) parts.push(`<span class="gv-var">(${lineHtml(c)})</span>`);
      numbered = nested.length > 0;
      n = n.children[0];
    }
    return parts.join(' ');
  }
  function renderMoves() {
    if (!root) return;
    const rows = [];
    let n = root.children[0];
    while (n) {
      const w = n.color === 'w' ? n : null;
      const b = w ? w.children[0] : n;
      const no = Math.floor(((w || b).ply - 1) / 2) + 1;
      rows.push(`<div class="gv-row"><span class="no">${no}</span>${w ? moveBtn(w) : '<span class="gv-mv empty">…</span>'}${b ? moveBtn(b) : '<span></span>'}</div>`);
      const vars = [...(w ? w.parent.children.slice(1) : []), ...(b ? b.parent.children.slice(1) : [])];
      for (const v of vars) rows.push(`<div class="gv-varrow">${lineHtml(v)}</div>`);
      n = b ? b.children[0] : null;
    }
    movesEl.innerHTML = rows.join('') || '<p class="gv-note">No moves yet — move a piece to explore.</p>';
    movesEl.querySelector('.gv-mv.on')?.scrollIntoView({ block: 'nearest' });
  }

  const byId = (id) => { const walk = (n) => { if (n.id === id) return n; for (const c of n.children) { const f = walk(c); if (f) return f; } return null; }; return walk(root); };

  function explore(move) {
    stopPlay();
    const node = addMove(current, move, { user: true });
    if (node) show(node);
  }

  function nav(action) {
    if (!root) return;
    if (action !== 'play') stopPlay();
    if (action === 'next' && current.children[0]) show(current.children[0], { fx: true });
    else if (action === 'prev' && current.parent) show(current.parent);
    else if (action === 'start') show(root);
    else if (action === 'end') { let n = current; while (n.children[0]) n = n.children[0]; show(n); }
    else if (action === 'flip') { board.flip(); setPlayers(); }
    else if (action === 'back') { let n = current; while (n.parent && !isMainline(n)) n = n.parent; show(n); }
    else if (action === 'play') togglePlay();
  }
  function togglePlay() {
    if (playTimer) { stopPlay(); return; }
    if (!current.children[0]) show(root);
    overlay.querySelector('[data-nav="play"]').classList.add('on');
    playTimer = setInterval(() => { if (current.children[0]) show(current.children[0], { fx: true }); else stopPlay(); }, 1100);
  }
  function stopPlay() { clearInterval(playTimer); playTimer = null; overlay.querySelector('[data-nav="play"]')?.classList.remove('on'); }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('gv-stage') || e.target.closest('.gv-close')) { close(); return; }
    const b = e.target.closest('[data-nav]');
    if (b) { nav(b.dataset.nav); return; }
    const mv = e.target.closest('.gv-mv[data-id]');
    if (mv) { stopPlay(); const n = byId(Number(mv.dataset.id)); if (n) show(n, { fx: n.parent === current }); }
  });
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    const map = { ArrowRight: 'next', ArrowLeft: 'prev', ArrowUp: 'start', Home: 'start', ArrowDown: 'end', End: 'end', f: 'flip', ' ': 'play' };
    if (e.key === 'Escape') { close(); return; }
    if (map[e.key]) { e.preventDefault(); nav(map[e.key]); }
  };
  document.addEventListener('keydown', onKey);
  let wheelAt = 0;
  overlay.querySelector('.gv-boardwrap').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (Date.now() - wheelAt < 90) return;
    wheelAt = Date.now();
    nav(e.deltaY > 0 ? 'next' : 'prev');
  }, { passive: false });

  // ---- fly in / out ---------------------------------------------------------
  function fromOrigin() {
    if (!origin || !origin.isConnected) return null;
    const o = origin.getBoundingClientRect();
    if (o.bottom < 0 || o.top > innerHeight) return null;
    const t = tile.getBoundingClientRect();
    const sx = o.width / t.width, sy = o.height / t.height;
    const dx = o.left + o.width / 2 - (t.left + t.width / 2), dy = o.top + o.height / 2 - (t.top + t.height / 2);
    return `translate3d(${dx}px, ${dy}px, -260px) rotateX(38deg) scale(${Math.max(sx, 0.12)}, ${Math.max(sy, 0.12)})`;
  }
  function flyIn() {
    if (reduceMotion()) { overlay.classList.add('in'); return; }
    tile.style.transition = 'none';
    tile.style.transform = fromOrigin() || 'translate3d(0, 40px, -420px) rotateX(30deg) scale(0.6)';
    tile.style.opacity = '0.15';
    void tile.offsetWidth;
    overlay.classList.add('in');
    tile.style.transition = '';
    tile.style.transform = '';
    tile.style.opacity = '';
  }

  function close(instant) {
    stopPlay();
    document.removeEventListener('keydown', onKey);
    openInstance = null;
    onClose?.();
    const finish = () => {
      overlay.remove();
      document.documentElement.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
    if (instant || reduceMotion()) { finish(); return; }
    overlay.classList.remove('in');
    overlay.classList.add('out');
    tile.style.transform = fromOrigin() || 'translate3d(0, 30px, -380px) rotateX(24deg) scale(0.7)';
    tile.style.opacity = '0';
    setTimeout(finish, 520);
  }

  if (root) { setPlayers(); show(root); }
  flyIn();
  overlay.querySelector('.gv-close').focus({ preventScroll: true });
  openInstance = { close };
  return openInstance;
}

function summaryHtml(tally, acc, white, black) {
  const row = (key) => {
    const c = CLASSES[key];
    return `<div class="gv-sumrow tone-${c.tone}"><span class="n">${tally.w[key] || 0}</span><span class="lbl"><i>${c.symbol}</i>${c.label}</span><span class="n">${tally.b[key] || 0}</span></div>`;
  };
  return `<div class="gv-summary">
    <div class="gv-sumhead"><span>${esc(white)}${acc.w != null ? ` · ${acc.w}%` : ''}</span><span>${esc(black)}${acc.b != null ? ` · ${acc.b}%` : ''}</span></div>
    ${SUMMARY_ORDER.filter((k) => (tally.w[k] || 0) + (tally.b[k] || 0) > 0).map(row).join('')}
  </div>`;
}
