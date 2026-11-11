// Live calculator on the ratings page — same maths as recompute_ratings()
// in supabase/migrations (Postgres round() rounds halves away from zero).
const $ = (id) => document.getElementById(id);
const round = (x) => Math.sign(x) * Math.round(Math.abs(x));

export function eloChange(r, opp, score, gamesPlayed) {
  const k = gamesPlayed < 30 ? 40 : 20;
  const e = 1 / (1 + 10 ** ((opp - r) / 400));
  return { k, e, delta: round(k * (score - e)) };
}

function update() {
  const r = Number($('cR').value), o = Number($('cO').value), s = Number($('cS').value), n = Number($('cN').value);
  if (![r, o, n].every(Number.isFinite)) { $('cOut').textContent = ''; return; }
  const { k, e, delta } = eloChange(r, o, s, n);
  $('cOut').innerHTML = `Expected score <b>${e.toFixed(2)}</b> · K = <b>${k}</b> · change <b class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta}</b> → new rating <b>${r + delta}</b>`;
}

const form = $('calc');
if (form) { form.addEventListener('input', update); update(); }
