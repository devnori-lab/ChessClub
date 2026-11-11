// Admin console. One config-driven table + form editor covers every
// table; a few sections add shortcuts (approve, confirm, PGN import).
// The database (RLS) is what actually restricts this to admins.
import { supabase } from './supabase.js';
import { requireRole, signOut, esc, toast, errText } from './auth.js';

document.getElementById('signOut').addEventListener('click', signOut);
const nav = document.getElementById('adminNav');
const view = document.getElementById('adminView');
const dialog = document.getElementById('editor');

// ---- enums (mirror supabase/migrations) -------------------------------
const E = {
  player_status: ['pending', 'active', 'alumni', 'inactive', 'guest'],
  tournament_format: ['swiss', 'round_robin', 'double_round_robin', 'knockout', 'arena', 'ladder', 'simul', 'team_league'],
  tournament_kind: ['individual', 'team'],
  tournament_status: ['draft', 'registration_open', 'registration_closed', 'ongoing', 'completed', 'cancelled'],
  entry_status: ['pending', 'confirmed', 'waitlist', 'withdrawn', 'rejected'],
  round_status: ['scheduled', 'ongoing', 'completed'],
  match_status: ['scheduled', 'ongoing', 'completed', 'postponed', 'cancelled'],
  game_result: ['1-0', '0-1', '1/2-1/2', '+/-', '-/+', '0-0', '*'],
  game_termination: ['checkmate', 'resignation', 'timeout', 'draw_agreement', 'stalemate', 'repetition', 'fifty_move', 'insufficient_material', 'forfeit', 'abandoned', 'other'],
  game_source: ['otb', 'lichess', 'chesscom', 'other'],
  team_role: ['captain', 'vice_captain', 'member', 'reserve'],
  app_role: ['player', 'admin'],
};
const GOOD = new Set(['active', 'confirmed', 'completed', 'registration_open', 'ongoing', 'admin', 'true']);
const WARN = new Set(['pending', 'draft', 'waitlist', 'scheduled', 'postponed', 'registration_closed']);
const BAD = new Set(['rejected', 'cancelled', 'inactive', 'withdrawn']);
const badge = (v) => `<span class="badge ${GOOD.has(String(v)) ? 'good' : WARN.has(String(v)) ? 'warn' : BAD.has(String(v)) ? 'bad' : ''}">${esc(String(v).replace(/_/g, ' '))}</span>`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// ---- foreign-key option lists ------------------------------------------
const LOOKUPS = {
  players: { select: 'id, full_name, status, is_external', order: 'full_name', label: (r) => `${r.full_name}${r.is_external ? ' (ext)' : r.status !== 'active' ? ` (${r.status})` : ''}` },
  tournaments: { select: 'id, name, starts_on', order: 'starts_on', desc: true, label: (r) => r.name },
  teams: { select: 'id, name, season', order: 'name', label: (r) => `${r.name}${r.season ? ` · ${r.season}` : ''}` },
  rounds: { select: 'id, number, tournament:tournaments(name)', order: 'number', label: (r) => `${r.tournament?.name || '?'} · R${r.number}` },
  matches: { select: 'id, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name), scheduled_at', order: 'scheduled_at', desc: true, label: (r) => `${r.home?.name} vs ${r.away?.name}` },
};
const lookupCache = {};
async function lookup(name, fresh = false) {
  if (!fresh && lookupCache[name]) return lookupCache[name];
  const L = LOOKUPS[name];
  const { data, error } = await supabase.from(name).select(L.select).order(L.order, { ascending: !L.desc, nullsFirst: false });
  if (error) { toast(errText(error), 'error'); return []; }
  return (lookupCache[name] = data.map((r) => ({ id: r.id, label: L.label(r) })));
}
const labelOf = (name, id) => (lookupCache[name] || []).find((o) => o.id === id)?.label ?? '—';

// ---- field helpers -------------------------------------------------------
const F = {
  text: (key, label, o = {}) => ({ key, label, type: 'text', ...o }),
  area: (key, label, o = {}) => ({ key, label, type: 'textarea', wide: true, ...o }),
  num: (key, label, o = {}) => ({ key, label, type: 'number', ...o }),
  date: (key, label, o = {}) => ({ key, label, type: 'date', ...o }),
  dt: (key, label, o = {}) => ({ key, label, type: 'datetime', ...o }),
  bool: (key, label, o = {}) => ({ key, label, type: 'bool', ...o }),
  enm: (key, label, opts, o = {}) => ({ key, label, type: 'enum', opts, ...o }),
  fk: (key, label, table, o = {}) => ({ key, label, type: 'fk', table, ...o }),
};

