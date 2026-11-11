// PGN ⇄ move tree. Keeps everything an analysis export carries:
// variations, comments, NAGs (!, ?, $1…), [%eval] and [%clk].
// chess.js validates every move, so an illegal move is reported with
// its move number instead of silently producing a broken game.
import { Chess } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SUFFIX_NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
export const NAG_SYMBOL = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };

let nextId = 1;

export function makeRoot(fen = START_FEN) {
  return { id: 0, ply: plyOf(fen), fen, parent: null, children: [], nags: [], comment: '', eval: null };
}

function plyOf(fen) {
  const [, turn, , , , full] = fen.split(' ');
  return (Number(full || 1) - 1) * 2 + (turn === 'b' ? 1 : 0);
}

/** Play `move` (SAN string or {from,to,promotion}) after `parent`; returns the new node (not attached). */
export function playFrom(parent, move) {
  const chess = new Chess(parent.fen);
  let m;
  try { m = chess.move(move); } catch { m = null; }
  if (!m) return null;
  return {
    id: nextId++, ply: parent.ply + 1, san: m.san, from: m.from, to: m.to, promotion: m.promotion,
    color: m.color, piece: m.piece, captured: m.captured, flags: m.flags,
    fen: chess.fen(), parent, children: [], nags: [], comment: '', eval: null, clock: null,
    check: chess.inCheck(), mate: chess.isCheckmate(),
  };
}

/** Add (or reuse) a child of `parent` for `move`. Returns the child node. */
export function addMove(parent, move, extra = {}) {
  const node = playFrom(parent, move);
  if (!node) return null;
  const existing = parent.children.find((c) => c.san === node.san);
  if (existing) return existing;
  Object.assign(node, extra);
  parent.children.push(node);
  return node;
}

function parseCommentCommands(text, node) {
  const ev = text.match(/\[%eval\s+([^\]\s]+)[^\]]*\]/);
  if (ev && node) {
    const v = ev[1];
    if (v.startsWith('#')) node.eval = { mate: Number(v.slice(1)) };
    else if (!Number.isNaN(Number(v))) node.eval = { cp: Math.round(Number(v) * 100) };
  }
  const clk = text.match(/\[%clk\s+([^\]\s]+)\]/);
  if (clk && node) node.clock = clk[1];
  return text.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseHeaders(text) {
  const headers = {};
  for (const m of text.matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2].replace(/\\(.)/g, '$1');
  return headers;
}

/**
 * Parse the first game in `text`. Returns { headers, root, mainline }.
 * Throws Error with a readable message on an illegal/unknown move.
 */
