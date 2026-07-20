// =====================================================================
// SECTIONS
// Renders the Events, Standings, Games, and Club sections directly into
// the page (no modal). All data below is placeholder/mock content —
// wire it up to the club's real backend/CMS when available.
//
// Event banners: each event has a `banner` field. Leave it null and a
// generated abstract pattern is used (see bannerArt below); set it to
// an image URL and a real photo renders instead, with the same cyan
// duotone treatment applied automatically (see .event-banner img in
// sections.css) so it matches the rest of the theme.
// =====================================================================

const EVENTS = [
  {
    id: 'evt-04', name: 'Winter Open', status: 'open', statusLabel: 'Registration open',
    format: 'Swiss · 7 rounds', prize: '₹25,000 prize pool', date: '2–4 Aug 2026',
    desc: 'A campus-wide open Swiss tournament over three days. Every rating level is welcome — pairings are by rating, so early rounds are always close.',
    regDeadline: '2026-07-28T18:00:00', banner: null,
  },
  {
    id: 'evt-05', name: 'Inter-College Blitz', status: 'soon', statusLabel: 'Opens 19 Aug',
    format: 'Blitz · Knockout', prize: 'Trophy + certificates', date: '19 Aug 2026',
    desc: 'A fast, five-minute knockout against neighbouring colleges. Registration opens once the Winter Open wraps up.',
    banner: null,
  },
  {
    id: 'evt-03', name: 'Rapid Ladder — Season 4', status: 'ongoing', statusLabel: 'Ongoing',
    format: 'Rapid · Standing ladder', prize: 'Seasonal ranking', date: 'All season',
    desc: 'Challenge any member within two ranks of you, whenever suits you both. Results feed straight into the Standings below.',
    banner: null,
  },
  {
    id: 'evt-02', name: 'Fresher Invitational', status: 'done', statusLabel: 'Wrapped up',
    format: 'Round robin', prize: '—', date: 'March 2026',
    desc: 'A closed round robin for first-year students. The winner earned a spot straight onto the varsity roster.',
    banner: null,
  },
  {
    id: 'evt-01', name: 'Grandmaster Simul', status: 'done', statusLabel: 'Wrapped up',
    format: 'Simultaneous exhibition', prize: '—', date: 'Nov 2025',
    desc: 'A visiting titled player took on 24 club members at once, moving board to board around the hall.',
    banner: null,
  },
];

const PLAYERS = [
  { alias: 'Kestrel',   elo: 2184, eloChange: 12,  winRate: 71,  opening: 'Sicilian Defense',   openingRate: 64, record: '9 wins · 2 losses · 1 draw' },
  { alias: 'Voidrook',  elo: 2091, eloChange: -4,  winRate: 63, opening: "Queen's Gambit",     openingRate: 58, record: '7 wins · 3 losses · 2 draws' },
  { alias: 'Zephyr',    elo: 2050, eloChange: 6,   winRate: 60,  opening: 'Ruy Lopez',          openingRate: 55, record: '6 wins · 4 losses · 1 draw' },
  { alias: 'Nightfile', elo: 1972, eloChange: 2,   winRate: 54, opening: 'Caro-Kann',          openingRate: 49, record: '5 wins · 4 losses · 2 draws' },
  { alias: 'Axiom',     elo: 1918, eloChange: -8,  winRate: 48,  opening: 'English Opening',    openingRate: 45, record: '4 wins · 5 losses · 1 draw' },
  { alias: 'Glasspawn', elo: 1874, eloChange: 15,  winRate: 52,  opening: "King's Indian",      openingRate: 51, record: '5 wins · 4 losses' },
  { alias: 'Orbital',   elo: 1802, eloChange: -2,  winRate: 44,  opening: 'French Defense',     openingRate: 40, record: '3 wins · 5 losses · 1 draw' },
  { alias: 'Tenfold',   elo: 1745, eloChange: 1,   winRate: 41,  opening: 'Scandinavian',       openingRate: 38, record: '3 wins · 6 losses' },
];

const ARCHIVES = [
  { id: 'arc-1', opponent: 'Voidrook',  date: '12 Jul 2026', result: 'win',  opening: 'Ruy Lopez' },
  { id: 'arc-2', opponent: 'Axiom',     date: '05 Jul 2026', result: 'loss', opening: 'Sicilian Defense' },
  { id: 'arc-3', opponent: 'Glasspawn', date: '27 Jun 2026', result: 'draw', opening: 'Caro-Kann' },
  { id: 'arc-4', opponent: 'Orbital',   date: '14 Jun 2026', result: 'win',  opening: "Queen's Gambit" },
  { id: 'arc-5', opponent: 'Tenfold',   date: '02 Jun 2026', result: 'win',  opening: 'English Opening' },
  { id: 'arc-6', opponent: 'Zephyr',    date: '21 May 2026', result: 'loss', opening: "King's Indian" },
];

