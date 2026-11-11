// Move classification from an analysed game — no engine runs here.
// Sources, in order of trust:
//   1. annotation symbols in the PGN (!!, !, ?!, ?, ??) — human or engine
//   2. evaluations ([%eval]) — the drop in the mover's winning chances
// Winning chances use Lichess's published curve, so "mistake" here means
// the same as it does on Lichess.
import { Chess } from 'chess.js';
import { mainlineOf } from './pgn.js';

export const CLASSES = {
  brilliant:  { label: 'Brilliant',  symbol: '!!', tone: 'brilliant' },
  great:      { label: 'Great move', symbol: '!',  tone: 'great' },
  best:       { label: 'Best',       symbol: '★',  tone: 'best' },
  excellent:  { label: 'Excellent',  symbol: '✓', tone: 'excellent' },
  good:       { label: 'Good',       symbol: '◦',  tone: 'good' },
  interesting:{ label: 'Interesting',symbol: '!?', tone: 'good' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', tone: 'inaccuracy' },
  mistake:    { label: 'Mistake',    symbol: '?',  tone: 'mistake' },
  blunder:    { label: 'Blunder',    symbol: '??', tone: 'blunder' },
};
const NAG_CLASS = { 3: 'brilliant', 1: 'great', 5: 'interesting', 6: 'inaccuracy', 2: 'mistake', 4: 'blunder' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** White's winning chances in % for an eval ({cp} or {mate}), Lichess curve. */
export function winPct(ev) {
  if (!ev) return null;
  const cp = ev.mate != null ? (ev.mate > 0 ? 1 : -1) * (10000 - Math.abs(ev.mate) * 10) : Math.max(-1000, Math.min(1000, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Did `node`'s move leave material en prise worth noticeably more than it took? */
export function isSacrifice(node) {
  if (!node.parent || node.piece === 'k') return false;
  const chess = new Chess(node.fen);
  const them = node.color === 'w' ? 'b' : 'w';
  const moved = VALUE[node.promotion || node.piece];
  const took = node.captured ? VALUE[node.captured] : 0;
  if (moved < 3 || node.mate) return false;
  const attackers = chess.attackers(node.to, them);
  if (!attackers.length) return false;
  const cheapest = Math.min(...attackers.map((sq) => VALUE[chess.get(sq).type] || 9));
  const defended = chess.attackers(node.to, node.color).length > 0;
  const loss = defended ? moved - cheapest : moved;
  return loss - took >= 2;
}

/**
 * Annotate the mainline in place: node.cls (key of CLASSES) and
 * node.loss (mover's drop in winning chances, %). Returns a per-colour
 * tally: { w: {best: 3, …}, b: {…} }.
 */
export function classifyGame(root) {
  const line = mainlineOf(root);
  const tally = { w: {}, b: {} };
  let prevWin = winPct(root.eval) ?? 50;
  let prevCls = null;
  for (const node of line) {
    const nag = node.nags.find((n) => NAG_CLASS[n]);
    let cls = nag ? NAG_CLASS[nag] : null;
    const after = winPct(node.eval);
    if (after != null) {
      const moverBefore = node.color === 'w' ? prevWin : 100 - prevWin;
      const moverAfter = node.color === 'w' ? after : 100 - after;
      node.loss = Math.max(0, moverBefore - moverAfter);
      if (!cls) {
        if (node.loss < 1) cls = 'best';
        else if (node.loss < 2.5) cls = 'excellent';
        else if (node.loss < 5) cls = 'good';
        else if (node.loss < 10) cls = 'inaccuracy';
        else if (node.loss < 15) cls = 'mistake';
        else cls = 'blunder';
        // Upgrades for top moves:
        if (node.loss < 2.5 && moverBefore < 97 && moverAfter > 30 && isSacrifice(node)) cls = 'brilliant';
        else if (cls === 'best' && (prevCls === 'mistake' || prevCls === 'blunder') && moverAfter - moverBefore > -1 && moverAfter >= 60) cls = 'great';
      }
      prevWin = after;
    } else if (node.mate) {
      cls = cls || 'best';
    }
    node.cls = cls || null;
    prevCls = cls;
    if (cls) tally[node.color][cls] = (tally[node.color][cls] || 0) + 1;
  }
  return tally;
}

/** Average accuracy per side (Lichess-style, from win% losses), or null without evals. */
export function accuracy(root) {
  const out = {};
  for (const color of ['w', 'b']) {
    const moves = mainlineOf(root).filter((n) => n.color === color && n.loss != null);
    if (!moves.length) { out[color] = null; continue; }
    const acc = moves.map((n) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * n.loss) - 3.1669)));
    out[color] = Math.round(acc.reduce((a, b) => a + b, 0) / acc.length);
  }
  return out;
}
