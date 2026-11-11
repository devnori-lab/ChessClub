// Game studio — the admin's one-screen way to record a game.
//   * play the moves on a board that only allows legal moves, or
//   * type/paste notation (the board follows), or
//   * paste a Lichess link: the game, its players' ratings and its
//     analysis come in at once, or drop a .pgn file.
// An analysis uploaded later is stored separately and wins in the viewer.
import './chess/board.css';
import { createBoard } from './chess/boardview.js';
import { parsePgn, toPgn, makeRoot, addMove, mainlineOf, impliedResult, evalCount, START_FEN } from './chess/pgn.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RESULTS = [['1-0', '1–0'], ['1/2-1/2', '½–½'], ['0-1', '0–1'], ['*', 'Not finished']];
const MORE_RESULTS = [['+/-', 'White wins by forfeit'], ['-/+', 'Black wins by forfeit'], ['0-0', 'Double forfeit']];
const pad = (n) => String(n).padStart(2, '0');
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

export function lichessId(input) {
  const s = String(input || '').trim();
  const m = s.match(/lichess\.org\/(?:embed\/(?:game\/)?)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?/) || s.match(/^([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?$/);
  return m ? m[1] : null;
}

export async function fetchLichess(id) {
  const res = await fetch(`https://lichess.org/game/export/${id}?evals=true&clocks=true&opening=true&literate=true`, { headers: { Accept: 'application/x-chess-pgn' } });
  if (res.status === 404) throw new Error('Lichess has no game with that ID.');
  if (res.status === 429) throw new Error('Lichess is rate-limiting requests — wait a minute and try again.');
  if (!res.ok) throw new Error(`Lichess answered ${res.status}.`);
  return res.text();
}

/**
 * opts: { supabase, game (row or null), players: [{id,label,lichess}], tournaments: [{id,label}],
 *         rounds: [{id,label,tournament_id}], existing: [rows for duplicate checks], preset: {...}, me,
 *         onSaved(row), onDeleted(), addPlayer(name) => Promise<{id,label}> , toast(msg, kind) }
 */
export function openStudio(opts) {
  const { supabase, toast } = opts;
  const g = { ...(opts.preset || {}), ...(opts.game || {}) };
  const isNew = !opts.game?.id;
  let root = makeRoot(), cur = root, analysis = null, analysisText = g.analysis_pgn || '', analysisSource = g.analysis_source || null;
  let headers = {};
  let undoStack = null;

  const dlg = document.createElement('dialog');
  dlg.className = 'studio';
  dlg.setAttribute('aria-label', isNew ? 'Record a game' : 'Edit game');
  dlg.innerHTML = `
    <form method="dialog" class="st-form" novalidate>
      <header class="st-head">
        <h3>${isNew ? 'Record a game' : 'Edit game'}</h3>
        <span class="st-sub" data-title></span>
        <button type="button" class="st-x" data-close aria-label="Close">✕</button>
      </header>
      <div class="st-body">
        <section class="st-boardcol">
          <div class="st-board" id="stBoard"></div>
          <div class="st-ctl">
            <button type="button" data-go="start" title="Start">⏮</button><button type="button" data-go="prev" title="Back">◀</button>
            <button type="button" data-go="next" title="Forward">▶</button><button type="button" data-go="end" title="End">⏭</button>
            <button type="button" data-go="undo" title="Take back the last move">↶ Undo</button><button type="button" data-go="flip" title="Flip board">⇅</button>
          </div>
          <p class="st-status" data-status aria-live="polite"></p>
        </section>

        <section class="st-side">
          <div class="tabs st-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="true" data-tab="moves">Moves</button>
            <button type="button" role="tab" aria-selected="false" data-tab="import">Import</button>
            <button type="button" role="tab" aria-selected="false" data-tab="analysis">Analysis <span class="st-dot" data-adot hidden></span></button>
          </div>

          <div data-pane="moves">
            <label class="st-label" for="stMoves">Notation — type, paste, or play on the board</label>
            <textarea id="stMoves" class="st-pgn" spellcheck="false" placeholder="1. e4 e5 2. Nf3 Nc6 …"></textarea>
            <p class="st-msg" data-pgnmsg></p>
          </div>

          <div data-pane="import" hidden>
            <label class="st-label" for="stLichess">Lichess game link or ID</label>
            <div class="st-inline"><input id="stLichess" placeholder="https://lichess.org/AbCd1234"><button type="button" class="btn sm primary" data-fetch>Fetch</button></div>
            <p class="st-msg muted">Brings in the moves, players, date, Lichess ratings and — if the game was analysed on Lichess — the analysis.</p>
            <label class="st-drop" data-drop="game"><input type="file" accept=".pgn,text/plain" hidden data-file="game"><b>Drop a .pgn file</b> or click to choose</label>
          </div>

          <div data-pane="analysis" hidden>
            <p class="st-msg muted" style="margin-top:0">An analysed PGN (with evaluations / annotations) replaces the plain notation in the viewer — it's more detailed. Upload it any time, even long after the game was recorded.</p>
            <div class="st-inline"><button type="button" class="btn sm" data-fetch-analysis>Fetch analysis from Lichess</button><label class="btn sm ghost st-filebtn"><input type="file" accept=".pgn,text/plain" hidden data-file="analysis">Upload file</label><button type="button" class="btn sm ghost" data-clear-analysis>Remove</button></div>
            <textarea id="stAnalysis" class="st-pgn short" spellcheck="false" placeholder="Paste an analysed PGN — from Lichess (Study / Analysis board → Export), Chess.com Game Review, or annotated by hand."></textarea>
            <p class="st-msg" data-amsg></p>
          </div>

          <div class="st-details">
            <div class="st-players">
              <div class="field"><label for="stWhite">White</label><select id="stWhite" required></select></div>
              <button type="button" class="st-swap" data-swap title="Swap colours" aria-label="Swap colours">⇄</button>
              <div class="field"><label for="stBlack">Black</label><select id="stBlack" required></select></div>
            </div>
            <div class="st-addp" hidden>
              <input placeholder="New player's full name" data-newname> <label class="chip-sm"><input type="checkbox" data-newext> external</label>
              <button type="button" class="btn sm" data-addp-save>Add</button><button type="button" class="link-btn" data-addp-cancel>Cancel</button>
            </div>
            <button type="button" class="link-btn st-addlink" data-addp>+ Player not in the list?</button>

            <div class="field"><span class="st-label">Result</span>
              <div class="seg" role="radiogroup" aria-label="Result">${RESULTS.map(([v, l]) => `<button type="button" role="radio" data-result="${v}">${l}</button>`).join('')}
                <select data-result-more aria-label="Other results"><option value="">More…</option>${MORE_RESULTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
            </div>
            <div class="field"><span class="st-label">Where was it played?</span>
              <div class="seg" role="radiogroup" aria-label="Type">
                <button type="button" role="radio" data-src="otb">Over the board</button><button type="button" role="radio" data-src="lichess">Online · Lichess</button><button type="button" role="radio" data-src="chesscom">Online · Chess.com</button>
              </div>
              <span class="hint" data-srchint></span>
            </div>
            <div class="form-grid st-grid">
              <div class="field"><label for="stDate">Played on</label><input id="stDate" type="datetime-local"></div>
              <div class="field"><label for="stTour">Tournament</label><select id="stTour"></select></div>
              <div class="field"><label for="stRound">Round</label><select id="stRound"></select></div>
              <div class="field"><label for="stBoardNo">Board</label><input id="stBoardNo" type="number" min="1"></div>
              <div class="field"><label for="stOpening">Opening</label><input id="stOpening" placeholder="Filled from the PGN when known"></div>
              <div class="field"><label for="stEco">ECO</label><input id="stEco" maxlength="3"></div>
              <div class="field"><label for="stTc">Time control</label><input id="stTc" placeholder="e.g. 10+5"></div>
              <div class="field"><label for="stUrl">Link</label><input id="stUrl" placeholder="Lichess / Chess.com URL"></div>
              <div class="field" data-online><label for="stWr">White's Lichess rating</label><input id="stWr" type="number"></div>
              <div class="field" data-online><label for="stBr">Black's Lichess rating</label><input id="stBr" type="number"></div>
            </div>
            <div class="st-flags">
              <label class="chip-sm"><input type="checkbox" id="stRated"> Rated</label>
              <label class="chip-sm"><input type="checkbox" id="stPublic"> Public in archive</label>
              <label class="chip-sm"><input type="checkbox" id="stFeatured"> ★ Featured</label>
            </div>
            <ul class="st-checks" data-checks aria-live="polite"></ul>
          </div>
        </section>
      </div>
      <footer class="st-foot">
        ${isNew ? '' : '<button type="button" class="btn danger" data-del>Delete</button>'}
        <span class="st-spacer"></span>
        <button type="button" class="btn ghost" data-close>Cancel</button>
        ${isNew ? '<button type="button" class="btn" data-save="again">Save & record another</button>' : ''}
        <button type="submit" class="btn primary" data-save="close">Save game</button>
      </footer>
    </form>`;
  document.body.appendChild(dlg);
  const $ = (sel) => dlg.querySelector(sel);
  const $$ = (sel) => [...dlg.querySelectorAll(sel)];

  // ---- selects ------------------------------------------------------------
  const playerOpts = (sel) => `<option value="">Choose…</option>${opts.players.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}`;
  function fillPlayers() { $('#stWhite').innerHTML = playerOpts(state.white); $('#stBlack').innerHTML = playerOpts(state.black); }
  function fillTournaments() {
    $('#stTour').innerHTML = `<option value="">Friendly (no tournament)</option>${opts.tournaments.map((t) => `<option value="${t.id}"${t.id === state.tournament ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}`;
    const rs = opts.rounds.filter((r) => r.tournament_id === state.tournament);
    $('#stRound').innerHTML = `<option value="">—</option>${rs.map((r) => `<option value="${r.id}"${r.id === state.round ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}`;
    $('#stRound').disabled = !rs.length;
  }

  const state = {
    white: g.white_id || '', black: g.black_id || '', result: g.result || '*', source: g.source || 'otb',
    tournament: g.tournament_id || '', round: g.round_id || '',
  };
  fillPlayers(); fillTournaments();
  $('#stDate').value = toLocal(g.played_at) || toLocal(new Date().toISOString());
  $('#stBoardNo').value = g.board ?? '';
  $('#stOpening').value = g.opening || '';
  $('#stEco').value = g.eco || '';
  $('#stTc').value = g.time_control || '';
  $('#stUrl').value = g.external_url || '';
  $('#stWr').value = g.white_lichess_rating ?? '';
  $('#stBr').value = g.black_lichess_rating ?? '';
  $('#stRated').checked = g.rated ?? true;
  $('#stPublic').checked = g.is_public ?? true;
  $('#stFeatured').checked = !!g.is_featured;
  $('#stAnalysis').value = analysisText;

  // ---- board ----------------------------------------------------------------
  const board = createBoard($('#stBoard'), { movable: 'both', onMove: (m) => play(m) });

  function play(move) {
    const keep = cur.children.slice();
    const node = addMove(cur, move);
    if (!node) return;
    if (keep.length && cur.children[0] !== node) {
      // A different move from the middle of the game replaces what followed.
      const dropped = countLine(keep[0]);
      undoStack = { parent: cur, children: keep };
      cur.children = [node];
      toast(`Replaced ${dropped} later move${dropped === 1 ? '' : 's'}.`, 'ok', { action: 'Undo', run: undoReplace });
    } else {
      cur.children = [node, ...cur.children.filter((c) => c !== node)].slice(0, 1);
    }
    cur = node;
    syncText();
    show();
  }
  const countLine = (n) => { let c = 0; for (let x = n; x; x = x.children[0]) c++; return c; };
  function undoReplace() { if (!undoStack) return; undoStack.parent.children = undoStack.children; cur = undoStack.parent; undoStack = null; syncText(); show(); }

  function show() {
    board.set(cur.fen, { lastMove: cur.from ? { from: cur.from, to: cur.to } : null });
    const line = mainlineOf(root);
    const idx = line.indexOf(cur) + 1;
    const turn = cur.fen.split(' ')[1] === 'w' ? 'White' : 'Black';
    const end = impliedResult(cur);
    $('[data-status]').innerHTML = line.length
      ? `${idx === line.length ? 'End of game' : `Move ${idx} of ${line.length}`} · ${end ? `<b>${end === '1/2-1/2' ? 'Draw' : 'Checkmate'} on the board</b>` : `${turn} to play`}`
      : 'Play the first move on the board, or type / paste the notation.';
    $('[data-title]').textContent = [labelOf(state.white), labelOf(state.black)].every(Boolean) ? `${labelOf(state.white)} vs ${labelOf(state.black)}` : '';
    checks();
  }
  const labelOf = (id) => opts.players.find((p) => p.id === id)?.label.replace(/\s*\(.*\)$/, '') || '';

  function syncText() {
    const text = mainlineOf(root).length ? toPgn({ Result: state.result }, root, { variations: false, comments: false }).split('\n\n').slice(1).join('\n\n').trim() : '';
    $('#stMoves').value = text;
    $('[data-pgnmsg]').textContent = '';
    $('[data-pgnmsg]').className = 'st-msg';
  }

  // Typing in the notation box rebuilds the game (board follows).
  let typing;
  $('#stMoves').addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => loadNotation($('#stMoves').value, { fromTyping: true }), 350);
  });

  function loadNotation(text, { fromTyping = false, fill = true } = {}) {
    const msg = $('[data-pgnmsg]');
    if (!text.trim()) { root = makeRoot(); cur = root; msg.textContent = ''; show(); return true; }
    try {
      const parsed = parsePgn(text);
      root = parsed.root; cur = root;
      while (cur.children[0]) cur = cur.children[0];
      headers = parsed.headers;
      if (fill) applyHeaders(parsed.headers);
      if (evalCount(root) > 0 && !analysisText) { setAnalysis(text, /lichess/i.test(parsed.headers.Site || '') ? 'lichess' : 'manual'); }
      if (!fromTyping) syncText();
      msg.textContent = `✓ ${mainlineOf(root).length} half-moves read.`;
      msg.className = 'st-msg ok';
      show();
      return true;
    } catch (e) {
      msg.textContent = e.message;
      msg.className = 'st-msg error';
      return false;
    }
  }

  // PGN headers → form (only fills what's empty or clearly better).
  function applyHeaders(h) {
    const find = (name) => {
      if (!name) return null;
      const byLichess = opts.players.find((p) => p.lichess && p.lichess.toLowerCase() === name.trim().toLowerCase());
      if (byLichess) return byLichess;
      const n = norm(name.includes(',') ? name.split(',').reverse().join(' ') : name);
      return opts.players.find((p) => norm(p.label.replace(/\s*\(.*\)$/, '')) === n) || null;
    };
    const missing = [];
    for (const [side, key] of [['White', 'white'], ['Black', 'black']]) {
      const p = find(h[side]);
      if (p) state[key] = p.id; else if (h[side] && h[side] !== '?') missing.push(`${side}: “${h[side]}”`);
    }
    fillPlayers();
    if (h.Result && ['1-0', '0-1', '1/2-1/2', '*'].includes(h.Result)) setResult(h.Result);
    const date = h.UTCDate || h.Date;
    if (date && /^\d{4}\.\d{2}\.\d{2}$/.test(date)) $('#stDate').value = `${date.replace(/\./g, '-')}T${(h.UTCTime || h.Time || '12:00').slice(0, 5)}`;
    if (h.ECO && h.ECO !== '?') $('#stEco').value = h.ECO.slice(0, 3);
    if (h.Opening && h.Opening !== '?') $('#stOpening').value = h.Opening;
    if (h.TimeControl && /^\d+\+\d+$/.test(h.TimeControl)) { const [b, i] = h.TimeControl.split('+').map(Number); $('#stTc').value = `${Math.round(b / 60)}+${i}`; }
    const site = h.Site || h.Link;
    if (site && /^https?:\/\//.test(site)) {
      $('#stUrl').value = site;
      if (/lichess\.org/.test(site)) setSource('lichess'); else if (/chess\.com/.test(site)) setSource('chesscom');
    }
    if (h.WhiteElo && /^\d+$/.test(h.WhiteElo)) $('#stWr').value = h.WhiteElo;
    if (h.BlackElo && /^\d+$/.test(h.BlackElo)) $('#stBr').value = h.BlackElo;
    if (missing.length) toast(`Not in the players list — ${missing.join(', ')}. Pick them, add them, or set their Lichess username.`, 'error');
  }

  // ---- analysis ---------------------------------------------------------------
  function setAnalysis(text, source) {
    analysisText = text || '';
    analysisSource = text ? source || analysisSource || 'manual' : null;
    $('#stAnalysis').value = analysisText;
    validateAnalysis();
  }
  function validateAnalysis() {
    const msg = $('[data-amsg]');
    $('[data-adot]').hidden = !analysisText;
    analysis = null;
    if (!analysisText.trim()) { msg.textContent = 'No analysis attached.'; msg.className = 'st-msg muted'; checks(); return; }
    try {
      analysis = parsePgn(analysisText);
      const a = mainlineOf(analysis.root).map((n) => n.san), m = mainlineOf(root).map((n) => n.san);
      const evals = evalCount(analysis.root);
      const nags = mainlineOf(analysis.root).filter((n) => n.nags.length).length;
      let diff = -1;
      for (let i = 0; i < Math.min(a.length, m.length); i++) if (a[i] !== m[i]) { diff = i; break; }
      const parts = [`✓ ${evals} evaluated moves`, nags ? `${nags} annotated` : '', `${a.length} half-moves`];
      if (m.length && diff >= 0) {
        msg.innerHTML = `${parts.filter(Boolean).join(' · ')}<br><b>Differs from the notation at move ${Math.floor(diff / 2) + 1}${diff % 2 ? '…' : '.'} (${esc(a[diff])} vs ${esc(m[diff])}).</b> Viewers will follow the analysis. <button type="button" class="link-btn" data-adopt>Use the analysis moves as the notation</button>`;
        msg.className = 'st-msg warn';
      } else {
        msg.textContent = `${parts.filter(Boolean).join(' · ')}${m.length ? ' · matches the notation' : ''}`;
        msg.className = evals || nags ? 'st-msg ok' : 'st-msg warn';
        if (!evals && !nags) msg.textContent += ' — but it has no evaluations or annotations, so it adds nothing.';
      }
      if (!m.length && a.length) { loadNotation(toPgn(analysis.headers, analysis.root, { variations: false, comments: false }), { fill: true }); }
    } catch (e) {
      msg.textContent = e.message; msg.className = 'st-msg error';
    }
    checks();
  }
  let aTyping;
  $('#stAnalysis').addEventListener('input', () => { clearTimeout(aTyping); aTyping = setTimeout(() => { analysisText = $('#stAnalysis').value; analysisSource = analysisSource || 'manual'; validateAnalysis(); }, 400); });

  // ---- result / source --------------------------------------------------------
  function setResult(v) {
    state.result = v;
    $$('[data-result]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.result === v)));
    $('[data-result-more]').value = MORE_RESULTS.some(([x]) => x === v) ? v : '';
    checks();
  }
  function setSource(v) {
    state.source = v;
    $$('[data-src]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.src === v)));
    $$('[data-online]').forEach((el) => { el.hidden = v !== 'lichess'; });
    $('[data-srchint]').textContent = v === 'otb' ? 'Counts toward the club rating (when rated).' : v === 'lichess' ? 'Doesn’t change the club rating — shows the players’ Lichess ratings instead.' : 'Online: doesn’t change the club rating.';
    checks();
  }
  setResult(state.result); setSource(state.source);

  // ---- smart checks -------------------------------------------------------------
  function checks() {
    const out = [];
    const block = [];
    if (!state.white || !state.black) block.push('Choose both players.');
    if (state.white && state.white === state.black) block.push('White and Black are the same player.');
    const line = mainlineOf(root);
    const end = line.length ? impliedResult(line[line.length - 1]) : null;
    if (end && state.result !== end && !['+/-', '-/+', '0-0'].includes(state.result)) out.push({ msg: `The final position is ${end === '1/2-1/2' ? 'a draw' : `checkmate (${end})`}, but the result says ${state.result}.`, fix: ['Set result', () => setResult(end)] });
    if (line.length && state.result === '*') out.push({ msg: 'The game has moves but no result.' });
    if (state.source === 'lichess' && (!$('#stWr').value || !$('#stBr').value)) out.push({ msg: 'Lichess ratings are empty — fetching the game by link fills them.' });
    if (state.round && !state.tournament) block.push('A round needs its tournament.');
    const day = $('#stDate').value.slice(0, 10);
    const dup = (opts.existing || []).find((x) => x.id !== g.id && day && (x.played_at || '').slice(0, 10) === day
      && ((x.white_id === state.white && x.black_id === state.black) || (x.white_id === state.black && x.black_id === state.white)));
    if (dup) out.push({ msg: 'These players already have a game recorded on this day — is this a duplicate?' });
    if (!line.length) out.push({ msg: 'No moves yet — that’s fine for a result-only record.' , quiet: true });
    $('[data-checks]').innerHTML = [
      ...block.map((m) => `<li class="err">${esc(m)}</li>`),
      ...out.map((c, i) => `<li class="${c.quiet ? 'quiet' : 'warn'}">${esc(c.msg)}${c.fix ? ` <button type="button" class="link-btn" data-fix="${i}">${esc(c.fix[0])}</button>` : ''}</li>`),
    ].join('');
    checks.fixes = out.map((c) => c.fix?.[1]);
    $$('[data-save]').forEach((b) => { b.disabled = block.length > 0; });
    return block;
  }

  // ---- events -----------------------------------------------------------------
  dlg.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-drop]');
    if (!t) return;
    if (t.matches('[data-close]')) { close(); return; }
    if (t.dataset.go) {
      if (t.dataset.go === 'start') cur = root;
      else if (t.dataset.go === 'prev' && cur.parent) cur = cur.parent;
      else if (t.dataset.go === 'next' && cur.children[0]) cur = cur.children[0];
      else if (t.dataset.go === 'end') { while (cur.children[0]) cur = cur.children[0]; }
      else if (t.dataset.go === 'undo') {
        let last = root; while (last.children[0]) last = last.children[0];
        if (last !== root) { last.parent.children = []; cur = last.parent; syncText(); }
      } else if (t.dataset.go === 'flip') board.flip();
      show();
      return;
    }
    if (t.dataset.tab) {
      $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
      $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
      return;
    }
    if (t.dataset.result) { setResult(t.dataset.result); syncText(); return; }
    if (t.dataset.src) { setSource(t.dataset.src); return; }
    if (t.matches('[data-swap]')) { [state.white, state.black] = [state.black, state.white]; [$('#stWr').value, $('#stBr').value] = [$('#stBr').value, $('#stWr').value]; fillPlayers(); show(); return; }
    if (t.dataset.fix != null) { checks.fixes[Number(t.dataset.fix)]?.(); syncText(); return; }
    if (t.matches('[data-adopt]')) { loadNotation(toPgn(analysis.headers, analysis.root, { variations: false, comments: false }), { fill: false }); validateAnalysis(); return; }
    if (t.matches('[data-clear-analysis]')) { setAnalysis('', null); return; }
    if (t.matches('[data-fetch]')) { await importLichess(t, false); return; }
    if (t.matches('[data-fetch-analysis]')) { await importLichess(t, true); return; }
    if (t.matches('[data-addp]')) { $('.st-addp').hidden = false; t.hidden = true; $('[data-newname]').focus(); return; }
    if (t.matches('[data-addp-cancel]')) { $('.st-addp').hidden = true; $('[data-addp]').hidden = false; return; }
    if (t.matches('[data-addp-save]')) {
      const name = $('[data-newname]').value.trim();
      if (!name) return;
      t.disabled = true;
      const p = await opts.addPlayer(name, $('[data-newext]').checked);
      t.disabled = false;
      if (!p) return;
      opts.players.push(p); opts.players.sort((a, b) => a.label.localeCompare(b.label));
      if (!state.white) state.white = p.id; else if (!state.black) state.black = p.id;
      fillPlayers(); $('.st-addp').hidden = true; $('[data-addp]').hidden = false; $('[data-newname]').value = '';
      toast(`Added ${p.label}.`); show();
      return;
    }
    if (t.matches('[data-del]')) {
      if (!confirm('Delete this game? Ratings are recalculated without it.')) return;
      const { error } = await supabase.from('games').delete().eq('id', g.id);
      if (error) { toast(error.message, 'error'); return; }
      toast('Game deleted.'); opts.onDeleted?.(); close(true);
      return;
    }
    if (t.dataset.save === 'again') { await save(true); }
  });
  $('[data-result-more]').addEventListener('change', (e) => { if (e.target.value) setResult(e.target.value); });
  $('#stWhite').addEventListener('change', (e) => { state.white = e.target.value; show(); });
  $('#stBlack').addEventListener('change', (e) => { state.black = e.target.value; show(); });
  $('#stTour').addEventListener('change', (e) => { state.tournament = e.target.value; state.round = ''; fillTournaments(); checks(); });
  $('#stRound').addEventListener('change', (e) => { state.round = e.target.value; checks(); });
  ['#stDate', '#stWr', '#stBr'].forEach((s) => $(s).addEventListener('input', checks));
  $('#stLichess').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-fetch]').click(); } });

  async function importLichess(btn, analysisOnly) {
    const id = lichessId(analysisOnly ? ($('#stUrl').value || $('#stLichess').value) : $('#stLichess').value);
    if (!id) { toast(analysisOnly ? 'Add the game’s Lichess link first (Import tab or Link field).' : 'That doesn’t look like a Lichess game link.', 'error'); return; }
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Fetching…';
    try {
      const text = await fetchLichess(id);
      const parsed = parsePgn(text);
      const hasEval = evalCount(parsed.root) > 0;
      if (!analysisOnly) {
        loadNotation(toPgn(parsed.headers, parsed.root, { variations: false, comments: false }), { fill: true });
        $('#stUrl').value = parsed.headers.Site || `https://lichess.org/${id}`;
        setSource('lichess');
      }
      if (hasEval) setAnalysis(text, 'lichess');
      toast(hasEval ? 'Game and Lichess analysis imported.' : analysisOnly ? 'This game has no Lichess analysis yet — request “Computer analysis” on Lichess, then fetch again.' : 'Game imported. It has no Lichess analysis yet — you can fetch it later from the Analysis tab.', hasEval || !analysisOnly ? 'ok' : 'error');
      if (hasEval && analysisOnly) $$('[data-tab]').find((b) => b.dataset.tab === 'analysis').click();
    } catch (e) {
      toast(e.message === 'Failed to fetch' ? 'Couldn’t reach Lichess. Check the connection and try again.' : e.message, 'error');
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  // Files: click or drop.
  dlg.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-file]');
    if (!f || !f.files[0]) return;
    const text = await f.files[0].text();
    if (f.dataset.file === 'analysis') setAnalysis(text, 'manual');
    else { loadNotation(text); if (evalCount(root) > 0) setAnalysis(text, 'manual'); }
    f.value = '';
  });
  const drop = $('[data-drop]');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); const file = e.dataTransfer.files[0]; if (file) { loadNotation(await file.text()); } });
  drop.addEventListener('click', () => drop.querySelector('input').click());

  // ---- save ---------------------------------------------------------------------
  dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); save(false); });

  async function save(again) {
    if (checks().length) return;
    const line = mainlineOf(root);
    const last = line[line.length - 1] || root;
    const end = line.length ? impliedResult(last) : null;
    const W = labelOf(state.white), B = labelOf(state.black);
    const playedAt = $('#stDate').value ? new Date($('#stDate').value) : null;
    const pgnHeaders = {
      Event: opts.tournaments.find((t) => t.id === state.tournament)?.label || (state.source === 'otb' ? 'Club game' : 'Online game'),
      Site: $('#stUrl').value || 'GBPUAT Chess Club',
      Date: playedAt ? `${playedAt.getFullYear()}.${pad(playedAt.getMonth() + 1)}.${pad(playedAt.getDate())}` : '????.??.??',
      White: W, Black: B, Result: ['+/-', '-/+', '0-0'].includes(state.result) ? '*' : state.result,
    };
    if ($('#stEco').value) pgnHeaders.ECO = $('#stEco').value;
    if ($('#stOpening').value) pgnHeaders.Opening = $('#stOpening').value;
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const payload = {
      white_id: state.white, black_id: state.black, result: state.result, source: state.source,
      played_at: playedAt ? playedAt.toISOString() : null,
      tournament_id: state.tournament || null, round_id: state.round || null, board: num($('#stBoardNo').value),
      opening: $('#stOpening').value.trim() || null, eco: $('#stEco').value.trim().toUpperCase() || null,
      time_control: $('#stTc').value.trim() || null, external_url: $('#stUrl').value.trim() || null,
      white_lichess_rating: state.source === 'lichess' ? num($('#stWr').value) : null,
      black_lichess_rating: state.source === 'lichess' ? num($('#stBr').value) : null,
      rated: $('#stRated').checked, is_public: $('#stPublic').checked, is_featured: $('#stFeatured').checked,
      pgn: line.length ? toPgn(pgnHeaders, root, { variations: false, comments: false }) : null,
      move_count: line.length ? Math.ceil(line.length / 2) : null,
      final_fen: line.length ? last.fen : null,
      analysis_pgn: analysisText.trim() || null,
      analysis_source: analysisText.trim() ? analysisSource || 'manual' : null,
    };
    if (end && end !== '1/2-1/2' && !g.termination) payload.termination = 'checkmate';
    if (state.source === 'lichess') {
      // Lichess rating changes, when the PGN carries them.
      const h = analysis?.headers || headers;
      if (h.WhiteRatingDiff && /^[+-]?\d+$/.test(h.WhiteRatingDiff)) payload.white_lichess_change = Number(h.WhiteRatingDiff);
      if (h.BlackRatingDiff && /^[+-]?\d+$/.test(h.BlackRatingDiff)) payload.black_lichess_change = Number(h.BlackRatingDiff);
    }
    if (isNew) payload.created_by = opts.me?.user?.id || null;
    $$('[data-save]').forEach((b) => { b.disabled = true; });
    const { data, error } = isNew
      ? await supabase.from('games').insert(payload).select('*').single()
      : await supabase.from('games').update(payload).eq('id', g.id).select('*').single();
    $$('[data-save]').forEach((b) => { b.disabled = false; });
    if (error) { toast(error.message, 'error'); return; }
    toast(isNew ? 'Game saved.' : 'Game updated.');
    opts.onSaved?.(data);
    if (again) {
      opts.existing?.push(data);
      root = makeRoot(); cur = root; analysisText = ''; analysisSource = null; headers = {};
      state.white = ''; state.black = ''; setResult('*');
      fillPlayers(); syncText(); setAnalysis('', null); $('#stLichess').value = ''; $('#stUrl').value = ''; $('#stOpening').value = ''; $('#stEco').value = '';
      $('#stWr').value = ''; $('#stBr').value = ''; $('#stBoardNo').value = '';
      show();
      $('#stWhite').focus();
    } else close(true);
  }

  function close(force) {
    if (!force && mainlineOf(root).length && isNew && !confirm('Close without saving this game?')) return;
    dlg.close(); dlg.remove();
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  // ---- initial load ---------------------------------------------------------------
  if (g.pgn) loadNotation(g.pgn, { fill: false });
  else if (analysisText) { try { const a = parsePgn(analysisText); loadNotation(toPgn(a.headers, a.root, { variations: false, comments: false }), { fill: false }); } catch { /* shown below */ } }
  validateAnalysis();
  show();
  dlg.showModal();
  if (isNew && !g.white_id) $('#stWhite').focus();
  return { close };
}