const HONORS = [
  { year: '2025', title: 'Zonal inter-college champions', desc: 'Won the North Zone inter-college championship for the first time in club history, going undefeated across six matches.' },
  { year: '2024', title: 'Best campus chess society', desc: 'Recognised by the state chess association for outreach — over 400 students introduced to the game across the year.' },
  { year: '2022', title: '50th alumnus to earn a title', desc: 'A former club captain earned the Candidate Master title, the fiftieth alumnus to hold a FIDE title.' },
  { year: '2010', title: 'New clubhouse opened', desc: 'The club moved into a dedicated room with twelve boards, a clock library, and a permanent notice board.' },
  { year: '1987', title: 'Club founded', desc: 'Six students meeting weekly in a hostel common room founded GBPUAT Chess Club.' },
];

const RESULT_LABEL = { win: 'Won', loss: 'Lost', draw: 'Drawn' };

// ---- Demo game data for the Games → replay viewer ----------------------
const INITIAL_BOARD = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['.', '.', '.', '.', '.', '.', '.', '.'],
  ['.', '.', '.', '.', '.', '.', '.', '.'],
  ['.', '.', '.', '.', '.', '.', '.', '.'],
  ['.', '.', '.', '.', '.', '.', '.', '.'],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
];
const DEMO_MOVES = [
  { san: 'e4',  from: 'e2', to: 'e4' },
  { san: 'e5',  from: 'e7', to: 'e5' },
  { san: 'Nf3', from: 'g1', to: 'f3' },
  { san: 'Nc6', from: 'b8', to: 'c6' },
  { san: 'Bb5', from: 'f1', to: 'b5' },
  { san: 'a6',  from: 'a7', to: 'a6' },
  { san: 'Ba4', from: 'b5', to: 'a4' },
  { san: 'Nf6', from: 'g8', to: 'f6' },
];
function squareToRC(square) {
  const col = square.charCodeAt(0) - 97;
  const row = 8 - parseInt(square[1], 10);
  return [row, col];
}
function buildSnapshots() {
  let board = INITIAL_BOARD.map((row) => row.slice());
  const snaps = [board.map((r) => r.slice())];
  for (const mv of DEMO_MOVES) {
    const [fr, fc] = squareToRC(mv.from);
    const [tr, tc] = squareToRC(mv.to);
    board[tr][tc] = board[fr][fc];
    board[fr][fc] = '.';
    snaps.push(board.map((r) => r.slice()));
  }
  return snaps;
}
const DEMO_SNAPSHOTS = buildSnapshots();
const PIECE_GLYPH = { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔', p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

// ---- Deterministic generated art (event banners + archive thumbnails) --
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bannerArt(seed) {
  const rng = mulberry32(seed);
  let grid = '';
  for (let i = 0; i <= 12; i++) {
    grid += `<line x1="${i * 32}" y1="0" x2="${i * 32}" y2="225" stroke="var(--border)" stroke-width="0.5"/>`;
  }
  for (let i = 0; i <= 7; i++) {
    grid += `<line x1="0" y1="${i * 32}" x2="400" y2="${i * 32}" stroke="var(--border)" stroke-width="0.5"/>`;
  }
  let blobs = '';
  for (let i = 0; i < 3; i++) {
    const cx = 60 + rng() * 280;
    const cy = 40 + rng() * 145;
    const r = 40 + rng() * 70;
    blobs += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="var(--accent)" opacity="${(0.05 + rng() * 0.08).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 400 225" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="400" height="225" fill="#060d18"/>${blobs}${grid}</svg>`;
}
function caseArt(seed) {
  const rng = mulberry32(seed);
  let grid = '';
  for (let i = 0; i <= 8; i++) {
    grid += `<line x1="${i * 12}" y1="0" x2="${i * 12}" y2="96" stroke="var(--border)" stroke-width="0.5"/>`;
    grid += `<line x1="0" y1="${i * 12}" x2="96" y2="${i * 12}" stroke="var(--border)" stroke-width="0.5"/>`;
  }
  let marks = '';
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rng() * 8);
    const y = Math.floor(rng() * 8);
    const o = (0.12 + rng() * 0.5).toFixed(2);
    marks += `<rect x="${x * 12 + 1.5}" y="${y * 12 + 1.5}" width="9" height="9" fill="var(--accent)" opacity="${o}"/>`;
  }
  return `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${grid}${marks}</svg>`;
}

// -----------------------------------------------------------------------

export function initSections() {
  renderEvents();
  renderStandings();
  renderArchive();
  renderHonors();
  bindEventDelegation();
  startCountdowns();
}

// ---- Events -------------------------------------------------------------

function renderEvents() {
  const grid = document.getElementById('eventsGrid');
  if (!grid) return;
  grid.innerHTML = EVENTS.map((e, i) => {
    const banner = e.banner ? `<img src="${e.banner}" alt="">` : bannerArt(i * 61 + 7);
    let action;
    if (e.regDeadline) {
      action = `
        <span class="event-countdown" id="countdown-${e.id}">Closes in —</span>
        <button class="event-register" data-action="register" data-id="${e.id}" type="button">Register</button>`;
    } else if (e.status === 'ongoing') {
      action = `<span class="event-countdown">Open enrolment</span>`;
    } else if (e.status === 'soon') {
      action = `<button class="event-register" disabled type="button">Not open yet</button>`;
    } else {
      action = `<button class="event-register" disabled type="button">Event finished</button>`;
    }
    return `
      <div class="event-card reveal">
        <div class="event-banner">
          ${banner}
          <span class="event-status ${e.status}">${e.statusLabel}</span>
        </div>
        <div class="event-body">
          <h3 class="event-title">${e.name}</h3>
          <div class="event-meta">${e.format} · ${e.date}</div>
          <p class="event-desc">${e.desc}</p>
          <div class="event-footer">${action}</div>
        </div>
      </div>`;
  }).join('');
}

function startCountdowns() {
  function tick() {
    const now = Date.now();
    EVENTS.forEach((e) => {
      if (!e.regDeadline) return;
      const el = document.getElementById(`countdown-${e.id}`);
      if (!el) return;
      const diff = new Date(e.regDeadline).getTime() - now;
      if (diff <= 0) { el.textContent = 'Registration closed'; return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      el.textContent = d > 0 ? `Closes in ${d}d ${h}h` : `Closes in ${h}h ${m}m`;
    });
  }
  tick();
  setInterval(tick, 30000);
}

// ---- Standings ------------------------------------------------------------

function renderStandings() {
  const mount = document.getElementById('standingsTable');
  if (!mount) return;
  const rows = PLAYERS.map((p, i) => {
    const top3 = i < 3;
    const eloCls = p.eloChange >= 0 ? 'standings-elo-up' : 'standings-elo-down';
    const sign = p.eloChange >= 0 ? '+' : '';
          // <span class="standings-status ${p.status}">${statusLabel}</span>
    // const statusLabel = p.status === 'online' ? 'Online' : p.status === 'playing' ? 'Playing' : 'Offline';
    return `
      <div class="standings-row ${top3 ? 'top3' : ''} reveal">
        <div class="standings-row-cells" data-action="expand-player" data-id="${p.alias}">
          <span class="standings-rank">${String(i + 1).padStart(2, '0')}</span>
          <span>${p.alias}</span>
          <span>${p.elo} <span class="standings-elo-change ${eloCls}">${sign}${p.eloChange}</span></span>
          <span>${p.winRate}%</span>
        </div>
        <div class="standings-dossier" id="dossier-${p.alias}">
          <div class="standings-dossier-inner">
            <div>Favourite opening: <b style="color:var(--text)">${p.opening}</b> — plays it ${p.openingRate}% of the time.</div>
            <div class="progress-row">
              <span class="progress-label">WIN RATE</span>
              <span class="progress-track"><span class="progress-fill" id="fill-${p.alias}"></span></span>
              <span class="progress-pct">${p.winRate}%</span>
            </div>
            <div style="margin-top:.75rem;">Season record: ${p.record}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  mount.innerHTML = `
    <div class="standings-wrap">
      <div class="standings-head">
        <span>RANK</span><span>PLAYER</span><span>RATING</span><span>WIN RATE</span><span>STATUS</span>
      </div>
      ${rows}
    </div>`;
}

// ---- Archive / replay -----------------------------------------------------

let archiveOpenId = null;
let pgnIndex = 0;

function renderArchive() {
  const mount = document.getElementById('archiveGrid');
  if (!mount) return;
  if (archiveOpenId) { mount.innerHTML = renderReplay(); return; }

  mount.innerHTML = `<div class="archive-grid">${ARCHIVES.map((a, i) => `
    <div class="case-card reveal" data-action="open-archive" data-id="${a.id}">
      ${caseArt(i * 97 + 13)}
      <div class="case-meta">
        vs <b>${a.opponent}</b><br>
        ${a.date} · ${a.opening}
      </div>
      <span class="case-result ${a.result}">${RESULT_LABEL[a.result]}</span>
    </div>`).join('')}</div>`;
}

function renderReplay() {
  const archive = ARCHIVES.find((a) => a.id === archiveOpenId);
  const board = DEMO_SNAPSHOTS[pgnIndex];
  return `
    <span class="replay-back" data-action="close-archive">← Back to all games</span>
    <div class="replay-panel">
      <div class="board2d">${renderBoardCells(board)}</div>
      <div class="replay-side">
        <div class="replay-meta">Replay: vs <b>${archive.opponent}</b> · ${archive.date} · <span class="case-result ${archive.result}">${RESULT_LABEL[archive.result]}</span></div>
        <div class="pgn-moves">${renderMoveLog()}</div>
        <div class="pgn-controls">
          <button data-action="pgn-prev" ${pgnIndex <= 0 ? 'disabled' : ''} type="button">◀ Previous</button>
          <button data-action="pgn-next" ${pgnIndex >= DEMO_MOVES.length ? 'disabled' : ''} type="button">Next move ▶</button>
        </div>
        <p class="pgn-note">Demo playback using a well-known opening line for now — swap in this match's real moves once you're recording PGNs.</p>
      </div>
    </div>`;
}

function renderBoardCells(board) {
  let html = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const light = (r + c) % 2 === 0;
      const piece = board[r][c];
      let inner = '';
      if (piece !== '.') {
        const isWhite = piece === piece.toUpperCase();
        inner = `<span class="${isWhite ? 'pc-w' : 'pc-b'}">${PIECE_GLYPH[piece]}</span>`;
      }
      html += `<div class="sq ${light ? 'light' : 'dark'}">${inner}</div>`;
    }
  }
  return html;
}

