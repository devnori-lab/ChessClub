// Fixture generation for every tournament format — pure functions, no DB.
// Players are { id, name, rating, seed? }. A pairing is { white, black }
// (ids); byes are { player, points }. History comes from earlier rounds:
// games [{ white, black, result, round, board, advance }] and byes [{ player, round, slot }].

export const FORMAT_INFO = {
  swiss:              { label: 'Swiss', blurb: 'Players with similar scores meet each round. No one is eliminated; no rematches.', generated: 'round-by-round' },
  round_robin:        { label: 'Round robin', blurb: 'Everyone plays everyone once. All rounds are known in advance.', generated: 'all' },
  double_round_robin: { label: 'Double round robin', blurb: 'Everyone plays everyone twice, once with each colour.', generated: 'all' },
  knockout:           { label: 'Knockout', blurb: 'Lose and you are out. Top seeds get byes when the field isn’t a power of two.', generated: 'round-by-round' },
  team_league:        { label: 'Team league', blurb: 'Teams play each other in round-robin matches over several boards.', generated: 'all' },
  simul:              { label: 'Simul', blurb: 'One host plays every entrant at the same time.', generated: 'once' },
  arena:              { label: 'Arena', blurb: 'Free pairing (usually on Lichess). Add games as they are played.', generated: 'manual' },
  ladder:             { label: 'Ladder', blurb: 'Players challenge each other. Add each challenge game as it is agreed.', generated: 'manual' },
};

export const points = (result, side) => {
  if (result === '1/2-1/2') return 0.5;
  const whiteWon = result === '1-0' || result === '+/-';
  const blackWon = result === '0-1' || result === '-/+';
  if (side === 'white') return whiteWon ? 1 : 0;
  return blackWon ? 1 : 0;
};
export const decided = (g) => g.result && g.result !== '*';

// ---------------------------------------------------------------------------
// Round robin (circle method). Returns every round: [{ pairings, bye }]
// ---------------------------------------------------------------------------
export function roundRobin(ids, { double = false } = {}) {
  // Berger tables: players 1..n (n even; a missing nth player = bye).
  // Pair i–j (both < n) meets in the round where i + j ≡ r + 1 (mod n − 1);
  // the lower number has white when j − i is odd. That gives every player
  // n/2 or n/2 − 1 whites. Player n's colour alternates by round.
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length, m = n - 1;
  const at = (k) => list[k - 1];
  const rounds = [];
  for (let r = 1; r <= m; r++) {
    const pairings = [];
    let bye = null;
    for (let i = 1; i <= m; i++) {
      for (let j = i + 1; j <= m; j++) {
        if ((i + j - r - 1) % m !== 0) continue;
        const iWhite = (j - i) % 2 === 1;
        const a = at(i), b = at(j);
        if (a === null || b === null) { bye = a ?? b; continue; }
        pairings.push(iWhite ? { white: a, black: b } : { white: b, black: a });
      }
    }
    const k = Array.from({ length: m }, (_, x) => x + 1).find((x) => (2 * x - r - 1) % m === 0);
    const a = at(k), last = at(n);
    if (a === null || last === null) bye = a ?? last;
    else pairings.unshift(r % 2 ? { white: a, black: last } : { white: last, black: a });
    rounds.push({ pairings, bye });
  }
  if (double) {
    const second = rounds.map((rd) => ({ pairings: rd.pairings.map((p) => ({ white: p.black, black: p.white })), bye: rd.bye }));
    return [...rounds, ...second];
  }
  return rounds;
}

// ---------------------------------------------------------------------------
// Swiss (Dutch-style): score groups, top half v bottom half, no rematches,
// colour balance, one bye per player at most.
// ---------------------------------------------------------------------------
export function playerRecords(players, games, byes) {
  const rec = new Map(players.map((p) => [p.id, { ...p, score: 0, colours: [], opponents: new Set(), hadBye: false }]));
  const sorted = [...games].sort((a, b) => (a.round || 0) - (b.round || 0) || (a.board || 0) - (b.board || 0));
  for (const g of sorted) {
    const w = rec.get(g.white), b = rec.get(g.black);
    if (w) { w.colours.push('w'); w.opponents.add(g.black); if (decided(g)) w.score += points(g.result, 'white'); }
    if (b) { b.colours.push('b'); b.opponents.add(g.white); if (decided(g)) b.score += points(g.result, 'black'); }
  }
  for (const by of byes) { const r = rec.get(by.player); if (r) { r.hadBye = true; r.score += Number(by.points ?? 1); } }
  return rec;
}

