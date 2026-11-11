// Tournament desk — the admin's control room for one tournament.
// Gamified flow: a quest list and one big "next step" button drive the
// tournament from setup to champion. Pairings are generated for the
// tournament's format, previewed (nothing saved yet), editable by
// click-to-swap or drag-and-drop with live rule checks, then confirmed.
import {
  FORMAT_INFO, swissRound, roundRobin, knockoutFirstRound, knockoutNextRound, simulRound, teamLeague,
  checkPairings, playerRecords, koWinner, roundName, decided, points,
} from './fixtures.js';

let ctx;            // { supabase, toast, errText, esc, view, openGameStudio, editTournament, goto }
let D = null;       // loaded tournament state
let ui = { tab: 'rounds', round: null, edit: null, sel: null };

const RESULT_BTNS = [['1-0', '1–0'], ['1/2-1/2', '½'], ['0-1', '0–1']];
const MORE = [['+/-', 'White wins (forfeit)'], ['-/+', 'Black wins (forfeit)'], ['0-0', 'Double forfeit'], ['*', 'Clear result']];
const STAGES = ['Setup', 'Entries', 'Pairings', 'Playing', 'Finished'];

const esc = (v) => ctx.esc(v);
const isTeam = () => D.t.kind === 'team' || D.t.format === 'team_league';
const fmt = () => FORMAT_INFO[D.t.format] || FORMAT_INFO.swiss;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function load(tid) {
  const sb = ctx.supabase;
  const [t, entries, rounds, games, byes, matches, standings, teamSt, players] = await Promise.all([
    sb.from('tournaments').select('*').eq('id', tid).single(),
    sb.from('tournament_entries').select('*, player:players(id, full_name, club_rating, lichess_username), team:teams(id, name)').eq('tournament_id', tid),
    sb.from('rounds').select('*').eq('tournament_id', tid).order('number'),
    sb.from('games').select('id, round_id, match_id, board, white_id, black_id, result, advance_id, home_side, pgn, analysis_pgn').eq('tournament_id', tid),
    sb.from('tournament_byes').select('*').eq('tournament_id', tid),
    sb.from('matches').select('*').eq('tournament_id', tid),
    sb.from('tournament_standings').select('*').eq('tournament_id', tid).order('rank'),
    sb.from('team_standings').select('*').eq('tournament_id', tid),
    sb.from('players').select('id, full_name, club_rating, status, is_external').order('full_name'),
  ]);
  const err = [t, entries, rounds, games, byes, matches, standings, teamSt, players].find((r) => r.error);
  if (err) throw err.error;
  D = {
    t: t.data, entries: entries.data, rounds: rounds.data, games: games.data, byes: byes.data, matches: matches.data,
    standings: standings.data, teamStandings: teamSt.data, players: players.data,
  };
  D.pmap = new Map(D.players.map((p) => [p.id, p]));
  if (isTeam()) {
    const teamIds = D.entries.filter((e) => e.team_id).map((e) => e.team_id);
    const { data } = teamIds.length
      ? await sb.from('team_members').select('team_id, player_id, board_order, left_on').in('team_id', teamIds).is('left_on', null).order('board_order', { nullsFirst: false })
      : { data: [] };
    D.rosters = new Map();
    for (const m of data || []) { if (!D.rosters.has(m.team_id)) D.rosters.set(m.team_id, []); D.rosters.get(m.team_id).push(m.player_id); }
  }
}

const name = (id) => D.pmap.get(id)?.full_name || '—';
const rating = (id) => D.pmap.get(id)?.club_rating ?? '';
const confirmed = () => D.entries.filter((e) => e.status === 'confirmed');
const confirmedPlayers = () => confirmed().filter((e) => e.player_id).map((e) => ({ id: e.player_id, name: name(e.player_id), rating: D.pmap.get(e.player_id)?.club_rating || 0, seed: e.seed }));
const gamesOf = (rid) => D.games.filter((g) => g.round_id === rid).sort((a, b) => (a.board || 0) - (b.board || 0));
const byesOf = (rid) => D.byes.filter((b) => b.round_id === rid);
const roundNo = (rid) => D.rounds.find((r) => r.id === rid)?.number || 0;
const history = (beforeNo = Infinity) => ({
  games: D.games.filter((g) => roundNo(g.round_id) < beforeNo).map((g) => ({ white: g.white_id, black: g.black_id, result: g.result, round: roundNo(g.round_id), board: g.board, advance: g.advance_id })),
  byes: D.byes.filter((b) => roundNo(b.round_id) < beforeNo).map((b) => ({ player: b.player_id, points: b.points, round: roundNo(b.round_id), slot: b.slot })),
});

function expectedGames() {
  const n = isTeam() ? confirmed().filter((e) => e.team_id).length : confirmedPlayers().length;
  switch (D.t.format) {
    case 'round_robin': return (n * (n - 1)) / 2;
    case 'double_round_robin': return n * (n - 1);
    case 'knockout': return Math.max(0, n - 1);
    case 'simul': return Math.max(0, n - 1);
    case 'swiss': return (D.t.rounds_planned || 0) * Math.floor(n / 2);
    case 'team_league': return D.matches.length ? D.games.filter((g) => g.match_id).length : (n * (n - 1)) / 2 * (D.t.settings?.boards || 4);
    default: return D.games.length;
  }
}
function progress() {
  const done = D.games.filter(decided).length;
  const total = Math.max(expectedGames(), D.games.length, 1);
  return { done, total, pct: D.t.status === 'completed' ? 100 : Math.min(100, Math.round((done / total) * 100)) };
}
const suggestedRounds = (n) => Math.max(3, Math.ceil(Math.log2(Math.max(n, 2))) + 1);

