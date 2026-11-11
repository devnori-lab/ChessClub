// "My Club" — the signed-in player's area.
import { supabase } from './supabase.js';
import { requireRole, signOut, esc, toast, errText } from './auth.js';

const app = document.getElementById('app');
document.getElementById('signOut').addEventListener('click', signOut);

const RESULT_FOR = (g, pid) => {
  const white = g.white_id === pid;
  const r = g.result;
  if (r === '1/2-1/2') return ['Draw', ''];
  if (r === '*') return ['In progress', ''];
  if (r === '0-0') return ['Double forfeit', 'bad'];
  const whiteWon = r === '1-0' || r === '+/-';
  const won = white ? whiteWon : !whiteWon;
  const forfeit = r === '+/-' || r === '-/+';
  return [won ? (forfeit ? 'Won (forfeit)' : 'Won') : (forfeit ? 'Lost (forfeit)' : 'Lost'), won ? 'good' : 'bad'];
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const tc = (t) => (t.time_control_base_min != null ? `${t.time_control_base_min}+${t.time_control_increment_s}` : '');

const BASE = import.meta.env.BASE_URL;
const LEVELS = [
  { key: 'beginner', label: 'Beginner', rating: 800, blurb: 'You know how the pieces move and play casually.' },
  { key: 'intermediate', label: 'Intermediate', rating: 1400, blurb: 'You play regularly and know basic openings and tactics.' },
  { key: 'professional', label: 'Professional', rating: 1600, blurb: 'You play rated tournaments or have a strong online rating.' },
];
const PRO_WARNING = 'Professional starts you at 1600 — you’ll be paired against our top players from your very first game. Choose it only if you play rated chess regularly.';
// Constituent colleges, offered as suggestions (any text is accepted).
const COLLEGES = ['College of Technology', 'College of Agriculture', 'College of Basic Sciences & Humanities',
  'College of Veterinary & Animal Sciences', 'College of Fisheries', 'College of Community Science',
  'College of Agribusiness Management', 'College of Post Graduate Studies'];
const collegeList = `<datalist id="colleges">${COLLEGES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
const levelCards = (current) => `
  <fieldset class="levels">
    <legend>How well do you play?</legend>
    ${LEVELS.map((l) => `<label class="level-card"><input type="radio" name="level" value="${l.key}" required${current === l.key ? ' checked' : ''}>
      <span><b>${l.label}</b><i>${l.rating}</i><small>${l.blurb}</small></span></label>`).join('')}
  </fieldset>
  <div class="notice warn" data-pro-warning hidden>${PRO_WARNING}</div>`;

let me;

async function load() {
  me = await requireRole('player');
  document.getElementById('who').textContent = me.player?.full_name || me.user.email;
  document.getElementById('adminLink').hidden = me.profile?.role !== 'admin';

  if (!me.player) {
    app.innerHTML = `<div class="notice error">Your account has no player record yet. Please contact the committee.</div>`;
    return;
  }
  const pid = me.player.id;
  if (!me.player.start_level && !me.player.is_external) {
    renderOnboarding(me.player);
    app.setAttribute('aria-busy', 'false');
    return;
  }

  const [stats, history, games, open, entries, priv] = await Promise.all([
    supabase.from('player_stats').select('*').eq('player_id', pid).maybeSingle(),
    supabase.from('rating_history').select('rating_after, recorded_at').eq('player_id', pid).order('recorded_at'),
    supabase.from('games')
      .select('id, result, played_at, white_id, black_id, opening, white_rating_change, black_rating_change, external_url,' +
              ' white:players!games_white_id_fkey(full_name), black:players!games_black_id_fkey(full_name), tournament:tournaments(name)')
      .or(`white_id.eq.${pid},black_id.eq.${pid}`)
      .order('played_at', { ascending: false, nullsFirst: false }).limit(50),
    supabase.from('tournaments').select('*')
      .in('status', ['registration_open', 'registration_closed', 'ongoing']).eq('kind', 'individual')
      .order('starts_on', { ascending: true, nullsFirst: false }),
    supabase.from('tournament_entries').select('id, status, tournament_id, tournament:tournaments(name, starts_on, status)').eq('player_id', pid),
    supabase.from('player_private').select('*').eq('player_id', pid).maybeSingle(),
  ]);
  for (const r of [stats, history, games, open, entries, priv]) if (r.error) console.error(r.error);

  render({
    p: me.player, s: stats.data || {}, history: history.data || [], games: games.data || [],
    open: open.data || [], entries: entries.data || [], priv: priv.data || {},
  });
  app.setAttribute('aria-busy', 'false');
}

function sparkline(history, current, start) {
  const pts = [start, ...history.map((h) => h.rating_after)];
  if (pts.length < 2) return `<p class="empty">Your rating graph appears after your first rated over-the-board game. You start at ${start}. <a class="link-btn" href="${BASE}ratings.html">How ratings work</a></p>`;
  const w = 600, h = 120, pad = 8;
  const min = Math.min(...pts) - 10, max = Math.max(...pts) + 10;
  const x = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Rating history, now ${current}">
      <defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8fe7ff" stop-opacity="0.25"/><stop offset="1" stop-color="#8fe7ff" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${line} L${x(pts.length - 1)} ${h} L${x(0)} ${h} Z"/>
      <path class="line" d="${line}"/>
    </svg>`;
}