export function parsePgn(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const headers = parseHeaders(src);
  // Movetext = everything after the last header line of the first game.
  let body = src.replace(/^\s*\[\w+\s+"(?:[^"\\]|\\.)*"\]\s*$/gm, '');
  const fen = headers.FEN && headers.SetUp !== '0' ? headers.FEN : START_FEN;
  const root = makeRoot(fen);

  const tokenRe = /\{([^}]*)\}|;([^\n]*)|(\()|(\))|\$(\d+)|(1-0|0-1|1\/2-1\/2|½-½|\*)(?=\s|$|\))|(\d+)\s*\.(?:\s*\.\.)?|([^\s(){};$]+)/g;
  let cur = root;
  const stack = [];
  let m;
  let ended = false;
  while ((m = tokenRe.exec(body)) && !ended) {
    if (m[1] !== undefined || m[2] !== undefined) {
      const raw = m[1] ?? m[2];
      // A comment belongs to the move just played (or the start position).
      const clean = parseCommentCommands(raw, cur);
      if (clean) cur.comment = cur.comment ? `${cur.comment} ${clean}` : clean;
    } else if (m[3]) {
      if (!cur.parent) continue; // variation before any move: ignore
      stack.push(cur);
      cur = cur.parent;
    } else if (m[4]) {
      if (stack.length) cur = stack.pop();
    } else if (m[5]) {
      if (cur !== root) cur.nags.push(Number(m[5]));
    } else if (m[6]) {
      if (!stack.length) { if (!headers.Result || headers.Result === '*') headers.Result = m[6].replace('½-½', '1/2-1/2'); ended = true; }
    } else if (m[7]) {
      // move number
    } else if (m[8]) {
      let tok = m[8].replace(/^\d+\.+/, '');
      if (!tok) continue;
      const suffix = tok.match(/(!!|\?\?|!\?|\?!|!|\?)$/);
      if (suffix) tok = tok.slice(0, -suffix[1].length);
      tok = tok.replace(/[+#]+$/, '').replace(/^0-0(-0)?$/, (z) => z.replace(/0/g, 'O')).replace(/e\.p\.$/, '');
      if (!tok || tok === '--' || tok === 'Z0') continue;
      const node = addMove(cur, tok);
      if (!node) {
        const moveNo = Math.floor(cur.ply / 2) + 1;
        const dots = cur.ply % 2 === 0 ? '.' : '...';
        throw new Error(`Move ${moveNo}${dots} ${m[8]} is not legal in that position.`);
      }
      if (suffix) node.nags.push(SUFFIX_NAG[suffix[1]]);
      cur = node;
    }
  }
  return { headers, root, mainline: mainlineOf(root) };
}

export function mainlineOf(root) {
  const out = [];
  let n = root.children[0];
  while (n) { out.push(n); n = n.children[0]; }
  return out;
}

export function pathTo(node) {
  const out = [];
  for (let n = node; n && n.parent; n = n.parent) out.unshift(n);
  return out;
}

export function isMainline(node) {
  for (let n = node; n && n.parent; n = n.parent) if (n.parent.children[0] !== n) return false;
  return true;
}

const moveNo = (node, force) => {
  const no = Math.floor((node.ply - 1) / 2) + 1;
  if (node.color === 'w') return `${no}. `;
  return force ? `${no}... ` : '';
};

function evalTag(node) {
  if (!node.eval) return '';
  return node.eval.mate != null ? `[%eval #${node.eval.mate}]` : `[%eval ${(node.eval.cp / 100).toFixed(2)}]`;
}

/** Tree → PGN text. opts: { variations, comments } (both default true). */
export function toPgn(headers, root, opts = {}) {
  const { variations = true, comments = true } = opts;
  const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  const keys = [...order.filter((k) => headers[k] != null), ...Object.keys(headers).filter((k) => !order.includes(k))];
  const head = keys.map((k) => `[${k} "${String(headers[k]).replace(/["\\]/g, '\\$&')}"]`).join('\n');

  const parts = [];
  const emit = (node, force) => {
    parts.push(moveNo(node, force) + node.san + node.nags.map((n) => (n <= 6 ? NAG_SYMBOL[n] : ` $${n}`)).join(''));
    if (comments) {
      const c = [evalTag(node), node.clock ? `[%clk ${node.clock}]` : '', node.comment].filter(Boolean).join(' ');
      if (c) parts.push(`{ ${c} }`);
    }
  };
  const walk = (parent, forceFirst) => {
    let p = parent;
    let force = forceFirst;
    while (p.children.length) {
      const [main, ...alts] = p.children;
      emit(main, force);
      force = false;
      if (variations) {
        for (const alt of alts) {
          parts.push('(');
          emit(alt, true);
          walk(alt, alt.children.length > 0 && alt.color === 'w' ? false : true);
          parts.push(')');
          force = true;
        }
      }
      p = main;
      if (comments && main.comment) force = true;
    }
  };
  walk(root, true);
  const result = headers.Result || '*';
  const text = `${parts.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')')} ${result}`.trim();
  return `${head}\n\n${wrap(text)}\n`;
}

function wrap(text, width = 80) {
  const out = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > width) { out.push(line.trim()); line = w; } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out.join('\n');
}

/** Result implied by the final position, or null. */
export function impliedResult(node) {
  const chess = new Chess(node.fen);
  if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0';
  if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves()) return '1/2-1/2';
  return null;
}

/** How many mainline moves carry an engine evaluation. */
export function evalCount(root) {
  return mainlineOf(root).filter((n) => n.eval).length;
}
