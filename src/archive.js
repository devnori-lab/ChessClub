// Full game archive: filterable tiles (mini board of the final position).
// A tile flies forward into the 3D viewer; ?game=<id> deep-links a game.
import { renderAccountMenu } from './account-menu.js';
import { apiConfigured, listGames, getGame, viewerGame } from './publicApi.js';
import { miniBoard } from './chess/mini.js';

renderAccountMenu(undefined, 'archive');
const grid = document.getElementById('archive');
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RES = { '1-0': ['1–0', 'w'], '0-1': ['0–1', 'b'], '1/2-1/2': ['½–½', 'd'], '+/-': ['1–0 ff', 'w'], '-/+': ['0–1 ff', 'b'], '*': ['live', ''] };
let rows = [];

function render() {
  const q = $('aSearch').value.trim().toLowerCase();
  const res = $('aResult').value, kind = $('aKind').value;
  const list = rows.filter((g) =>
    (!q || [g.white?.full_name, g.black?.full_name, g.opening, g.tournament?.name, g.eco].some((v) => String(v || '').toLowerCase().includes(q)))
    && (!res || g.result === res)
    && (!kind || (kind === 'lichess' ? g.source === 'lichess' : g.source !== 'lichess'))
    && (!$('aAnalysed').checked || g.analysis_updated_at)
    && (!$('aFeatured').checked || g.is_featured));
  if (!list.length) { grid.innerHTML = `<p class="empty">${rows.length ? 'No games match these filters.' : 'No games in the archive yet.'}</p>`; return; }
  grid.innerHTML = list.map((g) => {
    const [r, cls] = RES[g.result] || [g.result, ''];
    return `<button type="button" class="game-tile" data-id="${g.id}">
      ${miniBoard(g.final_fen)}
      <span class="gt-body">
        <span class="gt-players"><b>${esc(g.white?.full_name || '—')}</b><span class="gt-res ${cls}">${esc(r)}</span><b>${esc(g.black?.full_name || '—')}</b></span>
        <span class="gt-meta">${esc([g.played_at && new Date(g.played_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), g.opening || g.eco, g.tournament?.name].filter(Boolean).join(' · '))}</span>
        <span class="gt-tags">${g.source === 'lichess' ? '<i>online</i>' : '<i>offline</i>'}${g.analysis_updated_at ? '<i class="on">analysed</i>' : ''}${g.is_featured ? '<i class="star">★ featured</i>' : ''}${g.move_count ? `<i>${g.move_count} moves</i>` : ''}</span>
      </span>
    </button>`;
  }).join('');
}

async function open(id, tile) {
  tile?.classList.add('opening');
  try {
    const [{ openGameViewer }, g] = await Promise.all([import('./chess/viewer.js'), getGame(id)]);
    if (!g) return;
    history.replaceState(null, '', `?game=${id}`);
    openGameViewer(viewerGame(g), tile, () => history.replaceState(null, '', location.pathname));
  } finally { tile?.classList.remove('opening'); }
}

grid.addEventListener('click', (e) => { const t = e.target.closest('.game-tile'); if (t) open(t.dataset.id, t); });
['aSearch', 'aResult', 'aKind', 'aAnalysed', 'aFeatured'].forEach((id) => $(id).addEventListener('input', render));

(async () => {
  if (!apiConfigured) { grid.innerHTML = '<p class="empty">The archive isn’t connected to the database yet.</p>'; return; }
  try {
    rows = await listGames({ limit: 500 });
    render();
    const deep = new URLSearchParams(location.search).get('game');
    if (deep) open(deep, grid.querySelector(`[data-id="${CSS.escape(deep)}"]`));
  } catch {
    grid.innerHTML = '<p class="empty">Couldn’t load games right now. Please try again later.</p>';
  }
})();