// ---------------------------------------------------------------------------
// What should the admin do now? → { label, hint, run, tone }
// ---------------------------------------------------------------------------
function quests() {
  const t = D.t;
  const pending = D.entries.filter((e) => e.status === 'pending').length;
  const nConf = confirmed().length;
  const last = D.rounds[D.rounds.length - 1];
  const lastOpen = last ? gamesOf(last.id).filter((g) => !decided(g)).length : 0;
  const lastKoTies = last && t.format === 'knockout' ? gamesOf(last.id).filter((g) => decided(g) && !koWinner({ ...g, white: g.white_id, black: g.black_id, advance: g.advance_id })).length : 0;
  const generatedAll = ['round_robin', 'double_round_robin', 'team_league', 'simul'].includes(t.format) && D.rounds.length > 0;
  const swissDone = t.format === 'swiss' && t.rounds_planned && D.rounds.length >= t.rounds_planned;
  const koDone = t.format === 'knockout' && last && !lastOpen && !lastKoTies && gamesOf(last.id).length + byesOf(last.id).length === 1 && gamesOf(last.id).length === 1;
  const allDecided = D.games.length > 0 && D.games.every(decided) && !lastKoTies;
  const manual = FORMAT_INFO[t.format]?.generated === 'manual';

  const list = [
    { key: 'publish', label: 'Publish it on the site', done: t.is_published, run: () => patchT({ is_published: true }, 'Published — it’s on the site now.') },
    { key: 'reg', label: 'Open registration', done: !['draft'].includes(t.status), run: () => patchT({ status: 'registration_open' }, 'Registration is open.') },
    { key: 'entries', label: pending ? `Confirm ${pending} pending entr${pending === 1 ? 'y' : 'ies'}` : `Get at least 2 confirmed entr${isTeam() ? 'ies (teams)' : 'ies'}`, done: !pending && nConf >= 2, run: pending ? confirmAll : () => { ui.tab = 'entries'; render(); } },
  ];
  if (t.format === 'swiss') list.push({ key: 'rounds', label: t.rounds_planned ? `Plan ${t.rounds_planned} rounds` : `Set the number of rounds (suggested ${suggestedRounds(nConf)})`, done: !!t.rounds_planned, run: () => patchT({ rounds_planned: suggestedRounds(nConf) }, `Set to ${suggestedRounds(nConf)} rounds.`) });
  if (t.format === 'simul') list.push({ key: 'host', label: t.settings?.simul_host ? `Host: ${name(t.settings.simul_host)}` : 'Choose the simul host', done: !!t.settings?.simul_host, run: () => { ui.tab = 'entries'; render(); } });
  if (manual) list.push({ key: 'manual', label: 'Add games as they are played', done: D.games.length > 0, run: addManualGame });
  else list.push({ key: 'pair', label: D.rounds.length ? (generatedAll ? 'All rounds created' : `Round ${D.rounds.length} paired`) : (generatedAll || ['round_robin', 'double_round_robin', 'team_league'].includes(t.format) ? 'Create the schedule' : 'Pair round 1'), done: D.rounds.length > 0, run: propose });
  list.push({ key: 'results', label: D.games.length ? `Enter results (${progress().done}/${progress().total})` : 'Enter results', done: allDecided && (swissDone || generatedAll || koDone || manual), run: () => { ui.tab = 'rounds'; render(); } });
  list.push({ key: 'finish', label: 'Finish & crown the winner', done: t.status === 'completed', run: finish });

  // The single most useful next step.
  let next;
  if (t.status === 'completed') next = { label: 'Tournament finished', hint: winnerLine(), tone: 'done' };
  else if (nConf < 2) next = { label: pending ? `Confirm ${pending} entr${pending === 1 ? 'y' : 'ies'}` : 'Add entrants', hint: 'Confirmed entrants are paired. Add players directly or confirm registrations.', run: pending ? confirmAll : () => { ui.tab = 'entries'; render(); } };
  else if (t.format === 'swiss' && !t.rounds_planned) next = { label: `Plan ${suggestedRounds(nConf)} rounds`, hint: `${nConf} players → ${suggestedRounds(nConf)} rounds finds a clear winner.`, run: list.find((q) => q.key === 'rounds').run };
  else if (t.format === 'simul' && !t.settings?.simul_host) next = { label: 'Choose the host', hint: 'Pick who gives the simul in Entrants.', run: () => { ui.tab = 'entries'; render(); } };
  else if (manual) next = { label: 'Record a game', hint: 'Arena and ladder games are added as they are played.', run: addManualGame };
  else if (!D.rounds.length) next = { label: ['round_robin', 'double_round_robin', 'team_league'].includes(t.format) ? 'Create the full schedule' : t.format === 'simul' ? 'Set up the boards' : 'Pair round 1', hint: 'You’ll see a preview first — nothing is saved until you confirm.', run: propose };
  else if (lastOpen || (generatedAll && D.games.some((g) => !decided(g)))) {
    // Point at the earliest round still missing results.
    const open = D.games.filter((g) => !decided(g)).length;
    const first = D.rounds.find((r) => gamesOf(r.id).some((g) => !decided(g))) || last;
    next = { label: `Enter results · ${open} to go`, hint: `Round ${first.number}: tap 1–0, ½ or 0–1 on each board.`, run: () => { ui.tab = 'rounds'; ui.round = first.id; render(); } };
  }
  else if (lastKoTies) next = { label: `Decide ${lastKoTies} tiebreak${lastKoTies === 1 ? '' : 's'}`, hint: 'Drawn knockout games need to know who goes through.', run: () => { ui.tab = 'rounds'; ui.round = last.id; render(); } };
  else if (t.format === 'swiss' && D.rounds.length < (t.rounds_planned || 0)) next = { label: `Pair round ${D.rounds.length + 1}`, hint: 'Same scores meet, no rematches, colours balanced.', run: propose };
  else if (t.format === 'knockout' && !koDone) next = { label: `Pair the ${nextKoName()}`, hint: 'Winners advance in bracket order.', run: propose };
  else next = { label: 'Finish & crown the winner', hint: winnerLine(), run: finish, tone: 'gold' };
  return { list, next };
}

function nextKoName() {
  const last = D.rounds[D.rounds.length - 1];
  const slots = gamesOf(last.id).length + byesOf(last.id).length;
  return roundName(Math.ceil(slots / 2)).toLowerCase();
}

function leader() {
  if (D.t.format === 'knockout') {
    const last = D.rounds[D.rounds.length - 1];
    const g = last && gamesOf(last.id).length === 1 && byesOf(last.id).length === 0 ? gamesOf(last.id)[0] : null;
    const w = g && koWinner({ ...g, white: g.white_id, black: g.black_id, advance: g.advance_id });
    return w ? name(w) : null;
  }
  if (isTeam()) {
    const top = [...D.teamStandings].sort((a, b) => b.match_points - a.match_points || b.board_points - a.board_points)[0];
    return top?.name || null;
  }
  return D.standings[0]?.full_name || null;
}
function winnerLine() { const l = leader(); return l ? `${D.t.status === 'completed' ? 'Champion' : 'Leading'}: ${l}` : 'Results decide the winner.'; }

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function patchT(patch, msg) {
  const { error } = await ctx.supabase.from('tournaments').update(patch).eq('id', D.t.id);
  if (error) { ctx.toast(ctx.errText(error), 'error'); return; }
  ctx.toast(msg); await refresh();
}
async function confirmAll() {
  const ids = D.entries.filter((e) => e.status === 'pending').map((e) => e.id);
  const { error } = await ctx.supabase.from('tournament_entries').update({ status: 'confirmed' }).in('id', ids);
  if (error) { ctx.toast(ctx.errText(error), 'error'); return; }
  ctx.toast(`${ids.length} confirmed.`); await refresh();
}
async function finish() {
  const open = D.games.filter((g) => !decided(g)).length;
  if (open && !confirm(`${open} game${open === 1 ? ' has' : 's have'} no result. Finish anyway?`)) return;
  await patchT({ status: 'completed', ends_on: D.t.ends_on || new Date().toISOString().slice(0, 10) }, 'Tournament finished!');
  celebrate(true);
}
function addManualGame() {
  ctx.openGameStudio(null, { tournament_id: D.t.id, source: D.t.mode === 'online' ? 'lichess' : 'otb', rated: D.t.rated }, refresh);
}

async function refresh() {
  const keepRound = ui.round;
  await load(D.t.id);
  ui.round = D.rounds.some((r) => r.id === keepRound) ? keepRound : D.rounds[D.rounds.length - 1]?.id || null;
  render();
}

// ---- pairing proposals -------------------------------------------------------
function propose() {
  const t = D.t;
  const players = confirmedPlayers();
  const nextNo = (D.rounds[D.rounds.length - 1]?.number || 0) + 1;
  const byePoints = Number(t.settings?.bye_points ?? 1);
  if (t.format === 'swiss') {
    const h = history();
    const { pairings, bye, warnings } = swissRound(players, h.games, h.byes, { byePoints });
    openEdit({ preview: true, number: nextNo, pairings: pairings.map((p, i) => ({ ...p, board: i + 1 })), byes: bye ? [bye] : [], warnings });
  } else if (t.format === 'knockout') {
    if (!D.rounds.length) {
      const r = knockoutFirstRound(players);
      openEdit({ preview: true, number: 1, pairings: r.pairings, byes: r.byes, warnings: r.byes.length ? [`${r.byes.length} top seed${r.byes.length === 1 ? ' gets a bye' : 's get byes'} into round 2 (bracket of ${r.slots * 2}).`] : [], ko: true });
    } else {
      const last = D.rounds[D.rounds.length - 1];
      const colours = new Map();
      for (const g of [...D.games].sort((a, b) => roundNo(a.round_id) - roundNo(b.round_id))) {
        colours.set(g.white_id, [...(colours.get(g.white_id) || []), 'w']); colours.set(g.black_id, [...(colours.get(g.black_id) || []), 'b']);
      }
      const r = knockoutNextRound(gamesOf(last.id).map((g) => ({ white: g.white_id, black: g.black_id, result: g.result, board: g.board, advance: g.advance_id })),
        byesOf(last.id).map((b) => ({ player: b.player_id, slot: b.slot })), (id) => D.pmap.get(id)?.club_rating || 0, colours);
      if (r.missing.length) { ctx.toast(`Board${r.missing.length > 1 ? 's' : ''} ${r.missing.join(', ')} still need a result or tiebreak.`, 'error'); return; }
      if (r.done) { finish(); return; }
      openEdit({ preview: true, number: nextNo, pairings: r.pairings, byes: r.byes, ko: true, warnings: [] });
    }
  } else if (t.format === 'round_robin' || t.format === 'double_round_robin') {
    const ordered = [...players].sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9) || b.rating - a.rating);
    const sched = roundRobin(ordered.map((p) => p.id), { double: t.format === 'double_round_robin' });
    openSchedule(sched.map((rd, i) => ({ number: i + 1, pairings: rd.pairings.map((p, b) => ({ ...p, board: b + 1 })), byes: rd.bye ? [{ player: rd.bye, points: byePoints }] : [] })));
  } else if (t.format === 'team_league') {
    const teams = confirmed().filter((e) => e.team_id).map((e) => e.team_id);
    const short = teams.filter((id) => (D.rosters.get(id) || []).length < (t.settings?.boards || 4));
    const sched = teamLeague(teams, D.rosters, { boards: t.settings?.boards || 4, double: !!t.settings?.double });
    openSchedule(sched.map((rd, i) => ({
      number: i + 1,
      matches: rd.matches.map((m) => ({ ref: m.ref, home_team_id: m.home, away_team_id: m.away, boards: m.boards })),
      pairings: rd.matches.flatMap((m) => m.games.map((g) => ({ ...g, match_ref: m.ref }))),
      teamBye: rd.bye, byes: [],
    })), short.length ? [`${short.map((id) => teamName(id)).join(', ')} ${short.length === 1 ? 'has' : 'have'} fewer players on the roster than boards (${t.settings?.boards || 4}) — add them under Team rosters.`] : []);
  } else if (t.format === 'simul') {
    const host = t.settings?.simul_host;
    const ps = simulRound(host, players.map((p) => p.id), t.settings?.host_colour || 'white');
    openEdit({ preview: true, number: 1, pairings: ps, byes: [], warnings: [] });
  }
}
const teamName = (id) => D.entries.find((e) => e.team_id === id)?.team?.name || 'Team';

