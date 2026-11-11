// DOM chessboard: animated pieces, click- or drag-to-move with legal-move
// hints (chess.js), promotion picker, arrows, and move-quality effects.
import { Chess } from 'chess.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';
const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

function parseFen(fen) {
  const out = [];
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      out.push({ square: FILES[f] + (8 - r), type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' });
      f++;
    }
  });
  return out;
}

export function createBoard(host, opts = {}) {
  let orientation = opts.orientation || 'white';
  let fen = null;
  let movable = opts.movable || null;     // 'w' | 'b' | 'both' | null — who may move
  let onMove = opts.onMove || null;       // ({from,to,promotion}) => void
  let selected = null;
  let pieces = [];                        // [{el, square, type, color}]
  let drag = null;

  host.classList.add('cb');
  host.innerHTML = `
    <div class="cb-squares">${Array.from({ length: 64 }, () => '<div class="cb-sq"></div>').join('')}</div>
    <div class="cb-marks"></div>
    <div class="cb-pieces"></div>
    <svg class="cb-arrows" viewBox="0 0 8 8" aria-hidden="true">
      <defs>${['best', 'alt', 'user'].map((t) => `<marker id="cbh-${t}-${host.id || 'x'}" class="cb-head ${t}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker>`).join('')}</defs>
    </svg>
    <div class="cb-fx"></div>
    <div class="cb-promo" hidden></div>`;
  const sqLayer = host.querySelector('.cb-squares');
  const markLayer = host.querySelector('.cb-marks');
  const pieceLayer = host.querySelector('.cb-pieces');
  const arrowLayer = host.querySelector('.cb-arrows');
  const fxLayer = host.querySelector('.cb-fx');
  const promo = host.querySelector('.cb-promo');
  host.setAttribute('role', 'img');

  const xy = (square) => {
    const f = FILES.indexOf(square[0]), r = Number(square[1]) - 1;
    return orientation === 'white' ? [f, 7 - r] : [7 - f, r];
  };
  const squareAt = (x, y) => (orientation === 'white' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1));
  const place = (el, square) => { const [x, y] = xy(square); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; };

  function paintSquares() {
    [...sqLayer.children].forEach((el, i) => {
      const x = i % 8, y = Math.floor(i / 8);
      const sq = squareAt(x, y);
      el.className = `cb-sq ${(x + y) % 2 ? 'dark' : 'light'}`;
      el.dataset.square = sq;
      el.innerHTML = `${x === 0 ? `<span class="cb-rank">${sq[1]}</span>` : ''}${y === 7 ? `<span class="cb-file">${sq[0]}</span>` : ''}`;
    });
  }

  function makePiece(p) {
    const el = document.createElement('div');
    el.className = `cb-pc ${p.color === 'w' ? 'white' : 'black'}`;
    // Inner span carries scale/rotate effects: on the outer element they'd
    // compose with the positioning translate and move the piece.
    el.innerHTML = `<span class="g">${GLYPH[p.type]}︎</span>`;
    el.setAttribute('aria-label', `${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]} ${p.square}`);
    return el;
  }

  /** Show `nextFen`. Pieces glide from their old squares when `animate`. */
  function setPosition(nextFen, o = {}) {
    const animate = o.animate !== false && fen !== null;
    fen = nextFen;
    const target = parseFen(nextFen);
    const old = pieces.slice();
    const next = [];
    // 1. same piece already on the square → keep
    for (const t of target) {
      const i = old.findIndex((p) => p.square === t.square && p.type === t.type && p.color === t.color);
      if (i >= 0) { next.push(old[i]); old.splice(i, 1); t.done = true; }
    }
    // 2. the moved piece (and castling rook): nearest old piece of the same kind
    for (const t of target.filter((x) => !x.done)) {
      let best = -1, bestD = Infinity;
      const [tx, ty] = xy(t.square);
      old.forEach((p, i) => {
        if (p.color !== t.color) return;
        if (p.type !== t.type && !(o.promotion && p.type === 'p' && t.square === o.lastMove?.to)) return;
        const [px, py] = xy(p.square);
        const d = Math.hypot(px - tx, py - ty);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) {
        const p = old.splice(best, 1)[0];
        if (p.type !== t.type) { p.el.firstChild.textContent = GLYPH[t.type] + '︎'; p.type = t.type; }
        p.square = t.square;
        p.el.classList.toggle('instant', !animate);
        place(p.el, t.square);
        next.push(p);
      } else {
        const el = makePiece(t);
        el.classList.add('instant');
        place(el, t.square);
        if (animate) el.classList.add('appear');
        pieceLayer.appendChild(el);
        next.push({ el, ...t });
      }
    }
    // 3. captured / gone
    for (const p of old) {
      if (animate) { p.el.classList.add('vanish'); setTimeout(() => p.el.remove(), 260); } else p.el.remove();
    }
    pieces = next;
    for (const p of pieces) {
      p.el.setAttribute('aria-label', `${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]} ${p.square}`);
      if (!animate) requestAnimationFrame(() => p.el.classList.remove('instant'));
      else p.el.classList.remove('instant');
    }
    selected = null;
    marks(o);
    setArrows(o.arrows || []);
    host.setAttribute('aria-label', o.label || 'Chess board');
  }

  function marks(o = {}) {
    const html = [];
    if (o.lastMove) for (const sq of [o.lastMove.from, o.lastMove.to]) html.push(markHtml(sq, 'last'));
    if (o.tone && o.lastMove) html.push(markHtml(o.lastMove.to, `tone ${o.tone}`));
    if (fen) {
      const c = new Chess(fen);
      if (c.inCheck()) {
        const king = parseFen(fen).find((p) => p.type === 'k' && p.color === c.turn());
        if (king) html.push(markHtml(king.square, 'check'));
      }
    }
    if (o.badge && o.lastMove) {
      const [x, y] = xy(o.lastMove.to);
      html.push(`<div class="cb-badge ${o.badge.tone}" style="left:${(x + 1) * 12.5}%;top:${y * 12.5}%" title="${o.badge.label}">${o.badge.symbol}</div>`);
    }
    markLayer.innerHTML = html.join('');
    lastMarks = o;
  }
  let lastMarks = {};
  const markHtml = (sq, cls) => { const [x, y] = xy(sq); return `<div class="cb-mark ${cls}" style="left:${x * 12.5}%;top:${y * 12.5}%"></div>`; };

  function setArrows(list) {
    arrowLayer.querySelectorAll('line').forEach((l) => l.remove());
    for (const a of list) {
      const [x1, y1] = xy(a.from), [x2, y2] = xy(a.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1 + 0.5); line.setAttribute('y1', y1 + 0.5);
      line.setAttribute('x2', x2 + 0.5 - (dx / len) * 0.32); line.setAttribute('y2', y2 + 0.5 - (dy / len) * 0.32);
      line.setAttribute('class', `cb-arrow ${a.tone || 'best'}`);
      line.setAttribute('marker-end', `url(#cbh-${a.tone || 'best'}-${host.id || 'x'})`);
      arrowLayer.appendChild(line);
    }
  }

  /** One-shot effect on a square: brilliant | great | best | excellent | good | inaccuracy | mistake | blunder */
  function effect(square, tone) {
    if (!square || !tone) return;
    const [x, y] = xy(square);
    const el = document.createElement('div');
    el.className = `cb-effect fx-${tone}`;
    el.style.left = `${x * 12.5}%`; el.style.top = `${y * 12.5}%`;
    if (tone === 'brilliant' || tone === 'great') {
      el.innerHTML = '<i></i><i></i>' + Array.from({ length: 10 }, (_, i) => `<b style="--a:${i * 36}deg"></b>`).join('');
    } else el.innerHTML = '<i></i>';
    fxLayer.appendChild(el);
    const piece = pieces.find((p) => p.square === square);
    if (piece) {
      const el = piece.el;
      el.classList.remove('lift', 'shake'); void el.offsetWidth;
      el.classList.add(tone === 'blunder' || tone === 'mistake' ? 'shake' : 'lift');
      el.addEventListener('animationend', () => el.classList.remove('lift', 'shake'), { once: true });
    }
    if (tone === 'blunder') { host.classList.remove('jolt'); void host.offsetWidth; host.classList.add('jolt'); }
    setTimeout(() => el.remove(), 1400);
  }

  // ---- interaction --------------------------------------------------------
  const canMove = (color) => movable && (movable === 'both' || movable === color) && fen && new Chess(fen).turn() === color;

  function showTargets(from) {
    const legal = new Chess(fen).moves({ square: from, verbose: true });
    const html = [markHtml(from, 'sel'), ...legal.map((m) => markHtml(m.to, m.captured ? 'target cap' : 'target'))];
    markLayer.innerHTML = markLayer.innerHTML.replace(/<div class="cb-mark (sel|target)[^"]*"[^>]*><\/div>/g, '') + html.join('');
    return legal;
  }
  function clearSel() { selected = null; marks(lastMarks); setArrows(lastArrows); }
  let lastArrows = [];
  const _setArrows = setArrows;

  async function tryMove(from, to) {
    const legal = new Chess(fen).moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!legal.length) return false;
    let promotion;
    if (legal[0].promotion) {
      promotion = await pickPromotion(to, legal[0].color);
      if (!promotion) { clearSel(); return true; }
    }
    selected = null;
    onMove?.({ from, to, promotion });
    return true;
  }

  function pickPromotion(square, color) {
    return new Promise((resolve) => {
      const [x] = xy(square);
      promo.innerHTML = `<div class="cb-promo-box" style="left:${x * 12.5}%">${['q', 'r', 'b', 'n'].map((t) =>
        `<button type="button" data-p="${t}" class="cb-pc static ${color === 'w' ? 'white' : 'black'}" aria-label="Promote to ${NAMES[t]}">${GLYPH[t]}︎</button>`).join('')}</div>`;
      promo.hidden = false;
      const done = (v) => { promo.hidden = true; promo.onclick = null; resolve(v); };
      promo.onclick = (e) => { const b = e.target.closest('[data-p]'); done(b ? b.dataset.p : null); };
    });
  }

  const pointSquare = (e) => {
    const r = host.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 8), y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    return x >= 0 && x < 8 && y >= 0 && y < 8 ? squareAt(x, y) : null;
  };

  host.addEventListener('pointerdown', (e) => {
    if (!movable || !promo.hidden || e.button > 0) return;
    const sq = pointSquare(e);
    if (!sq) return;
    if (selected && selected !== sq) {
      const from = selected;
      tryMove(from, sq).then((ok) => { if (!ok) startSelect(e, sq); });
      return;
    }
    startSelect(e, sq);
  });

  function startSelect(e, sq) {
    const p = pieces.find((x) => x.square === sq);
    if (!p || !canMove(p.color)) { if (selected) clearSel(); return; }
    selected = sq;
    showTargets(sq);
    const r = host.getBoundingClientRect();
    drag = { piece: p, startX: e.clientX, startY: e.clientY, size: r.width / 8, rect: r, moved: false };
    host.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const el = drag.piece.el;
    el.classList.add('dragging');
    const x = (e.clientX - drag.rect.left) / drag.size - 0.5, y = (e.clientY - drag.rect.top) / drag.size - 0.5;
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  });

  host.addEventListener('pointerup', async (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    d.piece.el.classList.remove('dragging');
    if (!d.moved) return; // a click: keep the selection for click-to-move
    const to = pointSquare(e);
    place(d.piece.el, d.piece.square);
    if (to && to !== d.piece.square) {
      d.piece.el.classList.add('instant');
      const ok = await tryMove(d.piece.square, to);
      requestAnimationFrame(() => d.piece.el.classList.remove('instant'));
      if (!ok) clearSel();
    }
  });
  host.addEventListener('pointercancel', () => { if (drag) { place(drag.piece.el, drag.piece.square); drag.piece.el.classList.remove('dragging'); drag = null; } });

  paintSquares();

  return {
    set: (f, o = {}) => { lastArrows = o.arrows || []; setPosition(f, o); },
    effect,
    flip() {
      orientation = orientation === 'white' ? 'black' : 'white';
      paintSquares();
      for (const p of pieces) place(p.el, p.square);
      marks(lastMarks); _setArrows(lastArrows);
      return orientation;
    },
    get orientation() { return orientation; },
    setMovable(v) { movable = v; if (!v) clearSel(); },
    setOnMove(fn) { onMove = fn; },
    get fen() { return fen; },
  };
}