// ---- sections ------------------------------------------------------------
const SECTIONS = {
  overview: { title: 'Overview', custom: renderOverview },

  players: {
    title: 'Players', table: 'players', order: 'full_name',
    select: '*, private:player_private(email, phone, roll_number)',
    search: ['full_name', 'department', 'college', 'lichess_username'],
    filters: [{ key: 'status', label: 'All statuses', opts: E.player_status }],
    columns: [
      { label: 'Name', html: (r) => `<b>${esc(r.full_name)}</b>${r.is_external ? ` <span class="muted">· ${esc(r.college || 'external')}</span>` : ''}<br><span class="muted">${esc(r.private?.email || '')}</span>` },
      { label: 'Status', html: (r) => badge(r.status) },
      { label: 'Rating', num: true, html: (r) => r.club_rating },
      { label: 'Games', num: true, html: (r) => r.club_games },
      { label: 'Dept / batch', html: (r) => esc([r.department, r.batch_year].filter(Boolean).join(' · ')) },
    ],
    rowActions: (r) => (r.status === 'pending' ? `<button class="btn sm" data-quick="approve" data-id="${r.id}">Approve</button>` : ''),
    fields: [
      F.text('full_name', 'Full name', { required: true }), F.enm('status', 'Status', E.player_status),
      F.bool('is_external', 'External (other college / guest)'), F.text('college', 'College (external)'),
      F.text('department', 'Department'), F.text('programme', 'Programme'), F.num('batch_year', 'Batch year'),
      F.date('joined_on', 'Joined on'),
      F.text('lichess_username', 'Lichess'), F.text('chesscom_username', 'Chess.com'),
      F.text('fide_id', 'FIDE ID'), F.num('fide_rating', 'FIDE rating'),
      F.text('photo_url', 'Photo URL'), F.area('bio', 'Bio'),
    ],
  },

  tournaments: {
    title: 'Tournaments', table: 'tournaments', order: 'starts_on', desc: true,
    search: ['name', 'venue'],
    filters: [{ key: 'status', label: 'All statuses', opts: E.tournament_status }],
    columns: [
      { label: 'Name', html: (r) => `<b>${esc(r.name)}</b>${r.is_published ? '' : ' <span class="badge">hidden</span>'}<br><span class="muted">${esc(r.format.replace(/_/g, ' '))} · ${r.kind}${r.time_control_base_min != null ? ` · ${r.time_control_base_min}+${r.time_control_increment_s}` : ''}</span>` },
      { label: 'Status', html: (r) => badge(r.status) },
      { label: 'Dates', html: (r) => `${fmtDate(r.starts_on)}${r.ends_on && r.ends_on !== r.starts_on ? ` – ${fmtDate(r.ends_on)}` : ''}` },
      { label: 'Venue', html: (r) => esc(r.venue || '') },
    ],
    defaults: { format: 'swiss', kind: 'individual', status: 'draft', rated: true, time_control_increment_s: 0, entry_fee: 0 },
    fields: [
      F.text('name', 'Name', { required: true }), F.text('slug', 'Slug (URL id)', { hint: 'e.g. winter-open-2026' }),
      F.enm('format', 'Format', E.tournament_format), F.enm('kind', 'Kind', E.tournament_kind),
      F.enm('status', 'Status', E.tournament_status), F.bool('is_published', 'Published (visible on the site)'),
      F.num('time_control_base_min', 'Base time (min)'), F.num('time_control_increment_s', 'Increment (s)'),
      F.bool('rated', 'Rated (counts for club rating)'), F.num('rounds_planned', 'Rounds'),
      F.date('starts_on', 'Starts'), F.date('ends_on', 'Ends'), F.text('venue', 'Venue'),
      F.dt('registration_opens_at', 'Registration opens'), F.dt('registration_closes_at', 'Registration closes'),
      F.num('max_entries', 'Max entries'), F.num('entry_fee', 'Entry fee (₹)', { step: '0.01' }),
      F.text('banner_url', 'Banner image URL'),
      F.area('description', 'Description'), F.area('prize_details', 'Prizes'), F.area('rules', 'Rules'),
    ],
  },

  entries: {
    title: 'Entries', table: 'tournament_entries', order: 'registered_at', desc: true,
    select: '*, player:players(full_name, club_rating), team:teams(name), tournament:tournaments(name)',
    tournamentFilter: true,
    filters: [{ key: 'status', label: 'All statuses', opts: E.entry_status }],
    columns: [
      { label: 'Entrant', html: (r) => `<b>${esc(r.player?.full_name || r.team?.name)}</b>${r.player ? ` <span class="muted">${r.player.club_rating}</span>` : ''}` },
      { label: 'Tournament', html: (r) => esc(r.tournament?.name) },
      { label: 'Status', html: (r) => badge(r.status) },
      { label: 'Seed', num: true, html: (r) => r.seed ?? '' },
      { label: 'Registered', html: (r) => fmtDate(r.registered_at) },
    ],
    rowActions: (r) => (r.status === 'pending' || r.status === 'waitlist'
      ? `<button class="btn sm" data-quick="confirm" data-id="${r.id}">Confirm</button> <button class="btn sm danger" data-quick="reject" data-id="${r.id}">Reject</button>` : ''),
    defaults: { status: 'confirmed' },
    fields: [
      F.fk('tournament_id', 'Tournament', 'tournaments', { required: true }),
      F.fk('player_id', 'Player (individual events)', 'players'), F.fk('team_id', 'Team (team events)', 'teams'),
      F.enm('status', 'Status', E.entry_status), F.num('seed', 'Seed'), F.num('rating_at_entry', 'Rating at entry'),
      F.area('notes', 'Notes'),
    ],
  },

  rounds: {
    title: 'Rounds', table: 'rounds', order: 'number', select: '*, tournament:tournaments(name)', tournamentFilter: true,
    columns: [
      { label: 'Tournament', html: (r) => esc(r.tournament?.name) },
      { label: 'Round', num: true, html: (r) => r.number },
      { label: 'Scheduled', html: (r) => (r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : '—') },
      { label: 'Status', html: (r) => badge(r.status) },
    ],
    defaults: { status: 'scheduled' },
    fields: [F.fk('tournament_id', 'Tournament', 'tournaments', { required: true }), F.num('number', 'Round number', { required: true }),
      F.dt('scheduled_at', 'Scheduled at'), F.enm('status', 'Status', E.round_status)],
  },

  games: {
    title: 'Games & archive', table: 'games', order: 'played_at', desc: true,
    select: '*, white:players!games_white_id_fkey(full_name), black:players!games_black_id_fkey(full_name), tournament:tournaments(name)',
    tournamentFilter: true,
    filters: [{ key: 'result', label: 'All results', opts: E.game_result }],
    toolbarExtra: `<button class="btn sm ghost" data-quick="recompute">Recompute ratings</button>`,
    columns: [
      { label: 'Date', html: (r) => fmtDate(r.played_at) },
      { label: 'White', html: (r) => `${esc(r.white?.full_name)}${r.white_rating_change != null ? ` <span class="muted">${r.white_rating_change > 0 ? '+' : ''}${r.white_rating_change}</span>` : ''}` },
      { label: 'Result', html: (r) => `<b>${esc(r.result)}</b>` },
      { label: 'Black', html: (r) => `${esc(r.black?.full_name)}${r.black_rating_change != null ? ` <span class="muted">${r.black_rating_change > 0 ? '+' : ''}${r.black_rating_change}</span>` : ''}` },
      { label: 'Event', html: (r) => `${esc(r.tournament?.name || 'Friendly')}${r.is_featured ? ' <span class="badge good">featured</span>' : ''}${r.pgn ? ' <span class="badge">pgn</span>' : ''}` },
    ],
    defaults: { result: '*', source: 'otb', rated: true, is_public: true },
    pgnImport: true,
    fields: [
      F.area('pgn', 'PGN', { hint: 'Paste a PGN and press “Fill from PGN” to fill players, result, date and opening.' }),
      F.fk('white_id', 'White', 'players', { required: true }), F.fk('black_id', 'Black', 'players', { required: true }),
      F.enm('result', 'Result', E.game_result), F.enm('termination', 'Termination', E.game_termination, { blank: true }),
      F.dt('played_at', 'Played at'), F.text('time_control', 'Time control', { hint: 'e.g. 10+5' }),
      F.fk('tournament_id', 'Tournament', 'tournaments'), F.fk('round_id', 'Round', 'rounds'),
      F.fk('match_id', 'Team match', 'matches'), F.num('board', 'Board'),
      F.text('eco', 'ECO', { maxlength: 3 }), F.text('opening', 'Opening'), F.num('move_count', 'Moves'),
      F.enm('source', 'Source', E.game_source), F.text('external_url', 'Link (Lichess / Chess.com)'),
      F.bool('rated', 'Rated'), F.bool('is_public', 'Public'), F.bool('is_featured', 'Featured in archive'),
      F.area('notes', 'Notes / annotations'),
    ],
  },

  matches: {
    title: 'Team matches', table: 'matches', order: 'scheduled_at', desc: true,
    select: '*, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name), tournament:tournaments(name)',
    tournamentFilter: true,
    columns: [
      { label: 'Match', html: (r) => `<b>${esc(r.home?.name)}</b> vs <b>${esc(r.away?.name)}</b>` },
      { label: 'Score', num: true, html: (r) => (r.home_score != null ? `${r.home_score} – ${r.away_score}` : '—') },
      { label: 'When', html: (r) => (r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : '—') },
      { label: 'Status', html: (r) => badge(r.status) },
      { label: 'Event', html: (r) => esc(r.tournament?.name || 'Friendly') },
    ],
    defaults: { boards: 4, status: 'scheduled' },
    fields: [
      F.fk('home_team_id', 'Home team', 'teams', { required: true }), F.fk('away_team_id', 'Away team', 'teams', { required: true }),
      F.fk('tournament_id', 'Tournament', 'tournaments'), F.fk('round_id', 'Round', 'rounds'),
      F.num('boards', 'Boards'), F.enm('status', 'Status', E.match_status),
      F.num('home_score', 'Home score', { step: '0.5' }), F.num('away_score', 'Away score', { step: '0.5' }),
      F.dt('scheduled_at', 'Scheduled at'), F.text('venue', 'Venue'), F.area('notes', 'Notes'),
    ],
  },

  teams: {
    title: 'Teams', table: 'teams', order: 'name', select: '*, captain:players(full_name)', search: ['name', 'college', 'season'],
    columns: [
      { label: 'Team', html: (r) => `<b>${esc(r.name)}</b>${r.short_name ? ` <span class="muted">${esc(r.short_name)}</span>` : ''}` },
      { label: 'Season', html: (r) => esc(r.season || '') },
      { label: 'Type', html: (r) => (r.is_external ? `<span class="badge">${esc(r.college || 'external')}</span>` : '<span class="badge good">club</span>') },
      { label: 'Captain', html: (r) => esc(r.captain?.full_name || '') },
    ],
    fields: [
      F.text('name', 'Name', { required: true }), F.text('short_name', 'Short name'), F.text('season', 'Season', { hint: 'e.g. 2026-27' }),
      F.bool('is_external', 'Another college’s team'), F.text('college', 'College'),
      F.fk('captain_id', 'Captain', 'players'), F.text('logo_url', 'Logo URL'), F.area('description', 'Description'),
    ],
  },

  team_members: {
    title: 'Team rosters', table: 'team_members', order: 'board_order',
    select: '*, team:teams(name), player:players(full_name, club_rating)',
    columns: [
      { label: 'Team', html: (r) => esc(r.team?.name) },
      { label: 'Player', html: (r) => `<b>${esc(r.player?.full_name)}</b> <span class="muted">${r.player?.club_rating ?? ''}</span>` },
      { label: 'Role', html: (r) => badge(r.role) },
      { label: 'Board', num: true, html: (r) => r.board_order ?? '' },
      { label: 'Since', html: (r) => fmtDate(r.joined_on) + (r.left_on ? ` – ${fmtDate(r.left_on)}` : '') },
    ],
    defaults: { role: 'member' },
    fields: [F.fk('team_id', 'Team', 'teams', { required: true }), F.fk('player_id', 'Player', 'players', { required: true }),
      F.enm('role', 'Role', E.team_role), F.num('board_order', 'Board order'), F.date('joined_on', 'Joined'), F.date('left_on', 'Left')],
  },

  committee: {
    title: 'Committee', table: 'committee_members', order: 'display_order',
    columns: [
      { label: 'Name', html: (r) => `<b>${esc(r.full_name)}</b>` },
      { label: 'Position', html: (r) => esc(r.position) },
      { label: 'Term', html: (r) => `${fmtDate(r.term_start)} – ${r.term_end ? fmtDate(r.term_end) : 'present'}` },
      { label: 'Shown', html: (r) => badge(r.is_active ? 'active' : 'inactive') },
    ],
    defaults: { is_active: true, display_order: 100 },
    fields: [F.text('full_name', 'Name', { required: true }), F.text('position', 'Position', { required: true }),
      F.text('contact_email', 'Public email'), F.text('contact_phone', 'Public phone'), F.text('photo_url', 'Photo URL'),
      F.date('term_start', 'Term start'), F.date('term_end', 'Term end'), F.bool('is_active', 'Show on site'), F.num('display_order', 'Order')],
  },

  announcements: {
    title: 'Announcements', table: 'announcements', order: 'created_at', desc: true, search: ['title', 'body'],
    columns: [
      { label: 'Title', html: (r) => `<b>${esc(r.title)}</b>${r.pinned ? ' <span class="badge good">pinned</span>' : ''}` },
      { label: 'Status', html: (r) => badge(r.is_published ? 'active' : 'draft') },
      { label: 'Published', html: (r) => fmtDate(r.published_at) },
    ],
    fields: [F.text('title', 'Title', { required: true }), F.area('body', 'Body'),
      F.bool('is_published', 'Published'), F.bool('pinned', 'Pinned'), F.dt('published_at', 'Publish date')],
  },

  milestones: {
    title: 'Milestones', table: 'milestones', order: 'year', desc: true,
    columns: [{ label: 'Year', num: true, html: (r) => r.year }, { label: 'Title', html: (r) => `<b>${esc(r.title)}</b>` }],
    fields: [F.num('year', 'Year', { required: true }), F.text('title', 'Title', { required: true }), F.area('description', 'Description'), F.num('display_order', 'Order')],
  },

  accounts: {
    title: 'Accounts & roles', table: 'profiles', order: 'created_at', desc: true, noCreate: true, noDelete: true,
    select: '*, player:players(full_name, private:player_private(email))',
    columns: [
      { label: 'Account', html: (r) => { const pl = Array.isArray(r.player) ? r.player[0] : r.player;
        return `<b>${esc(pl?.full_name || r.display_name)}</b><br><span class="muted">${esc(pl?.private?.email || '')}</span>`; } },
      { label: 'Role', html: (r) => badge(r.role) },
      { label: 'Joined', html: (r) => fmtDate(r.created_at) },
    ],
    fields: [F.text('display_name', 'Display name'), F.enm('role', 'Role', E.app_role, { hint: 'Admins can manage everything on this site.' })],
  },
};