function renderMoveLog() {
  return DEMO_MOVES.map((mv, i) => {
    let cls = '';
    if (i === pgnIndex - 1) cls = 'current';
    else if (i < pgnIndex - 1) cls = 'done';
    const num = i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '';
    return `<span class="mv ${cls}">${num}${mv.san}</span>`;
  }).join(' ');
}

// ---- Honors ---------------------------------------------------------------

function renderHonors() {
  const mount = document.getElementById('honorsTimeline');
  if (!mount) return;
  mount.innerHTML = `
    <div class="honors-timeline">
      ${HONORS.map((h) => `
        <div class="honor-node reveal">
          <div class="h-year">${h.year}</div>
          <h4>${h.title}</h4>
          <p>${h.desc}</p>
        </div>`).join('')}
    </div>`;
}

// ---- Interactions -----------------------------------------------------------

function bindEventDelegation() {
  document.addEventListener('click', (e) => {
    const registerBtn = e.target.closest('[data-action="register"]');
    if (registerBtn) {
      registerBtn.textContent = "You're on the list";
      registerBtn.disabled = true;
      registerBtn.classList.add('confirmed');
      const countdown = document.getElementById(`countdown-${registerBtn.dataset.id}`);
      if (countdown) countdown.textContent = 'Confirmation sent to your email';
      return;
    }

    const expandRow = e.target.closest('[data-action="expand-player"]');
    if (expandRow) {
      const alias = expandRow.dataset.id;
      const dossier = document.getElementById(`dossier-${alias}`);
      const fill = document.getElementById(`fill-${alias}`);
      const player = PLAYERS.find((p) => p.alias === alias);
      if (!dossier) return;
      const isOpen = dossier.classList.toggle('open');
      if (fill) fill.style.width = isOpen && player ? `${player.winRate}%` : '0%';
      return;
    }

    const openArchive = e.target.closest('[data-action="open-archive"]');
    if (openArchive) { archiveOpenId = openArchive.dataset.id; pgnIndex = 0; renderArchive(); return; }

    if (e.target.closest('[data-action="close-archive"]')) { archiveOpenId = null; renderArchive(); return; }
    if (e.target.closest('[data-action="pgn-next"]')) { pgnIndex = Math.min(DEMO_MOVES.length, pgnIndex + 1); renderArchive(); return; }
    if (e.target.closest('[data-action="pgn-prev"]')) { pgnIndex = Math.max(0, pgnIndex - 1); renderArchive(); return; }
  });
}