function openEdit(e) {
  ui.edit = { ...e, pairings: e.pairings.map((p) => ({ ...p })), byes: (e.byes || []).map((b) => ({ ...b })), warnings: e.warnings || [] };
  ui.sel = null;
  ui.tab = 'rounds';
  render();
  ctx.view.querySelector('.desk-edit')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function editRound(rid) {
  const r = D.rounds.find((x) => x.id === rid);
  if (D.games.some((g) => g.round_id === rid && g.match_id)) { ctx.toast('Team-match boards are edited under Games → All fields, or delete and regenerate the round.', 'error'); return; }
  openEdit({
    preview: false, roundId: rid, number: r.number, ko: D.t.format === 'knockout',
    pairings: gamesOf(rid).map((g) => ({ id: g.id, white: g.white_id, black: g.black_id, board: g.board, locked: decided(g) })),
    byes: byesOf(rid).map((b) => ({ player: b.player_id, points: Number(b.points), slot: b.slot })),
  });
}

let schedulePreview = null;
function openSchedule(rounds, warnings = []) {
  schedulePreview = { rounds, warnings };
  ui.edit = null;
  ui.tab = 'rounds';
  render();
}

async function confirmSchedule() {
  const btn = ctx.view.querySelector('[data-act="confirm-schedule"]');
  btn.disabled = true;
  const at = D.t.starts_on ? new Date(`${D.t.starts_on}T10:00:00`) : null;
  for (const r of schedulePreview.rounds) {
    const { error } = await ctx.supabase.rpc('create_round', {
      p_tournament: D.t.id, p_number: r.number,
      p_pairings: r.pairings.map((p) => ({ board: p.board, white_id: p.white, black_id: p.black, home_side: p.home_side || null, match_ref: p.match_ref || null })),
      p_byes: r.byes.map((b) => ({ player_id: b.player, points: b.points })),
      p_matches: r.matches || [],
      p_scheduled_at: at ? new Date(at.getTime() + (r.number - 1) * 7 * 864e5).toISOString() : null,
    });
    if (error) { ctx.toast(`Round ${r.number}: ${ctx.errText(error)}`, 'error'); btn.disabled = false; await refresh(); return; }
  }
  ctx.toast(`${schedulePreview.rounds.length} rounds created.`);
  schedulePreview = null;
  celebrate();
  await refresh();
}

async function saveEdit() {
  const e = ui.edit;
  const chk = checkEdit();
  if (chk.errors.length) return;
  const btn = ctx.view.querySelector('[data-act="save-edit"]');
  btn.disabled = true;
  const pairings = e.pairings.map((p, i) => ({ id: p.id || null, board: e.ko ? p.board : i + 1, white_id: p.white, black_id: p.black }));
  const byes = e.byes.map((b) => ({ player_id: b.player, points: b.points, slot: b.slot ?? null }));
  const { error } = e.preview
    ? await ctx.supabase.rpc('create_round', { p_tournament: D.t.id, p_number: e.number, p_pairings: pairings, p_byes: byes })
    : await ctx.supabase.rpc('save_round_pairings', { p_round: e.roundId, p_pairings: pairings, p_byes: byes });
  btn.disabled = false;
  if (error) { ctx.toast(ctx.errText(error), 'error'); return; }
  ctx.toast(e.preview ? `Round ${e.number} is live — good luck to everyone!` : 'Pairings updated.');
  if (e.preview) celebrate();
  ui.edit = null;
  await refresh();
  if (e.preview) ui.round = D.rounds[D.rounds.length - 1]?.id;
  render();
}

function checkEdit() {
  const e = ui.edit;
  const h = history(e.number);
  const res = checkPairings(e.pairings, e.byes, h, name);
  const errors = [...res.errors];
  if (!e.pairings.length && !e.byes.length) errors.push('The round has no boards.');
  const onBoard = new Set(e.pairings.flatMap((p) => [p.white, p.black]).concat(e.byes.map((b) => b.player)));
  const unpaired = confirmedPlayers().filter((p) => !onBoard.has(p.id));
  return { errors, boards: res.boards, unpaired };
}

// ---- results ------------------------------------------------------------------
async function setResult(gid, result, advance = undefined) {
  const g = D.games.find((x) => x.id === gid);
  const prev = { result: g.result, advance_id: g.advance_id };
  const patch = { result };
  if (advance !== undefined) patch.advance_id = advance;
  else if (result !== '1/2-1/2' && result !== '0-0') patch.advance_id = null;
  Object.assign(g, patch);
  render();
  const { error } = await ctx.supabase.from('games').update(patch).eq('id', gid);
  if (error) { Object.assign(g, prev); render(); ctx.toast(ctx.errText(error), 'error'); return; }
  const r = D.rounds.find((x) => x.id === g.round_id);
  const roundDone = r && gamesOf(r.id).every(decided);
  if (r && roundDone !== (r.status === 'completed')) {
    await ctx.supabase.from('rounds').update({ status: roundDone ? 'completed' : 'ongoing' }).eq('id', r.id);
  }
  ctx.toast(result === '*' ? 'Result cleared.' : `Board ${g.board}: ${name(g.white_id)} ${result.replace('1/2-1/2', '½–½')} ${name(g.black_id)}`, 'ok',
    { action: 'Undo', run: () => setResult(gid, prev.result, prev.advance_id) });
  if (roundDone && r.status !== 'completed') celebrate();
  await refresh();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  if (!D) return;
  const t = D.t;
  const { list, next } = quests();
  const pg = progress();
  const stage = t.status === 'completed' ? 4 : D.games.some(decided) ? 3 : D.rounds.length ? 2 : confirmed().length >= 2 ? 1 : 0;
  const doneCount = list.filter((q) => q.done).length;
  ctx.view.innerHTML = `
    <div class="desk">
      <button class="link-btn desk-back" data-act="back">← All tournaments</button>
      <header class="desk-head">
        <div>
          <p class="eyebrow-sm">${esc(fmt().label)} · ${t.mode === 'online' ? 'Online (Lichess)' : 'Over the board'}${t.rated ? ' · rated' : ''}</p>
          <h1 class="page-title">${esc(t.name)}</h1>
          <p class="page-sub">${esc(fmt().blurb)}</p>
        </div>
        <div class="desk-ring" style="--p:${pg.pct}" role="img" aria-label="${pg.pct}% complete"><b>${pg.pct}%</b><span>${pg.done}/${pg.total} games</span></div>
      </header>

      <ol class="desk-stages">${STAGES.map((s, i) => `<li class="${i < stage ? 'done' : i === stage ? 'now' : ''}"><span>${i < stage ? '✓' : i + 1}</span>${s}</li>`).join('')}</ol>

      <div class="desk-top">
        <section class="desk-next ${next.tone || ''}">
          <p class="eyebrow-sm">Next step</p>
          <h2>${esc(next.label)}</h2>
          <p>${esc(next.hint || '')}</p>
          ${next.run ? '<button class="btn primary desk-go" data-act="next">Do it →</button>' : ''}
        </section>
        <section class="desk-quests">
          <p class="eyebrow-sm">Quests · ${doneCount}/${list.length}</p>
          <div class="desk-xp"><i style="width:${(doneCount / list.length) * 100}%"></i></div>
          <ul>${list.map((q, i) => `<li class="${q.done ? 'done' : ''}"><span class="qk">${q.done ? '✓' : ''}</span>${esc(q.label)}${!q.done && q.run ? ` <button class="link-btn" data-quest="${i}">go</button>` : ''}</li>`).join('')}</ul>
        </section>
      </div>

      <div class="tabs desk-tabs" role="tablist">
        ${[['rounds', isTeam() ? 'Matches' : 'Rounds'], ['entries', `Entrants (${confirmed().length})`], ['table', t.format === 'knockout' ? 'Bracket' : ['round_robin', 'double_round_robin'].includes(t.format) ? 'Crosstable' : 'Standings']]
          .map(([k, l]) => `<button type="button" role="tab" aria-selected="${ui.tab === k}" data-tab="${k}">${l}</button>`).join('')}
        <span class="desk-tabs-x"><button class="btn sm ghost" data-act="edit-t">Settings</button></span>
      </div>
      <div class="desk-pane">${ui.tab === 'entries' ? entriesHtml() : ui.tab === 'table' ? tableHtml() : roundsHtml()}</div>
    </div>`;
  ctx.view.__quests = list;
  ctx.view.__next = next;
}

// ---- rounds pane -----------------------------------------------------------------
function roundsHtml() {
  if (ui.edit) return editHtml();
  if (schedulePreview) return scheduleHtml();
  if (!D.rounds.length) {
    const manual = fmt().generated === 'manual';
    return `<div class="desk-empty"><p>${manual ? 'No games yet.' : 'No rounds yet.'}</p>
      ${manual ? '<button class="btn primary" data-act="manual">+ Record a game</button>' : '<button class="btn primary" data-act="propose">Generate pairings</button> <button class="btn ghost" data-act="manual-round">Pair manually</button>'}</div>`;
  }
  if (!ui.round || !D.rounds.some((r) => r.id === ui.round)) ui.round = D.rounds[D.rounds.length - 1].id;
  const r = D.rounds.find((x) => x.id === ui.round);
  const gs = gamesOf(r.id), bs = byesOf(r.id);
  const done = gs.filter(decided).length;
  const isLast = r.id === D.rounds[D.rounds.length - 1].id;
  const rec = playerRecords(confirmedPlayers(), history(r.number).games, history(r.number).byes);
  const chk = checkPairings(gs.map((g) => ({ white: g.white_id, black: g.black_id })), [], history(r.number), name);
  const koSlots = D.t.format === 'knockout' ? gs.length + bs.length : 0;
  const matches = D.matches.filter((m) => m.round_id === r.id);
  return `
    <div class="round-chips">${D.rounds.map((x) => {
      const g2 = gamesOf(x.id), d2 = g2.filter(decided).length;
      return `<button type="button" class="rchip ${x.id === r.id ? 'on' : ''} ${g2.length && d2 === g2.length ? 'done' : ''}" data-round="${x.id}">${D.t.format === 'knockout' ? esc(roundName(Math.ceil((g2.length + byesOf(x.id).length)))) : `R${x.number}`}<i>${d2}/${g2.length}</i></button>`;
    }).join('')}
    ${canPairNext() ? '<button type="button" class="rchip add" data-act="propose">+ Next round</button>' : ''}
    ${fmt().generated === 'manual' ? '<button type="button" class="rchip add" data-act="manual">+ Game</button>' : ''}</div>

    <div class="round-head">
      <div><h2>${D.t.format === 'knockout' ? esc(roundName(koSlots)) : `Round ${r.number}`}</h2>
        <div class="round-bar"><i style="width:${gs.length ? (done / gs.length) * 100 : 0}%"></i></div>
        <p class="muted">${done}/${gs.length} results${r.scheduled_at ? ` · ${new Date(r.scheduled_at).toLocaleString()}` : ''}</p></div>
      <div class="btn-row">
        ${!matches.length ? `<button class="btn sm ghost" data-act="edit-round" data-id="${r.id}">✎ Edit pairings</button>` : ''}
        ${isLast ? `<button class="btn sm danger" data-act="del-round" data-id="${r.id}">Delete round</button>` : ''}
      </div>
    </div>
    ${matches.length ? matches.map((m) => matchHtml(m, gs.filter((g) => g.match_id === m.id))).join('') : `<div class="boards">${gs.map((g, i) => boardHtml(g, rec, chk.boards.get(i) || [])).join('')}</div>`}
    ${bs.length ? `<p class="byes"><b>Bye${bs.length > 1 ? 's' : ''}:</b> ${bs.map((b) => `${esc(name(b.player_id))} <span class="muted">+${Number(b.points)}</span>`).join(', ')}</p>` : ''}`;
}

function canPairNext() {
  const t = D.t, last = D.rounds[D.rounds.length - 1];
  if (!last || t.status === 'completed') return false;
  // Only once the latest round is fully decided (knockout ties included).
  if (gamesOf(last.id).some((g) => !decided(g) || (t.format === 'knockout' && !koWinner({ ...g, white: g.white_id, black: g.black_id, advance: g.advance_id })))) return false;
  if (t.format === 'swiss') return D.rounds.length < (t.rounds_planned || 99);
  if (t.format === 'knockout') return gamesOf(last.id).length + byesOf(last.id).length > 1;
  return false;
}

function boardHtml(g, rec, warns) {
  const w = rec.get(g.white_id), b = rec.get(g.black_id);
  const ko = D.t.format === 'knockout';
  const needsTie = ko && decided(g) && !koWinner({ ...g, white: g.white_id, black: g.black_id, advance: g.advance_id });
  const winner = ko ? koWinner({ ...g, white: g.white_id, black: g.black_id, advance: g.advance_id }) : null;
  const pl = (id, r, side) => `<div class="bp ${side}${winner === id ? ' win' : ''}"><span class="pc ${side}" aria-hidden="true"></span><b>${esc(name(id))}</b><small>${rating(id)}${r ? ` · ${r.score} pt${r.score === 1 ? '' : 's'}` : ''}</small></div>`;
  return `<article class="board-card ${decided(g) ? 'decided' : ''} ${needsTie ? 'tie' : ''}" data-game="${g.id}">
    <span class="bno">${g.board ?? ''}</span>
    ${pl(g.white_id, w, 'w')}
    <div class="res" role="group" aria-label="Result">${RESULT_BTNS.map(([v, l]) => `<button type="button" data-res="${v}" aria-pressed="${g.result === v}">${l}</button>`).join('')}
      <select data-more aria-label="More results"><option value="">⋯</option>${MORE.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
    ${pl(g.black_id, b, 'b')}
    <div class="bfoot">
      ${['+/-', '-/+', '0-0'].includes(g.result) ? `<span class="tag">${esc(MORE.find(([v]) => v === g.result)[1])}</span>` : ''}
      ${warns.map((x) => `<span class="tag warn">⚠ ${esc(x)}</span>`).join('')}
      ${needsTie ? `<span class="tie-ask">Draw — who goes through? <button type="button" class="btn sm" data-adv="${g.white_id}">${esc(name(g.white_id))}</button> <button type="button" class="btn sm" data-adv="${g.black_id}">${esc(name(g.black_id))}</button></span>` : ''}
      ${ko && g.advance_id && decided(g) && ['1/2-1/2', '0-0'].includes(g.result) ? `<span class="tag">${esc(name(g.advance_id))} won the tiebreak</span>` : ''}
      <button type="button" class="link-btn" data-moves="${g.id}">${g.pgn || g.analysis_pgn ? '▸ Moves' : '+ Record moves'}</button>
    </div>
  </article>`;
}

function matchHtml(m, gs) {
  const home = D.entries.find((e) => e.team_id === m.home_team_id)?.team?.name || 'Home';
  const away = D.entries.find((e) => e.team_id === m.away_team_id)?.team?.name || 'Away';
  return `<section class="match-card">
    <header><b>${esc(home)}</b><span class="mscore">${m.home_score ?? 0} – ${m.away_score ?? 0}</span><b>${esc(away)}</b></header>
    <div class="boards">${gs.map((g) => boardHtml(g, new Map(), [])).join('') || '<p class="empty">No boards (rosters empty).</p>'}</div>
  </section>`;
}

// ---- pairing editor -------------------------------------------------------------
function editHtml() {
  const e = ui.edit;
  const { errors, boards, unpaired } = checkEdit();
  const chip = (id, pos, locked) => id
    ? `<button type="button" class="pchip ${ui.sel && samePos(ui.sel, pos) ? 'sel' : ''}" draggable="${!locked}" data-pos='${JSON.stringify(pos)}' ${locked ? 'disabled title="Has a result"' : ''}><b>${esc(name(id))}</b><small>${rating(id)}</small></button>`
    : `<button type="button" class="pchip empty ${ui.sel && samePos(ui.sel, pos) ? 'sel' : ''}" data-pos='${JSON.stringify(pos)}'>empty</button>`;
  return `<section class="desk-edit">
    <header class="edit-head">
      <div><p class="eyebrow-sm">${e.preview ? 'Preview — nothing is saved yet' : 'Editing pairings'}</p>
        <h2>${e.ko ? 'Bracket' : 'Round'} ${e.number}</h2>
        <p class="muted">Tap two players to swap them (or drag one onto another). ⇄ swaps colours. Empty slots take a player from the pool.</p></div>
      <div class="btn-row">
        <button class="btn ghost" data-act="cancel-edit">Cancel</button>
        <button class="btn primary" data-act="save-edit" ${errors.length ? 'disabled' : ''}>${e.preview ? `Confirm & start round ${e.number}` : 'Save pairings'}</button>
      </div>
    </header>
    ${[...e.warnings.map((w) => `<li class="warn">${esc(w)}</li>`), ...errors.map((x) => `<li class="err">${esc(x)}</li>`)].length
      ? `<ul class="st-checks">${e.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join('')}${errors.map((x) => `<li class="err">${esc(x)}</li>`).join('')}</ul>` : '<ul class="st-checks"><li class="quiet">✓ No problems found.</li></ul>'}
    <div class="edit-boards">
      ${e.pairings.map((p, i) => `<div class="edit-row ${p.locked ? 'locked' : ''}">
        <span class="bno">${e.ko ? p.board : i + 1}</span>
        ${chip(p.white, { k: 'b', i, s: 'white' }, p.locked)}
        <button type="button" class="swapc" data-swapc="${i}" title="Swap colours" ${p.locked ? 'disabled' : ''}>⇄</button>
        ${chip(p.black, { k: 'b', i, s: 'black' }, p.locked)}
        <span class="ewarn">${(boards.get(i) || []).map((w) => `<span class="tag warn">⚠ ${esc(w)}</span>`).join('')}</span>
        ${p.locked ? '<span class="tag">has result</span>' : `<button type="button" class="link-btn" data-rmboard="${i}" title="Remove board">✕</button>`}
      </div>`).join('')}
      <button type="button" class="btn sm ghost" data-act="add-board">+ Add board</button>
    </div>
    <div class="edit-pools">
      <div class="pool"><p class="eyebrow-sm">Not paired (${unpaired.length})</p>
        <div class="pool-chips">${unpaired.map((p) => chip(p.id, { k: 'p', id: p.id })).join('') || '<span class="muted">Everyone is paired.</span>'}</div></div>
      <div class="pool byez"><p class="eyebrow-sm">Byes</p>
        <div class="pool-chips">${e.byes.map((b, i) => chip(b.player, { k: 'y', i })).join('')}<button type="button" class="pchip empty ${ui.sel?.k === 'newbye' ? 'sel' : ''}" data-pos='{"k":"newbye"}'>+ bye</button></div></div>
    </div>
  </section>`;
}
const samePos = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function getAt(pos) {
  const e = ui.edit;
  if (pos.k === 'b') return e.pairings[pos.i][pos.s];
  if (pos.k === 'y') return e.byes[pos.i]?.player;
  if (pos.k === 'p') return pos.id;
  return null;
}
function setAt(pos, id) {
  const e = ui.edit;
  if (pos.k === 'b') e.pairings[pos.i][pos.s] = id;
  else if (pos.k === 'y') { if (id) e.byes[pos.i].player = id; else e.byes.splice(pos.i, 1); }
  else if (pos.k === 'newbye' && id) e.byes.push({ player: id, points: Number(D.t.settings?.bye_points ?? 1) });
}
function swap(a, b) {
  if (samePos(a, b)) return;
  const A = getAt(a), B = getAt(b);
  // Pool positions are virtual: putting someone "into the pool" just removes them.
  if (a.k === 'p' && b.k === 'p') return;
  const lockedAt = (p) => p.k === 'b' && ui.edit.pairings[p.i].locked;
  if (lockedAt(a) || lockedAt(b)) { ctx.toast('That board has a result — clear it first.', 'error'); return; }
  if (a.k === 'p') { setAt(b, A); }
  else if (b.k === 'p') { setAt(a, B); }
  else { setAt(a, B); setAt(b, A); }
  // Bye slots emptied by the swap disappear.
  ui.edit.byes = ui.edit.byes.filter((x) => x.player);
}

// Either side may be the "+ bye" target: the other player moves to a bye.
function moveOrSwap(a, b) {
  if (a.k === 'newbye' || b.k === 'newbye') {
    const src = a.k === 'newbye' ? b : a;
    const id = getAt(src);
    if (!id || src.k === 'y') return;
    if (src.k === 'b' && ui.edit.pairings[src.i].locked) { ctx.toast('That board has a result — clear it first.', 'error'); return; }
    if (src.k === 'b') setAt(src, null);
    setAt({ k: 'newbye' }, id);
    return;
  }
  swap(a, b);
}

// ---- schedule preview (round robin / team league) -----------------------------
function scheduleHtml() {
  const s = schedulePreview;
  return `<section class="desk-edit">
    <header class="edit-head"><div><p class="eyebrow-sm">Preview — nothing is saved yet</p><h2>Full schedule · ${s.rounds.length} rounds</h2>
      <p class="muted">Colours are balanced (Berger tables). After creating, any round can still be edited.</p></div>
      <div class="btn-row"><button class="btn ghost" data-act="cancel-schedule">Cancel</button><button class="btn primary" data-act="confirm-schedule">Create all ${s.rounds.length} rounds</button></div></header>
    ${s.warnings.length ? `<ul class="st-checks">${s.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="sched">${s.rounds.map((r) => `<div class="sched-round"><h3>Round ${r.number}</h3>
      ${r.matches ? r.matches.map((m) => `<p><b>${esc(teamName(m.home_team_id))}</b> v <b>${esc(teamName(m.away_team_id))}</b> <span class="muted">${m.boards} boards</span></p>`).join('') + (r.teamBye ? `<p class="muted">Bye: ${esc(teamName(r.teamBye))}</p>` : '')
        : r.pairings.map((p) => `<p><span class="pc w"></span>${esc(name(p.white))} <span class="muted">v</span> <span class="pc b"></span>${esc(name(p.black))}</p>`).join('') + (r.byes.length ? `<p class="muted">Bye: ${esc(name(r.byes[0].player))}</p>` : '')}
    </div>`).join('')}</div>
  </section>`;
}

// ---- entrants pane --------------------------------------------------------------
function entriesHtml() {
  const team = isTeam();
  const rows = [...D.entries].sort((a, b) => (a.status === 'confirmed' ? 0 : 1) - (b.status === 'confirmed' ? 0 : 1) || (a.seed ?? 1e9) - (b.seed ?? 1e9) || (rating(b.player_id) || 0) - (rating(a.player_id) || 0));
  const inT = new Set(D.entries.map((e) => e.player_id || e.team_id));
  const host = D.t.settings?.simul_host;
  return `<div class="grid-2 entr">
    <section class="panel"><h2>Entrants</h2>
      ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>${team ? 'Team' : 'Player'}</th><th class="num">Rating</th><th class="num">Seed</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((e) => `<tr><td><b>${esc(team ? e.team?.name : name(e.player_id))}</b>${host && e.player_id === host ? ' <span class="badge good">host</span>' : ''}</td>
        <td class="num">${team ? '' : rating(e.player_id)}</td>
        <td class="num"><input class="seed" type="number" min="1" value="${e.seed ?? ''}" data-seed="${e.id}" aria-label="Seed" ${D.rounds.length ? 'disabled title="Seeds are fixed once pairing starts"' : ''}></td>
        <td><span class="badge ${e.status === 'confirmed' ? 'good' : e.status === 'pending' ? 'warn' : ''}">${esc(e.status)}</span></td>
        <td class="actions">
          ${e.status !== 'confirmed' ? `<button class="btn sm" data-entry="${e.id}" data-st="confirmed">Confirm</button>` : ''}
          ${e.status === 'pending' ? `<button class="btn sm danger" data-entry="${e.id}" data-st="rejected">Reject</button>` : ''}
          ${e.status === 'confirmed' ? `<button class="btn sm ghost" data-entry="${e.id}" data-st="withdrawn">Withdraw</button>` : ''}
          ${D.t.format === 'simul' && e.player_id && e.status === 'confirmed' && e.player_id !== host ? `<button class="btn sm ghost" data-host="${e.player_id}">Make host</button>` : ''}
        </td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No entrants yet.</p>'}
      ${rows.length && !D.rounds.length && !team ? '<button class="btn sm ghost" data-act="seed-rating" style="margin-top:.8rem">Seed by rating</button>' : ''}
    </section>
    <section class="panel"><h2>Add ${team ? 'teams' : 'players'}</h2>
      <input type="search" class="add-search" placeholder="Search…" data-addsearch aria-label="Search">
      <div class="add-list" data-addlist>${(team ? (D.allTeams || []) : D.players.filter((p) => p.status !== 'inactive'))
        .filter((p) => !inT.has(p.id)).map((p) => `<label><input type="checkbox" value="${p.id}"> ${esc(p.full_name || p.name)} <span class="muted">${p.club_rating ?? ''}</span></label>`).join('') || '<p class="muted">Everyone is already entered.</p>'}</div>
      <button class="btn primary sm" data-act="add-entries" style="margin-top:.8rem">Add selected (confirmed)</button>
    </section>
  </div>`;
}

// ---- standings / bracket / crosstable ------------------------------------------
function tableHtml() {
  const f = D.t.format;
  if (f === 'knockout') return bracketHtml();
  if (isTeam()) {
    const rows = [...D.teamStandings].sort((a, b) => b.match_points - a.match_points || b.board_points - a.board_points);
    return rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">MP</th><th class="num">BP</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.draws}</td><td class="num">${r.losses}</td><td class="num"><b>${r.match_points}</b></td><td class="num">${r.board_points}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Standings appear after the first completed match.</p>';
  }
  if (f === 'round_robin' || f === 'double_round_robin') {
    const ps = [...D.standings];
    const ids = ps.length ? ps.map((p) => p.player_id) : confirmedPlayers().map((p) => p.id);
    const cell = (a, b) => {
      if (a === b) return '<td class="x"></td>';
      const gs = D.games.filter((g) => (g.white_id === a && g.black_id === b) || (g.white_id === b && g.black_id === a));
      const txt = gs.map((g) => (decided(g) ? String(points(g.result, g.white_id === a ? 'white' : 'black')).replace('0.5', '½') : '·')).join(' ');
      return `<td class="num">${txt}</td>`;
    };
    return `<div class="table-wrap"><table class="data-table xtab"><thead><tr><th>#</th><th>Player</th>${ids.map((_, i) => `<th class="num">${i + 1}</th>`).join('')}<th class="num">Pts</th></tr></thead><tbody>
      ${ids.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(name(a))}</b></td>${ids.map((b) => cell(a, b)).join('')}<td class="num"><b>${ps.find((p) => p.player_id === a)?.points ?? 0}</b></td></tr>`).join('')}</tbody></table></div>`;
  }
  return D.standings.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Player</th><th class="num">Pts</th><th class="num">Played</th><th class="num">W/D/L</th><th class="num">Buchholz</th></tr></thead><tbody>
    ${D.standings.map((r) => `<tr><td>${r.rank}</td><td><b>${esc(r.full_name)}</b> <span class="muted">${r.club_rating}</span></td><td class="num"><b>${r.points}</b></td><td class="num">${r.played}${r.byes ? ` +${r.byes} bye` : ''}</td><td class="num">${r.wins}/${r.draws}/${r.losses}</td><td class="num">${r.buchholz}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty">Standings appear after the first result.</p>';
}

function bracketHtml() {
  if (!D.rounds.length) return '<p class="empty">The bracket appears once round 1 is paired.</p>';
  const cols = D.rounds.map((r) => {
    const gs = gamesOf(r.id), bs = byesOf(r.id);
    const slots = [...gs.map((g) => ({ slot: g.board, g })), ...bs.map((b) => ({ slot: b.slot, bye: b }))].sort((a, b) => a.slot - b.slot);
    return `<div class="br-col"><h3>${esc(roundName(slots.length))}</h3>${slots.map((s) => {
      if (s.bye) return `<div class="br-m bye"><div class="br-p win">${esc(name(s.bye.player_id))}</div><div class="br-p muted">bye</div></div>`;
      const g = s.g, w = koWinner({ ...g, white: g.white_id, black: g.black_id, advance: g.advance_id });
      return `<div class="br-m ${decided(g) ? '' : 'open'}" data-goround="${r.id}"><div class="br-p ${w === g.white_id ? 'win' : ''}">${esc(name(g.white_id))}<i>${decided(g) ? points(g.result, 'white') : ''}</i></div><div class="br-p ${w === g.black_id ? 'win' : ''}">${esc(name(g.black_id))}<i>${decided(g) ? points(g.result, 'black') : ''}</i></div></div>`;
    }).join('')}</div>`;
  });
  const champ = leader();
  return `<div class="bracket">${cols.join('')}${champ && D.t.format === 'knockout' && D.rounds.length && gamesOf(D.rounds.at(-1).id).length === 1 && D.games.every(decided) ? `<div class="br-col champ"><h3>Champion</h3><div class="br-m win"><div class="br-p win">🏆 ${esc(champ)}</div></div></div>` : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Celebration (respects reduced motion)
// ---------------------------------------------------------------------------
function celebrate(big = false) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.createElement('div');
  host.className = 'confetti';
  const colours = ['#8fe7ff', '#2ee6d0', '#e6d27a', '#7fd36b', '#c9a3ff', '#ffffff'];
  host.innerHTML = Array.from({ length: big ? 90 : 40 }, () => {
    const x = Math.random() * 100, d = 0.9 + Math.random() * 1.4, r = Math.random() * 720 - 360, c = colours[Math.floor(Math.random() * colours.length)];
    return `<i style="left:${x}%;background:${c};--d:${d}s;--r:${r}deg;--x:${Math.random() * 120 - 60}px;animation-delay:${Math.random() * 0.25}s"></i>`;
  }).join('');
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 2600);
}

// ---------------------------------------------------------------------------
// Tournament list + new-tournament wizard
// ---------------------------------------------------------------------------
async function renderList() {
  const { data, error } = await ctx.supabase.from('tournaments').select('id, name, format, kind, status, mode, starts_on, is_published, rounds_planned').order('starts_on', { ascending: false, nullsFirst: true });
  if (error) { ctx.view.innerHTML = `<div class="notice error">${esc(ctx.errText(error))}</div>`; return; }
  const order = { ongoing: 0, registration_open: 1, registration_closed: 1, draft: 2, completed: 3, cancelled: 4 };
  const rows = [...data].sort((a, b) => order[a.status] - order[b.status]);
  ctx.view.innerHTML = `
    <p class="eyebrow-sm">Admin</p>
    <h1 class="page-title">Tournament desk</h1>
    <p class="page-sub">Pick a tournament to run it, or start a new one.</p>
    <div class="t-cards">
      <button type="button" class="t-card new" data-act="wizard"><span class="plus">+</span><b>New tournament</b><small>Choose a format — pairings are automatic.</small></button>
      ${rows.map((t) => `<button type="button" class="t-card s-${t.status}" data-open="${t.id}">
        <span class="t-fmt">${esc(FORMAT_INFO[t.format]?.label || t.format)} · ${t.mode === 'online' ? 'online' : 'OTB'}</span>
        <b>${esc(t.name)}</b>
        <small>${esc(t.status.replace(/_/g, ' '))}${t.starts_on ? ` · ${new Date(t.starts_on).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${t.is_published ? '' : ' · hidden'}</small>
      </button>`).join('')}
    </div>`;
}

function renderWizard(step = 1, draft = { format: 'swiss', mode: 'offline', rated: true }) {
  const fmts = Object.entries(FORMAT_INFO);
  const icons = { swiss: '⇆', round_robin: '◎', double_round_robin: '◉', knockout: '⑂', team_league: '⚑', simul: '✶', arena: '⚡', ladder: '☰' };
  ctx.view.innerHTML = `
    <button class="link-btn desk-back" data-act="back">← All tournaments</button>
    <p class="eyebrow-sm">New tournament · step ${step} of 2</p>
    <h1 class="page-title">${step === 1 ? 'Choose a format' : 'The details'}</h1>
    ${step === 1 ? `<div class="fmt-cards">${fmts.map(([k, f]) => `<button type="button" class="fmt-card ${draft.format === k ? 'on' : ''}" data-fmt="${k}">
        <span class="fi">${icons[k]}</span><b>${f.label}</b><small>${f.blurb}</small><em>${{ 'round-by-round': 'Paired round by round', all: 'Whole schedule at once', once: 'One round', manual: 'Games added as played' }[f.generated]}</em></button>`).join('')}</div>
      <div class="btn-row" style="margin-top:1.5rem"><button class="btn primary" data-act="wiz-next">Next →</button></div>`
    : `<form class="panel form" data-wizform>
        <div class="form-grid">
          <div class="field wide"><label for="wName">Name</label><input id="wName" name="name" required maxlength="100" value="${esc(draft.name || '')}" placeholder="e.g. Winter Rapid Open 2026"></div>
          <div class="field"><span class="st-label">Played</span><div class="seg" role="radiogroup"><button type="button" role="radio" data-mode="offline" aria-checked="${draft.mode === 'offline'}">Over the board</button><button type="button" role="radio" data-mode="online" aria-checked="${draft.mode === 'online'}">Online (Lichess)</button></div>
            <span class="hint">${draft.mode === 'online' ? 'Online games don’t change club ratings; Lichess ratings are recorded.' : 'Rated games change club ratings.'}</span></div>
          <div class="field"><label for="wBase">Time control (minutes + increment)</label><div class="st-inline"><input id="wBase" name="base" type="number" min="0" value="${draft.base ?? 15}" style="max-width:6rem"> + <input name="inc" type="number" min="0" value="${draft.inc ?? 10}" style="max-width:6rem"></div></div>
          ${draft.format === 'swiss' ? '<div class="field"><label for="wRounds">Rounds</label><input id="wRounds" name="rounds" type="number" min="1" max="15" placeholder="Suggested once entries are in"></div>' : ''}
          ${draft.format === 'team_league' ? '<div class="field"><label for="wBoards">Boards per match</label><input id="wBoards" name="boards" type="number" min="1" max="12" value="4"></div><div class="field check"><input type="checkbox" id="wDouble" name="double"><label for="wDouble">Home and away (double round)</label></div>' : ''}
          ${['swiss', 'round_robin', 'double_round_robin'].includes(draft.format) ? '<div class="field"><label for="wBye">Points for a bye</label><select id="wBye" name="bye"><option value="1">1 (full point)</option><option value="0.5">½</option><option value="0">0</option></select></div>' : ''}
          <div class="field"><label for="wStart">Starts</label><input id="wStart" name="starts_on" type="date"></div>
          <div class="field"><label for="wEnd">Ends</label><input id="wEnd" name="ends_on" type="date"></div>
          <div class="field"><label for="wVenue">Venue</label><input id="wVenue" name="venue" placeholder="${draft.mode === 'online' ? 'Lichess' : 'e.g. Student Centre'}"></div>
          <div class="field check"><input type="checkbox" id="wRated" name="rated" ${draft.rated ? 'checked' : ''}><label for="wRated">Rated</label></div>
          <div class="field check"><input type="checkbox" id="wPub" name="pub" checked><label for="wPub">Show on the site</label></div>
          <div class="field check"><input type="checkbox" id="wOpen" name="open" checked><label for="wOpen">Open registration now</label></div>
        </div>
        <div class="btn-row"><button type="button" class="btn ghost" data-act="wiz-back">← Format</button><button type="submit" class="btn primary">Create tournament</button></div>
      </form>`}`;
  ctx.view.__draft = draft;
  ctx.view.__step = step;
}

async function createFromWizard(form) {
  const f = new FormData(form);
  const d = ctx.view.__draft;
  const v = (k) => { const x = String(f.get(k) ?? '').trim(); return x === '' ? null : x; };
  if (v('starts_on') && v('ends_on') && v('ends_on') < v('starts_on')) { ctx.toast('The end date is before the start date.', 'error'); return; }
  const settings = {};
  if (v('bye') != null) settings.bye_points = Number(v('bye'));
  if (v('boards')) settings.boards = Number(v('boards'));
  if (f.get('double')) settings.double = true;
  const payload = {
    name: v('name'), format: d.format, kind: d.format === 'team_league' ? 'team' : 'individual', mode: d.mode,
    time_control_base_min: v('base') == null ? null : Number(v('base')), time_control_increment_s: Number(v('inc') || 0),
    rounds_planned: v('rounds') ? Number(v('rounds')) : null, starts_on: v('starts_on'), ends_on: v('ends_on'), venue: v('venue'),
    rated: !!f.get('rated'), is_published: !!f.get('pub'), status: f.get('open') ? 'registration_open' : 'draft', settings,
    created_by: ctx.me?.user?.id || null,
  };
  const { data, error } = await ctx.supabase.from('tournaments').insert(payload).select('id').single();
  if (error) { ctx.toast(ctx.errText(error), 'error'); return; }
  ctx.toast('Tournament created. Now add entrants!');
  celebrate();
  openDesk(data.id, 'entries');
}

// ---------------------------------------------------------------------------
// Event wiring (one delegated listener per view)
// ---------------------------------------------------------------------------
function bind() {
  const v = ctx.view;
  if (v.__deskBound) return;
  v.__deskBound = true;
  let dragFrom = null;

  v.addEventListener('click', async (e) => {
    if (!v.querySelector('.desk, .t-cards, .fmt-cards, [data-wizform]')) return;
    const t = e.target.closest('button, [data-goround]');
    if (!t) return;
    const act = t.dataset.act;
    if (t.dataset.open) return openDesk(t.dataset.open);
    if (t.dataset.fmt) { ctx.view.__draft.format = t.dataset.fmt; return renderWizard(1, ctx.view.__draft); }
    if (t.dataset.mode) { const d = ctx.view.__draft; Object.assign(d, snapshotWizard()); d.mode = t.dataset.mode; return renderWizard(2, d); }
    if (act === 'wizard') return renderWizard(1);
    if (act === 'wiz-next') return renderWizard(2, ctx.view.__draft);
    if (act === 'wiz-back') return renderWizard(1, ctx.view.__draft);
    if (act === 'back') { D = null; ui = { tab: 'rounds', round: null, edit: null, sel: null }; schedulePreview = null; ctx.setHash?.('desk'); return renderList(); }
    if (!D) return;
    if (t.dataset.tab) { ui.tab = t.dataset.tab; if (ui.tab === 'entries' && isTeam() && !D.allTeams) await loadTeams(); return render(); }
    if (t.dataset.quest) return v.__quests[Number(t.dataset.quest)].run();
    if (act === 'next') return v.__next.run?.();
    if (act === 'edit-t') return ctx.editTournament(D.t, refresh);
    if (act === 'propose') return propose();
    if (act === 'manual') return addManualGame();
    if (act === 'manual-round') return openEdit({ preview: true, number: (D.rounds.at(-1)?.number || 0) + 1, pairings: [], byes: [], warnings: [] });
    if (t.dataset.round) { ui.round = t.dataset.round; return render(); }
    if (t.dataset.goround) { ui.tab = 'rounds'; ui.round = t.dataset.goround; return render(); }
    if (t.dataset.res) { const card = t.closest('[data-game]'); return setResult(card.dataset.game, t.dataset.res); }
    if (t.dataset.adv) { const card = t.closest('[data-game]'); const g = D.games.find((x) => x.id === card.dataset.game); return setResult(g.id, g.result, t.dataset.adv); }
    if (t.dataset.moves) {
      const g = D.games.find((x) => x.id === t.dataset.moves);
      return ctx.openGameStudio({ id: g.id }, null, refresh);
    }
    if (act === 'edit-round') return editRound(t.dataset.id);
    if (act === 'del-round') {
      const r = D.rounds.find((x) => x.id === t.dataset.id);
      const gs = gamesOf(r.id), withRes = gs.filter(decided).length;
      if (!confirm(`Delete round ${r.number}? This removes ${gs.length} pairing${gs.length === 1 ? '' : 's'}${withRes ? ` — ${withRes} with results` : ''}. Ratings are recalculated.`)) return;
      const { error } = await ctx.supabase.rpc('delete_round', { p_round: r.id });
      if (error) { ctx.toast(ctx.errText(error), 'error'); return; }
      ctx.toast(`Round ${r.number} deleted.`); ui.round = null; return refresh();
    }
    if (act === 'cancel-edit') { ui.edit = null; return render(); }
    if (act === 'save-edit') return saveEdit();
    if (act === 'cancel-schedule') { schedulePreview = null; return render(); }
    if (act === 'confirm-schedule') return confirmSchedule();
    if (act === 'add-board') { ui.edit.pairings.push({ white: null, black: null, board: ui.edit.pairings.length + 1 }); return render(); }
    if (t.dataset.rmboard != null) { ui.edit.pairings.splice(Number(t.dataset.rmboard), 1); ui.sel = null; return render(); }
    if (t.dataset.swapc != null) { const p = ui.edit.pairings[Number(t.dataset.swapc)]; [p.white, p.black] = [p.black, p.white]; return render(); }
    if (t.dataset.pos) {
      const pos = JSON.parse(t.dataset.pos);
      if (!ui.sel) { ui.sel = pos; return render(); }
      const from = ui.sel;
      ui.sel = null;
      if (!samePos(from, pos)) moveOrSwap(from, pos);
      return render();
    }
    if (t.dataset.entry) {
      const { error } = await ctx.supabase.from('tournament_entries').update({ status: t.dataset.st }).eq('id', t.dataset.entry);
      if (error) { ctx.toast(ctx.errText(error), 'error'); return; }
      return refresh();
    }
    if (t.dataset.host) return patchT({ settings: { ...(D.t.settings || {}), simul_host: t.dataset.host } }, `${name(t.dataset.host)} is the host.`);
    if (act === 'seed-rating') {
      const conf = confirmed().filter((e) => e.player_id).sort((a, b) => (rating(b.player_id) || 0) - (rating(a.player_id) || 0));
      const results = await Promise.all(conf.map((e, i) => ctx.supabase.from('tournament_entries').update({ seed: i + 1, rating_at_entry: rating(e.player_id) || null }).eq('id', e.id)));
      const bad = results.find((r) => r.error);
      if (bad) ctx.toast(ctx.errText(bad.error), 'error'); else ctx.toast('Seeded by rating.');
      return refresh();
    }
    if (act === 'add-entries') {
      const ids = [...v.querySelectorAll('[data-addlist] input:checked')].map((i) => i.value);
      if (!ids.length) { ctx.toast('Tick the ones to add.', 'error'); return; }
      const rowsIns = ids.map((id) => (isTeam() ? { tournament_id: D.t.id, team_id: id, status: 'confirmed' } : { tournament_id: D.t.id, player_id: id, status: 'confirmed', rating_at_entry: rating(id) || null }));
      const { error } = await ctx.supabase.from('tournament_entries').insert(rowsIns);
      if (error) { ctx.toast(ctx.errText(error), 'error'); return; }
      ctx.toast(`${ids.length} added.`); return refresh();
    }
  });

  v.addEventListener('change', (e) => {
    if (!D) return;
    if (e.target.matches('[data-more]') && e.target.value) {
      const card = e.target.closest('[data-game]');
      setResult(card.dataset.game, e.target.value);
    }
    if (e.target.matches('[data-seed]')) {
      const val = e.target.value === '' ? null : Number(e.target.value);
      ctx.supabase.from('tournament_entries').update({ seed: val }).eq('id', e.target.dataset.seed).then(({ error }) => {
        if (error) ctx.toast(ctx.errText(error), 'error'); else { const en = D.entries.find((x) => x.id === e.target.dataset.seed); if (en) en.seed = val; }
      });
    }
  });
  v.addEventListener('input', (e) => {
    if (!e.target.matches('[data-addsearch]')) return;
    const q = e.target.value.toLowerCase();
    v.querySelectorAll('[data-addlist] label').forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(q); });
  });
  v.addEventListener('submit', (e) => { if (e.target.matches('[data-wizform]')) { e.preventDefault(); createFromWizard(e.target); } });

  // Drag a player chip onto another to swap.
  v.addEventListener('dragstart', (e) => { const c = e.target.closest('.pchip[data-pos]'); if (c) { dragFrom = JSON.parse(c.dataset.pos); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); } });
  v.addEventListener('dragover', (e) => { if (dragFrom && e.target.closest('.pchip[data-pos]')) { e.preventDefault(); e.target.closest('.pchip').classList.add('over'); } });
  v.addEventListener('dragleave', (e) => e.target.closest?.('.pchip')?.classList.remove('over'));
  v.addEventListener('drop', (e) => {
    const c = e.target.closest('.pchip[data-pos]');
    if (!c || !dragFrom) return;
    e.preventDefault();
    const to = JSON.parse(c.dataset.pos);
    if (!samePos(dragFrom, to)) moveOrSwap(dragFrom, to);
    dragFrom = null; ui.sel = null; render();
  });
  v.addEventListener('dragend', () => { dragFrom = null; });
}

function snapshotWizard() {
  const form = ctx.view.querySelector('[data-wizform]');
  if (!form) return {};
  const f = new FormData(form);
  return { name: f.get('name'), base: f.get('base'), inc: f.get('inc'), rated: !!f.get('rated') };
}

async function loadTeams() {
  const { data } = await ctx.supabase.from('teams').select('id, name, college').order('name');
  D.allTeams = (data || []).map((t) => ({ id: t.id, full_name: `${t.name}${t.college ? ` · ${t.college}` : ''}` }));
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------
export function initDesk(context) { ctx = context; bind(); }

export async function openDesk(tid, tab) {
  ctx.view.innerHTML = '<p class="empty">Loading tournament…</p>';
  try { await load(tid); } catch (e) { ctx.view.innerHTML = `<div class="notice error">${esc(ctx.errText(e))}</div>`; return; }
  ui = { tab: tab || 'rounds', round: D.rounds[D.rounds.length - 1]?.id || null, edit: null, sel: null };
  schedulePreview = null;
  if (ui.tab === 'entries' && isTeam()) await loadTeams();
  ctx.setHash?.(`desk/${tid}`);
  render();
}

export function showDeskHome() { D = null; renderList(); }