// ---- state & navigation ------------------------------------------------
let me;
let current = 'overview';
const state = {}; // per-section: { rows, q, filters: {}, tournament }

function renderNav(counts = {}) {
  nav.innerHTML = Object.entries(SECTIONS).map(([k, s]) =>
    `<button type="button" data-section="${k}" aria-current="${k === current}">${s.title}${counts[k] ? `<span class="count">${counts[k]}</span>` : ''}</button>`).join('');
}
nav.addEventListener('click', (e) => {
  const b = e.target.closest('[data-section]');
  if (!b) return;
  current = b.dataset.section;
  history.replaceState(null, '', `#${current}`);
  renderNav(pendingCounts);
  open(current);
});

let pendingCounts = {};
async function refreshCounts() {
  const [p, e] = await Promise.all([
    supabase.from('players').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  pendingCounts = { players: p.count || 0, entries: e.count || 0 };
  renderNav(pendingCounts);
}

async function open(key) {
  const s = SECTIONS[key];
  if (s.custom) return s.custom();
  view.innerHTML = `<p class="empty">Loading ${esc(s.title.toLowerCase())}…</p>`;
  const st = (state[key] ||= { q: '', filters: {}, tournament: '' });
  // Preload any FK lookups the table/filters/forms need.
  const fkTables = new Set(s.fields.filter((f) => f.type === 'fk').map((f) => f.table));
  if (s.tournamentFilter) fkTables.add('tournaments');
  await Promise.all([...fkTables].map((t) => lookup(t)));

  let q = supabase.from(s.table).select(s.select || '*').order(s.order, { ascending: !s.desc, nullsFirst: false }).limit(500);
  if (st.tournament) q = q.eq('tournament_id', st.tournament);
  for (const [k, v] of Object.entries(st.filters)) if (v) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) { view.innerHTML = `<div class="notice error">${esc(errText(error))}</div>`; return; }
  st.rows = data;
  renderTable(key);
}

function renderTable(key) {
  const s = SECTIONS[key];
  const st = state[key];
  const needle = st.q.trim().toLowerCase();
  const rows = needle && s.search
    ? st.rows.filter((r) => s.search.some((c) => String(r[c] ?? '').toLowerCase().includes(needle)))
    : st.rows;

  view.innerHTML = `
    <p class="eyebrow-sm">Admin</p>
    <h1 class="page-title">${esc(s.title)}</h1>
    <div class="toolbar">
      <div class="btn-row">
        ${s.search ? `<input type="search" placeholder="Search…" aria-label="Search" data-search value="${esc(st.q)}">` : ''}
        ${s.tournamentFilter ? `<select data-tfilter aria-label="Tournament"><option value="">All tournaments</option>
          ${(lookupCache.tournaments || []).map((o) => `<option value="${o.id}"${o.id === st.tournament ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` : ''}
        ${(s.filters || []).map((f) => `<select data-filter="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}</option>
          ${f.opts.map((o) => `<option${st.filters[f.key] === o ? ' selected' : ''}>${o}</option>`).join('')}</select>`).join('')}
      </div>
      <div class="btn-row">${s.toolbarExtra || ''}${s.noCreate ? '' : `<button class="btn primary sm" data-new>+ New</button>`}</div>
    </div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr>${s.columns.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>${s.columns.map((c) => `<td${c.num ? ' class="num"' : ''}>${c.html(r) ?? ''}</td>`).join('')}
        <td class="actions">${s.rowActions ? s.rowActions(r) : ''} <button class="btn sm ghost" data-edit="${r.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted" style="margin-top:.6rem;font-size:.85rem">${rows.length} row${rows.length === 1 ? '' : 's'}${st.rows.length >= 500 ? ' (first 500)' : ''}</p>`
    : `<p class="empty">Nothing here yet.</p>`}`;
}

view.addEventListener('input', (e) => {
  if (e.target.matches('[data-search]')) {
    state[current].q = e.target.value;
    const pos = e.target.selectionStart;
    renderTable(current);
    const box = view.querySelector('[data-search]');
    box.focus(); box.setSelectionRange(pos, pos);
  }
});
view.addEventListener('change', (e) => {
  if (e.target.matches('[data-tfilter]')) { state[current].tournament = e.target.value; open(current); }
  if (e.target.matches('[data-filter]')) { state[current].filters[e.target.dataset.filter] = e.target.value; open(current); }
});
view.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-new],[data-edit],[data-quick],[data-goto]');
  if (!t) return;
  if (t.dataset.goto) { current = t.dataset.goto; renderNav(pendingCounts); return open(current); }
  if (t.matches('[data-new]')) return openEditor(current, null);
  if (t.dataset.edit) return openEditor(current, state[current].rows.find((r) => r.id === t.dataset.edit));
  t.disabled = true;
  await quick(t.dataset.quick, t.dataset.id);
  t.disabled = false;
});