function colourNeed(r) {
  const w = r.colours.filter((c) => c === 'w').length, b = r.colours.length - w;
  const last2 = r.colours.slice(-2);
  const streak = last2.length === 2 && last2[0] === last2[1] ? last2[0] : null;
  // > 0 wants white, < 0 wants black; |3| = must (would break the rules otherwise)
  if (streak === 'w' || w - b >= 2) return -3;
  if (streak === 'b' || b - w >= 2) return 3;
  if (w > b) return -1;
  if (b > w) return 1;
  const last = r.colours[r.colours.length - 1];
  return last === 'w' ? -0.5 : last === 'b' ? 0.5 : 0;
}

export function assignColours(a, b, ra, rb) {
  const na = colourNeed(ra), nb = colourNeed(rb);
  if (na !== nb) return na > nb ? { white: a, black: b } : { white: b, black: a };
  // Same need: the higher-ranked player gets their preference.
  const higher = ra.score !== rb.score ? (ra.score > rb.score ? 'a' : 'b') : ((ra.rating || 0) >= (rb.rating || 0) ? 'a' : 'b');
  const prefWhite = (higher === 'a' ? na : nb) >= 0;
  if (higher === 'a') return prefWhite ? { white: a, black: b } : { white: b, black: a };
  return prefWhite ? { white: b, black: a } : { white: a, black: b };
}

export function swissRound(players, games, byes, { byePoints = 1 } = {}) {
  const rec = playerRecords(players, games, byes);
  const order = [...rec.values()].sort((x, y) => y.score - x.score || (y.rating || 0) - (x.rating || 0) || String(x.name).localeCompare(String(y.name)));
  const warnings = [];
  let bye = null;
  let pool = order;
  if (order.length % 2) {
    const candidates = [...order].reverse();
    const pick = candidates.find((r) => !r.hadBye) || candidates[0];
    if (pick.hadBye) warnings.push(`${pick.name} gets a second bye — everyone has had one.`);
    bye = { player: pick.id, points: byePoints };
    pool = order.filter((r) => r.id !== pick.id);
  }

  const firstRound = games.length === 0;
  if (firstRound) {
    const half = pool.length / 2;
    const pairings = [];
    for (let i = 0; i < half; i++) {
      const top = pool[i], bottom = pool[i + half];
      pairings.push(i % 2 === 0 ? { white: top.id, black: bottom.id } : { white: bottom.id, black: top.id });
    }
    return { pairings, bye, warnings };
  }

  // Ideal opponent: within a score group, index i pairs with i + group/2.
  const groupOf = new Map();
  for (const r of pool) { if (!groupOf.has(r.score)) groupOf.set(r.score, []); groupOf.get(r.score).push(r.id); }
  const cost = (a, b, allowRematch, strictColour) => {
    if (a.opponents.has(b.id)) { if (!allowRematch) return Infinity; }
    if (strictColour) { const na0 = colourNeed(a), nb0 = colourNeed(b); if (Math.abs(na0) === 3 && na0 === nb0) return Infinity; }
    const ga = groupOf.get(a.score);
    const ia = ga.indexOf(a.id), half = Math.floor(ga.length / 2);
    const ideal = ia < half ? ga[ia + half] : null;
    let c = Math.abs(a.score - b.score) * 1000;
    if (b.score === a.score) { const ib = ga.indexOf(b.id); c += Math.abs(ib - (ia + half)) * 2; if (ideal === b.id) c -= 1; }
    const na = colourNeed(a), nb = colourNeed(b);
    if (Math.abs(na) === 3 && na === nb) c += 2500;  // both must have the same colour: near-absolute
    else if (Math.sign(na) === Math.sign(nb) && na !== 0) c += 5;
    if (a.opponents.has(b.id)) c += 100000;
    return c;
  };

  const solve = (allowRematch, strictColour = false) => {
    let budget = 300000;
    const used = new Set();
    const out = [];
    const rec2 = (i) => {
      while (i < pool.length && used.has(pool[i].id)) i++;
      if (i >= pool.length) return true;
      if (--budget < 0) return false;
      const a = pool[i];
      used.add(a.id);
      const cands = pool.filter((b) => !used.has(b.id)).map((b) => [b, cost(a, b, allowRematch, strictColour)]).filter(([, c]) => c < Infinity).sort((x, y) => x[1] - y[1]);
      for (const [b] of cands) {
        used.add(b.id); out.push([a, b]);
        if (rec2(i + 1)) return true;
        used.delete(b.id); out.pop();
      }
      used.delete(a.id);
      return false;
    };
    return rec2(0) ? out : null;
  };

  // 1st try: no rematches and nobody gets the same colour three times running.
  let pairs = solve(false, true) || solve(false);
  if (!pairs) {
    pairs = solve(true);
    warnings.push('Not every rematch could be avoided — check the highlighted boards.');
  }
  if (!pairs) return { pairings: [], bye, warnings: ['Could not pair this round automatically. Pair it manually.'] };
  // Boards: highest combined score first.
  pairs.sort((x, y) => Math.max(y[0].score, y[1].score) - Math.max(x[0].score, x[1].score) || (y[0].score + y[1].score) - (x[0].score + x[1].score));
  return { pairings: pairs.map(([a, b]) => assignColours(a.id, b.id, a, b)), bye, warnings };
}