function render({ p, s, history, games, open, entries, priv }) {
  const entryFor = new Map(entries.map((e) => [e.tournament_id, e]));
  const active = p.status === 'active';
  const statusNote = {
    pending: `<div class="notice warn">Your account is waiting for committee approval. You can update your profile now; tournament registration opens once you're approved.</div>`,
    inactive: `<div class="notice warn">Your membership is marked inactive. Contact the committee to rejoin.</div>`,
    alumni: `<div class="notice">You're listed as alumni — thanks for playing with us!</div>`,
  }[p.status] || '';

  app.innerHTML = `
    <p class="eyebrow-sm">My Club</p>
    <h1 class="page-title">${esc(p.full_name)}</h1>
    <p class="page-sub">${esc([p.college, p.department, p.batch_year && `Batch ${p.batch_year}`].filter(Boolean).join(' · ') || 'Member')}
      &nbsp;<span class="badge ${active ? 'good' : 'warn'}">${esc(p.status)}</span></p>
    ${statusNote}

    <div class="stat-row">
      <div class="stat"><b>${p.club_rating}</b><span>Club rating</span></div>
      <div class="stat"><b>${p.peak_rating}</b><span>Peak</span></div>
      <div class="stat"><b>${p.lichess_rating ?? '—'}</b><span>Lichess${p.lichess_username ? ' · ' + esc(p.lichess_username) : ''}</span></div>
      <div class="stat"><b>${s.games ?? 0}</b><span>Games</span></div>
      <div class="stat"><b>${s.wins ?? 0}/${s.draws ?? 0}/${s.losses ?? 0}</b><span>W / D / L</span></div>
      <div class="stat"><b>${s.score_pct != null ? s.score_pct + '%' : '—'}</b><span>Score</span></div>
    </div>

    <section class="panel"><h2>Club rating <a class="btn sm ghost" href="${BASE}ratings.html">How it works</a></h2>${sparkline(history, p.club_rating, p.start_rating ?? 1200)}</section>

    <div class="grid-2" style="margin-top:1.5rem">
      <section class="panel">
        <h2>Tournaments</h2>
        ${open.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Event</th><th>Starts</th><th></th></tr></thead><tbody>
          ${open.map((t) => {
            const e = entryFor.get(t.id);
            let action;
            if (e && e.status !== 'withdrawn') {
              action = `<span class="badge ${e.status === 'confirmed' ? 'good' : 'warn'}">${esc(e.status)}</span>
                ${t.status === 'registration_open' ? `<button class="btn sm ghost" data-withdraw="${e.id}">Withdraw</button>` : ''}`;
            } else if (t.status === 'registration_open') {
              action = active ? `<button class="btn sm" data-register="${t.id}"${e ? ` data-entry="${e.id}"` : ''}>${e ? 'Re-enter' : 'Register'}</button>`
                              : `<span class="muted">After approval</span>`;
            } else {
              action = `<span class="muted">${t.status === 'ongoing' ? 'In progress' : 'Closed'}</span>`;
            }
            return `<tr><td><b>${esc(t.name)}</b><br><span class="muted">${esc([t.format.replace(/_/g, ' '), tc(t), t.venue].filter(Boolean).join(' · '))}</span></td>
              <td class="num">${fmtDate(t.starts_on)}</td><td class="actions">${action}</td></tr>`;
          }).join('')}</tbody></table></div>` : `<p class="empty">No tournaments open right now.</p>`}
      </section>

      <section class="panel">
        <h2>My entries</h2>
        ${entries.length ? `<div class="table-wrap"><table class="data-table"><tbody>
          ${entries.map((e) => `<tr><td>${esc(e.tournament?.name)}</td><td class="num">${fmtDate(e.tournament?.starts_on)}</td>
            <td class="actions"><span class="badge ${e.status === 'confirmed' ? 'good' : e.status === 'pending' ? 'warn' : ''}">${esc(e.status)}</span></td></tr>`).join('')}
        </tbody></table></div>` : `<p class="empty">You haven't entered any tournaments yet.</p>`}
      </section>
    </div>

    <section class="panel" style="margin-top:1.5rem">
      <h2>My games</h2>
      ${games.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Opponent</th><th>Colour</th><th>Result</th><th>Rating</th><th>Event</th></tr></thead><tbody>
        ${games.map((g) => {
          const white = g.white_id === p.id;
          const [label, cls] = RESULT_FOR(g, p.id);
          const delta = white ? g.white_rating_change : g.black_rating_change;
          return `<tr><td class="num">${fmtDate(g.played_at)}</td>
            <td>${esc(white ? g.black?.full_name : g.white?.full_name)}${g.external_url ? ` <a class="link-btn" href="${esc(g.external_url)}" target="_blank" rel="noopener">↗</a>` : ''}</td>
            <td>${white ? 'White' : 'Black'}</td><td><span class="badge ${cls}">${label}</span></td>
            <td class="num">${delta == null ? '—' : (delta > 0 ? '+' : '') + delta}</td>
            <td class="muted">${esc(g.tournament?.name || 'Friendly')}</td></tr>`;
        }).join('')}</tbody></table></div>` : `<p class="empty">No games recorded yet.</p>`}
    </section>

    <section class="panel" style="margin-top:1.5rem">
      <h2>My profile</h2>
      <form class="form" id="profileForm">
        <div class="form-grid">
          <div class="field"><label for="f_full_name">Full name</label><input id="f_full_name" name="full_name" required maxlength="80" value="${esc(p.full_name)}"></div>
          <div class="field"><label for="f_college">College</label><input id="f_college" name="college" list="colleges" value="${esc(p.college)}"></div>
          <div class="field"><label for="f_department">Department</label><input id="f_department" name="department" value="${esc(p.department)}"></div>
          <div class="field"><label for="f_programme">Programme</label><input id="f_programme" name="programme" placeholder="B.Tech, M.Sc…" value="${esc(p.programme)}"></div>
          <div class="field"><label for="f_batch_year">Batch year</label><input id="f_batch_year" name="batch_year" type="number" min="1950" max="2100" value="${esc(p.batch_year)}"></div>
          <div class="field"><label for="f_lichess">Lichess username</label><input id="f_lichess" name="lichess_username" value="${esc(p.lichess_username)}"></div>
          <div class="field"><label for="f_chesscom">Chess.com username</label><input id="f_chesscom" name="chesscom_username" value="${esc(p.chesscom_username)}"></div>
          <div class="field"><label for="f_fide_id">FIDE ID</label><input id="f_fide_id" name="fide_id" value="${esc(p.fide_id)}"></div>
          <div class="field"><label for="f_fide_rating">FIDE rating</label><input id="f_fide_rating" name="fide_rating" type="number" min="0" max="3500" value="${esc(p.fide_rating)}"></div>
          <div class="field"><label for="f_level">Starting level</label>
            ${p.club_games > 0
              ? `<input id="f_level" value="${esc(LEVELS.find((l) => l.key === p.start_level)?.label ?? 'Set by committee')} · ${p.start_rating ?? '—'}" disabled><span class="hint">Locked after your first rated game.</span>`
              : `<select id="f_level" name="level">${LEVELS.map((l) => `<option value="${l.key}"${l.key === p.start_level ? ' selected' : ''}>${l.label} · ${l.rating}</option>`).join('')}</select>`}
          </div>
          <div class="field wide"><label for="f_bio">About you</label><textarea id="f_bio" name="bio" maxlength="600">${esc(p.bio)}</textarea></div>
        </div>
        <p class="eyebrow-sm" style="margin-top:.5rem">Private — only you and the committee see these</p>
        <div class="form-grid">
          <div class="field"><label for="f_phone">Phone</label><input id="f_phone" name="phone" type="tel" autocomplete="tel" value="${esc(priv.phone)}"></div>
          <div class="field"><label for="f_roll">Roll number</label><input id="f_roll" name="roll_number" value="${esc(priv.roll_number)}"></div>
          <div class="field"><label for="f_dob">Date of birth</label><input id="f_dob" name="date_of_birth" type="date" value="${esc(priv.date_of_birth)}"></div>
        </div>
        <div class="btn-row"><button class="btn primary" type="submit">Save profile</button></div>
      </form>
      ${collegeList}
    </section>`;
}

