// Static mini board (no chess.js) for thumbnails.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
export function miniBoard(fen) {
  const rows = String(fen || START).split(' ')[0].split('/');
  let html = '';
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { for (let i = 0; i < Number(ch); i++, f++) html += `<span class="${(r + f) % 2 ? 'd' : 'l'}"></span>`; continue; }
      const white = ch === ch.toUpperCase();
      html += `<span class="${(r + f) % 2 ? 'd' : 'l'}"><i class="${white ? 'w' : 'b'}">${GLYPH[ch.toLowerCase()]}︎</i></span>`;
      f++;
    }
  });
  return `<span class="mini-board" aria-hidden="true">${html}</span>`;
}