// ---------------------------------------------------------------------------
// Knockout: seeded bracket. Board number = bracket slot.
// ---------------------------------------------------------------------------
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}
export const roundName = (slotsInRound) => ({ 1: 'Final', 2: 'Semi-finals', 4: 'Quarter-finals' }[slotsInRound] || `Round of ${slotsInRound * 2}`);

export function knockoutFirstRound(players) {
  const seeded = [...players].sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9) || (b.rating || 0) - (a.rating || 0));
  let size = 1;
  while (size < seeded.length) size *= 2;
  const order = seedOrder(size);
  const pairings = [], byes = [];
  for (let k = 0; k < size / 2; k++) {
    const a = seeded[order[2 * k] - 1], b = seeded[order[2 * k + 1] - 1];
    const slot = k + 1;
    if (a && b) pairings.push({ white: a.id, black: b.id, board: slot });
    else if (a || b) byes.push({ player: (a || b).id, points: 1, slot });
  }
  return { pairings, byes, slots: size / 2 };
}

/** Winner of a knockout game, or null if it still needs a result/tiebreak. */
export function koWinner(g) {
  if (!g || !decided(g)) return null;
  if (g.result === '1-0' || g.result === '+/-') return g.white;
  if (g.result === '0-1' || g.result === '-/+') return g.black;
  return g.advance || null; // draw or double forfeit → tiebreak decides
}

export function knockoutNextRound(prevGames, prevByes, ratingOf = () => 0, colourHistory = new Map()) {
  const bySlot = new Map();
  for (const g of prevGames) bySlot.set(g.board, { winner: koWinner(g), game: g });
  for (const b of prevByes) bySlot.set(b.slot, { winner: b.player, bye: true });
  const slots = Math.max(0, ...bySlot.keys());
  const missing = [];
  const pairings = [], byes = [];
  if (slots <= 1) return { done: true, champion: bySlot.get(1)?.winner || null, pairings, byes, missing };
  for (let s = 1; s * 2 <= slots + (slots % 2); s++) {
    const A = bySlot.get(2 * s - 1), B = bySlot.get(2 * s);
    if ((A && !A.winner) || (B && !B.winner)) { missing.push(...[A, B].filter((x) => x && !x.winner).map((x) => x.game?.board)); continue; }
    const a = A?.winner, b = B?.winner;
    if (a && b) {
      // White to whoever had black more recently; otherwise the higher rating.
      const la = (colourHistory.get(a) || []).at(-1), lb = (colourHistory.get(b) || []).at(-1);
      const aWhite = la !== lb ? la === 'b' || lb === 'w' : ratingOf(a) >= ratingOf(b);
      pairings.push({ white: aWhite ? a : b, black: aWhite ? b : a, board: s });
    } else if (a || b) byes.push({ player: a || b, points: 1, slot: s });
  }
  return { done: false, pairings, byes, missing, slots: Math.ceil(slots / 2) };
}