app.addEventListener('click', async (e) => {
  const reg = e.target.closest('[data-register]');
  const wd = e.target.closest('[data-withdraw]');
  if (!reg && !wd) return;
  const btn = reg || wd;
  btn.disabled = true;
  let error;
  if (reg) {
    const tid = reg.dataset.register;
    const prior = reg.dataset.entry;
    ({ error } = prior
      // re-entering after a withdrawal flips the same entry back to pending
      ? await supabase.from('tournament_entries').update({ status: 'pending' }).eq('id', prior)
      : await supabase.from('tournament_entries')
          .insert({ tournament_id: tid, player_id: me.player.id, rating_at_entry: me.player.club_rating, registered_by: me.user.id }));
  } else {
    ({ error } = await supabase.from('tournament_entries').update({ status: 'withdrawn' }).eq('id', wd.dataset.withdraw));
  }
  if (error) { toast(errText(error), 'error'); btn.disabled = false; return; }
  toast(reg ? 'Registered — the committee will confirm your entry.' : 'You have withdrawn.');
  load();
});

app.addEventListener('submit', async (e) => {
  if (e.target.id !== 'profileForm') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const val = (k) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? null : v; };
  const num = (k) => (val(k) == null ? null : Number(val(k)));
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const [a, b] = await Promise.all([
    supabase.from('players').update({
      full_name: val('full_name'), college: val('college'), department: val('department'), programme: val('programme'), batch_year: num('batch_year'),
      lichess_username: val('lichess_username'), chesscom_username: val('chesscom_username'),
      fide_id: val('fide_id'), fide_rating: num('fide_rating'), bio: val('bio'),
    }).eq('id', me.player.id),
    supabase.from('player_private').upsert({
      player_id: me.player.id, phone: val('phone'), roll_number: val('roll_number'), date_of_birth: val('date_of_birth'),
    }),
  ]);
  let c = {};
  const lvl = val('level');
  if (!a.error && lvl && lvl !== me.player.start_level) c = await supabase.rpc('choose_start_level', { chosen: lvl });
  btn.disabled = false;
  const error = a.error || b.error || c.error;
  if (error) { toast(errText(error), 'error'); return; }
  toast('Profile saved.');
  load();
});

