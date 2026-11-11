// Tiny read-only REST client for public pages (no supabase-js, so the
// landing page stays light). Reads only what RLS lets anyone see.
const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const apiConfigured = Boolean(URL_ && KEY);

export async function rest(path, { signal } = {}) {
  if (!apiConfigured) throw new Error('not configured');
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const PLAYER = 'full_name,club_rating';
export const GAME_LIST_FIELDS = `id,result,played_at,opening,eco,source,is_featured,final_fen,analysis_updated_at,move_count,external_url,` +
  `white:players!games_white_id_fkey(${PLAYER}),black:players!games_black_id_fkey(${PLAYER}),tournament:tournaments(name)`;

/** Public games that have moves, newest first. */
export function listGames({ limit = 60, featuredFirst = false, signal } = {}) {
  const order = featuredFirst ? 'is_featured.desc,played_at.desc.nullslast' : 'played_at.desc.nullslast';
  return rest(`games?select=${encodeURIComponent(GAME_LIST_FIELDS)}&is_public=eq.true&or=(pgn.not.is.null,analysis_pgn.not.is.null)&order=${order}&limit=${limit}`, { signal });
}

export async function getGame(id) {
  const rows = await rest(`games?select=${encodeURIComponent(GAME_LIST_FIELDS + ',pgn,analysis_pgn,white_lichess_rating,black_lichess_rating')}&id=eq.${encodeURIComponent(id)}`);
  return rows[0] || null;
}

/** Shape a DB row for the viewer. */
export function viewerGame(g) {
  const online = g.source === 'lichess';
  return {
    pgn: g.pgn, analysis_pgn: g.analysis_pgn, result: g.result, opening: g.opening, external_url: g.external_url,
    white: g.white?.full_name, black: g.black?.full_name,
    white_rating: online ? g.white_lichess_rating : g.white?.club_rating, black_rating: online ? g.black_lichess_rating : g.black?.club_rating,
    event: g.tournament?.name || (online ? 'Online game' : 'Club game'),
    date: g.played_at ? new Date(g.played_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
  };
}