async function quick(action, id) {
  let res;
  if (action === 'approve') res = await supabase.from('players').update({ status: 'active' }).eq('id', id);
  else if (action === 'confirm') res = await supabase.from('tournament_entries').update({ status: 'confirmed' }).eq('id', id);
  else if (action === 'reject') res = await supabase.from('tournament_entries').update({ status: 'rejected' }).eq('id', id);
  else if (action === 'recompute') res = await supabase.rpc('recompute_ratings');
  if (res?.error) { toast(errText(res.error), 'error'); return; }
  toast({ approve: 'Player approved.', confirm: 'Entry confirmed.', reject: 'Entry rejected.', recompute: 'Ratings recomputed from all games.' }[action]);
  refreshCounts();
  if (SECTIONS[current].custom) SECTIONS[current].custom(); else open(current);
}

// ---- editor dialog -----------------------------------------------------
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function fieldHtml(f, v) {
  const id = `ed_${f.key}`;
  const req = f.required ? ' required' : '';
  const hint = f.hint ? `<span class="hint">${esc(f.hint)}</span>` : '';
  if (f.type === 'bool') {
    return `<div class="field check${f.wide ? ' wide' : ''}"><input type="checkbox" id="${id}" name="${f.key}"${v ? ' checked' : ''}><label for="${id}">${esc(f.label)}</label></div>`;
  }
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}"${req}>${esc(v)}</textarea>`;
  else if (f.type === 'enum') {
    input = `<select id="${id}" name="${f.key}"${req}>${f.blank ? '<option value=""></option>' : ''}
      ${f.opts.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  } else if (f.type === 'fk') {
    input = `<select id="${id}" name="${f.key}"${req}><option value="">${f.required ? 'Choose…' : '— none —'}</option>
      ${(lookupCache[f.table] || []).map((o) => `<option value="${o.id}"${o.id === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else {
    const type = { number: 'number', date: 'date', datetime: 'datetime-local' }[f.type] || 'text';
    const val = f.type === 'datetime' ? toLocalInput(v) : (v ?? '');
    input = `<input id="${id}" name="${f.key}" type="${type}"${req}${f.step ? ` step="${f.step}"` : ''}${f.maxlength ? ` maxlength="${f.maxlength}"` : ''} value="${esc(val)}">`;
  }
  return `<div class="field${f.wide ? ' wide' : ''}"><label for="${id}">${esc(f.label)}</label>${input}${hint}</div>`;
}

function openEditor(key, row) {
  const s = SECTIONS[key];
  const rec = row || { ...(s.defaults || {}) };
  dialog.innerHTML = `
    <form method="dialog" id="edForm">
      <h3>${row ? 'Edit' : 'New'} · ${esc(s.title)}</h3>
      <div class="form-grid">${s.fields.map((f) => fieldHtml(f, rec[f.key])).join('')}</div>
      <div class="btn-row">
        ${s.pgnImport ? `<button type="button" class="btn ghost" data-pgn style="margin-right:auto">Fill from PGN</button>` : ''}
        ${row && !s.noDelete ? `<button type="button" class="btn danger" data-del>Delete</button>` : ''}
        <button type="button" class="btn ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`;
  const form = dialog.querySelector('form');
  form.querySelector('[data-cancel]').onclick = () => dialog.close();
  if (s.pgnImport) form.querySelector('[data-pgn]').onclick = () => fillFromPgn(form);
  const del = form.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    const { error } = await supabase.from(s.table).delete().eq('id', row.id);
    if (error) { toast(errText(error), 'error'); return; }
    dialog.close(); toast('Deleted.'); afterWrite(s);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    for (const f of s.fields) {
      const el = form.elements[f.key];
      if (f.type === 'bool') { payload[f.key] = el.checked; continue; }
      const raw = el.value.trim();
      if (raw === '') payload[f.key] = null;
      else if (f.type === 'number') payload[f.key] = Number(raw);
      else if (f.type === 'datetime') payload[f.key] = new Date(raw).toISOString();
      else payload[f.key] = raw;
    }
    if (!row && s.table === 'games') payload.created_by = me.user.id;
    if (!row && s.table === 'tournaments') payload.created_by = me.user.id;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    const { error } = row
      ? await supabase.from(s.table).update(payload).eq('id', row.id)
      : await supabase.from(s.table).insert(payload);
    btn.disabled = false;
    if (error) { toast(errText(error), 'error'); return; }
    dialog.close(); toast('Saved.'); afterWrite(s);
  };
  dialog.showModal();
}

function afterWrite(s) {
  if (LOOKUPS[s.table]) lookup(s.table, true);
  refreshCounts();
  open(current);
}

// Fill game fields from PGN headers (players matched by name).
function fillFromPgn(form) {
  const pgn = form.elements.pgn.value;
  if (!pgn.trim()) { toast('Paste a PGN first.', 'error'); return; }
  const tag = (n) => (pgn.match(new RegExp(`\\[${n}\\s+"([^"]*)"\\]`)) || [])[1];
  const players = lookupCache.players || [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const findPlayer = (name) => {
    if (!name) return null;
    const n = norm(name.includes(',') ? name.split(',').reverse().join(' ') : name);
    return players.find((p) => norm(p.label.replace(/\s*\(.*\)$/, '')) === n) || null;
  };
  const filled = [], missing = [];
  for (const [side, key] of [['White', 'white_id'], ['Black', 'black_id']]) {
    const name = tag(side);
    const p = findPlayer(name);
    if (p) { form.elements[key].value = p.id; filled.push(side); } else if (name) missing.push(`${side} “${name}”`);
  }
  const result = tag('Result');
  if (result && E.game_result.includes(result)) form.elements.result.value = result;
  const date = tag('Date') || tag('UTCDate');
  if (date && /^\d{4}\.\d{2}\.\d{2}$/.test(date)) form.elements.played_at.value = `${date.replace(/\./g, '-')}T${(tag('UTCTime') || tag('Time') || '12:00').slice(0, 5)}`;
  if (tag('ECO')) form.elements.eco.value = tag('ECO').slice(0, 3);
  if (tag('Opening')) form.elements.opening.value = tag('Opening');
  const tcTag = tag('TimeControl');
  if (tcTag && /^\d+\+\d+$/.test(tcTag)) { const [b, i] = tcTag.split('+').map(Number); form.elements.time_control.value = `${Math.round(b / 60)}+${i}`; }
  const site = tag('Site') || tag('Link');
  if (site && /^https?:\/\//.test(site)) {
    form.elements.external_url.value = site;
    form.elements.source.value = site.includes('lichess') ? 'lichess' : site.includes('chess.com') ? 'chesscom' : 'other';
  }
  const moves = pgn.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '').match(/\b\d+\.(?!\.)/g);
  if (moves) form.elements.move_count.value = moves.length;
  const term = (tag('Termination') || '').toLowerCase();
  const termMap = { normal: '', 'time forfeit': 'timeout', abandoned: 'abandoned' };
  if (term in termMap && termMap[term]) form.elements.termination.value = termMap[term];
  toast(missing.length ? `Filled. Not found in players: ${missing.join(', ')} — add them first or pick manually.` : 'Filled from PGN.', missing.length ? 'error' : 'ok');
}

// ---- overview ----------------------------------------------------------
async function renderOverview() {
  view.innerHTML = `<p class="empty">Loading overview…</p>`;
  const [pending, entries, upcoming, counts] = await Promise.all([
    supabase.from('players').select('id, full_name, created_at, private:player_private(email)').eq('status', 'pending').order('created_at'),
    supabase.from('tournament_entries').select('id, status, player:players(full_name, club_rating), tournament:tournaments(name)').eq('status', 'pending').order('registered_at'),
    supabase.from('tournaments').select('id, name, status, starts_on, is_published').in('status', ['draft', 'registration_open', 'registration_closed', 'ongoing']).order('starts_on', { nullsFirst: false }),
    Promise.all(['players', 'games', 'tournaments', 'teams'].map((t) => supabase.from(t).select('id', { count: 'exact', head: true }))),
  ]);
  const [np, ng, nt, nteams] = counts.map((c) => c.count ?? 0);
  view.innerHTML = `
    <p class="eyebrow-sm">Admin</p>
    <h1 class="page-title">Overview</h1>
    <p class="page-sub">Welcome back, ${esc(me.player?.full_name || me.profile?.display_name || 'admin')}.</p>
    <div class="stat-row">
      <div class="stat"><b>${np}</b><span>Players</span></div>
      <div class="stat"><b>${nt}</b><span>Tournaments</span></div>
      <div class="stat"><b>${ng}</b><span>Games</span></div>
      <div class="stat"><b>${nteams}</b><span>Teams</span></div>
    </div>
    <div class="grid-2">
      <section class="panel"><h2>Waiting for approval <button class="btn sm ghost" data-goto="players">All players</button></h2>
        ${pending.data?.length ? `<div class="table-wrap"><table class="data-table"><tbody>${pending.data.map((p) => `<tr>
          <td><b>${esc(p.full_name)}</b><br><span class="muted">${esc(p.private?.email || '')} · ${fmtDate(p.created_at)}</span></td>
          <td class="actions"><button class="btn sm" data-quick="approve" data-id="${p.id}">Approve</button></td></tr>`).join('')}</tbody></table></div>`
          : `<p class="empty">No one waiting.</p>`}
      </section>
      <section class="panel"><h2>Entries to confirm <button class="btn sm ghost" data-goto="entries">All entries</button></h2>
        ${entries.data?.length ? `<div class="table-wrap"><table class="data-table"><tbody>${entries.data.map((e) => `<tr>
          <td><b>${esc(e.player?.full_name)}</b> <span class="muted">${e.player?.club_rating ?? ''}</span><br><span class="muted">${esc(e.tournament?.name)}</span></td>
          <td class="actions"><button class="btn sm" data-quick="confirm" data-id="${e.id}">Confirm</button> <button class="btn sm danger" data-quick="reject" data-id="${e.id}">Reject</button></td></tr>`).join('')}</tbody></table></div>`
          : `<p class="empty">Nothing to confirm.</p>`}
      </section>
    </div>
    <section class="panel" style="margin-top:1.5rem"><h2>Active & upcoming tournaments <button class="btn sm ghost" data-goto="tournaments">Manage</button></h2>
      ${upcoming.data?.length ? `<div class="table-wrap"><table class="data-table"><tbody>${upcoming.data.map((t) => `<tr>
        <td><b>${esc(t.name)}</b>${t.is_published ? '' : ' <span class="badge">hidden</span>'}</td><td>${badge(t.status)}</td><td class="num">${fmtDate(t.starts_on)}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="empty">No tournaments planned. Create one under Tournaments.</p>`}
    </section>`;
}

// ---- boot --------------------------------------------------------------
(async () => {
  me = await requireRole('admin');
  document.getElementById('who').textContent = me.player?.full_name || me.user.email;
  const fromHash = location.hash.slice(1);
  if (SECTIONS[fromHash]) current = fromHash;
  renderNav();
  refreshCounts();
  open(current);
})();