// ---------------------------------------------------------------------------
// Simul: the host against every entrant.
// ---------------------------------------------------------------------------
export function simulRound(hostId, entrantIds, hostColour = 'white') {
  return entrantIds.filter((id) => id !== hostId).map((id, i) => {
    const hostWhite = hostColour === 'white' || (hostColour === 'alternate' && i % 2 === 0);
    return hostWhite ? { white: hostId, black: id, board: i + 1 } : { white: id, black: hostId, board: i + 1 };
  });
}

// ---------------------------------------------------------------------------
// Team league: round-robin of teams; boards from each roster's board order.
// rosters: Map(teamId → [playerId…] in board order)
// ---------------------------------------------------------------------------
export function teamLeague(teamIds, rosters, { boards = 4, double = false } = {}) {
  return roundRobin(teamIds, { double }).map((rd, ri) => {
    const matches = rd.pairings.map((p, mi) => {
      const home = p.white, away = p.black;
      const H = rosters.get(home) || [], A = rosters.get(away) || [];
      const n = Math.min(boards, H.length, A.length);
      const games = [];
      for (let k = 0; k < n; k++) {
        const homeWhite = k % 2 === 0;
        games.push(homeWhite
          ? { white: H[k], black: A[k], board: k + 1, home_side: 'white' }
          : { white: A[k], black: H[k], board: k + 1, home_side: 'black' });
      }
      return { ref: `r${ri + 1}m${mi + 1}`, home, away, boards: n, games, short: n < boards };
    });
    return { matches, bye: rd.bye };
  });
}

// ---------------------------------------------------------------------------
// Checks for a proposed round, shown next to each board.
// Returns { errors: [..], boards: Map(index → [warnings]) }
// ---------------------------------------------------------------------------
export function checkPairings(pairings, byes, history, nameOf = (id) => id) {
  const errors = [];
  const boardWarn = new Map();
  const seen = new Map();
  const add = (i, msg) => { if (!boardWarn.has(i)) boardWarn.set(i, []); boardWarn.get(i).push(msg); };
  const rec = playerRecords([...new Set(pairings.flatMap((p) => [p.white, p.black]).concat(byes.map((b) => b.player)))].map((id) => ({ id, name: nameOf(id) })), history.games, history.byes);
  pairings.forEach((p, i) => {
    if (!p.white || !p.black) { errors.push(`Board ${i + 1} is missing a player.`); return; }
    if (p.white === p.black) errors.push(`Board ${i + 1}: a player can't play themselves.`);
    for (const id of [p.white, p.black]) {
      if (seen.has(id)) errors.push(`${nameOf(id)} is on two boards (${seen.get(id)} and ${i + 1}).`);
      else seen.set(id, i + 1);
    }
    const w = rec.get(p.white), b = rec.get(p.black);
    if (w?.opponents.has(p.black)) add(i, 'Rematch');
    if (w && w.colours.slice(-2).join('') === 'ww') add(i, `${nameOf(p.white)}: 3rd white in a row`);
    if (b && b.colours.slice(-2).join('') === 'bb') add(i, `${nameOf(p.black)}: 3rd black in a row`);
    if (w && b && Math.abs(w.score - b.score) >= 1.5) add(i, `Score gap ${Math.abs(w.score - b.score)}`);
  });
  for (const b of byes) if (seen.has(b.player)) errors.push(`${nameOf(b.player)} has a bye and a game.`);
  return { errors, boards: boardWarn };
}