// ---- first visit: the level survey -------------------------------------
function renderOnboarding(p) {
  app.innerHTML = `
    <div class="auth-wrap" style="max-width:760px">
      <p class="eyebrow-sm">Welcome to the club</p>
      <h1 class="page-title">One quick question</h1>
      <p class="page-sub">Your answer sets your starting club rating. After that, it moves with every rated over-the-board game you play.
        <a class="link-btn" href="${BASE}ratings.html" target="_blank" rel="noopener">How ratings work ↗</a></p>
      <section class="panel">
        <form class="form" id="onboardForm">
          ${levelCards(null)}
          <div class="form-grid" style="margin-top:.5rem">
            <div class="field"><label for="o_full_name">Full name</label><input id="o_full_name" name="full_name" required maxlength="80" value="${esc(p.full_name)}"></div>
            <div class="field"><label for="o_college">College</label><input id="o_college" name="college" list="colleges" placeholder="e.g. College of Technology" value="${esc(p.college)}"></div>
            <div class="field"><label for="o_department">Department</label><input id="o_department" name="department" value="${esc(p.department)}"></div>
            <div class="field"><label for="o_batch_year">Batch year</label><input id="o_batch_year" name="batch_year" type="number" min="1950" max="2100" value="${esc(p.batch_year)}"></div>
            <div class="field"><label for="o_lichess">Lichess username <span class="muted">(optional)</span></label><input id="o_lichess" name="lichess_username" value="${esc(p.lichess_username)}">
              <span class="hint">Used to match your online games and show your Lichess rating.</span></div>
          </div>
          <div class="btn-row"><button class="btn primary" type="submit">Start playing</button></div>
        </form>
        ${collegeList}
      </section>
    </div>`;
}

app.addEventListener('change', (e) => {
  if (e.target.name !== 'level') return;
  const warn = e.target.closest('form')?.querySelector('[data-pro-warning]') || app.querySelector('[data-pro-warning]');
  if (warn) warn.hidden = e.target.value !== 'professional';
  if (e.target.id === 'f_level' && e.target.value === 'professional') toast(PRO_WARNING);
});

app.addEventListener('submit', async (e) => {
  if (e.target.id !== 'onboardForm') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const val = (k) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? null : v; };
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const a = await supabase.from('players').update({
    full_name: val('full_name'), college: val('college'), department: val('department'),
    batch_year: val('batch_year') == null ? null : Number(val('batch_year')), lichess_username: val('lichess_username'),
  }).eq('id', me.player.id);
  const b = a.error ? {} : await supabase.rpc('choose_start_level', { chosen: val('level') });
  btn.disabled = false;
  const error = a.error || b.error;
  if (error) { toast(errText(error), 'error'); return; }
  toast(`You're in — starting rating ${b.data}.`);
  load();
});

load();
