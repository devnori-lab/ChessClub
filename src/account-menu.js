// Standard account control for the header: "Sign in" when signed out,
// avatar + name with a dropdown when signed in. No Supabase dependency —
// it reads the stored session, so the 3D landing page stays light. App
// pages call renderAccountMenu() again with the loaded profile (role).
const BASE = import.meta.env.BASE_URL;
const CACHE = 'cc.profile';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** { email, name, avatar, role } from localStorage, or null when signed out. */
export function storedAccount() {
  try {
    let session = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) { session = JSON.parse(localStorage.getItem(k)); break; }
    }
    const user = session?.user || session?.currentSession?.user;
    if (!user) return null;
    const meta = user.user_metadata || {};
    const cached = JSON.parse(localStorage.getItem(CACHE) || 'null');
    const same = cached && cached.id === user.id;
    return {
      id: user.id,
      email: user.email,
      name: (same && cached.name) || meta.full_name || meta.name || (user.email || '').split('@')[0],
      avatar: (same && cached.avatar) || meta.avatar_url || meta.picture || null,
      role: same ? cached.role : null,
    };
  } catch { return null; }
}

export function cacheProfile(me) {
  try {
    if (!me) { localStorage.removeItem(CACHE); return; }
    localStorage.setItem(CACHE, JSON.stringify({
      id: me.user.id, role: me.profile?.role || 'player',
      name: me.player?.full_name || me.profile?.display_name, avatar: me.player?.photo_url || me.profile?.avatar_url,
    }));
  } catch { /* storage blocked */ }
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function avatarHtml(acc, size = '') {
  return acc.avatar
    ? `<img class="acct-av ${size}" src="${esc(acc.avatar)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="acct-av ${size}" aria-hidden="true">${esc(initials(acc.name))}</span>`;
}

/** Render into every [data-account-menu] slot. `current` marks the active item. */
export function renderAccountMenu(acc = storedAccount(), current = '') {
  document.querySelectorAll('[data-account-menu]').forEach((slot, idx) => {
    if (!acc) {
      slot.innerHTML = `<a class="acct-signin" href="${BASE}login.html">Sign in</a>`;
      return;
    }
    const first = String(acc.name || '').split(/\s+/)[0];
    const id = `acctMenu${idx}`;
    const item = (key, href, label, icon) =>
      `<a role="menuitem" href="${href}"${current === key ? ' aria-current="page"' : ''}><span class="ico" aria-hidden="true">${icon}</span>${label}</a>`;
    slot.innerHTML = `
      <button type="button" class="acct-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="${id}">
        ${avatarHtml(acc)}<span class="acct-name">${esc(first)}</span><span class="acct-chev" aria-hidden="true">▾</span>
      </button>
      <div class="acct-menu" id="${id}" role="menu" hidden>
        <div class="acct-head">${avatarHtml(acc, 'lg')}<div><b>${esc(acc.name)}</b><span>${esc(acc.email || '')}</span>
          ${acc.role === 'admin' ? '<em class="acct-role admin">Admin</em>' : acc.role ? '<em class="acct-role">Player</em>' : ''}</div></div>
        ${item('player', `${BASE}player.html`, 'My dashboard', '◧')}
        ${item('profile', `${BASE}player.html#profile`, 'Edit profile', '✎')}
        ${acc.role === 'admin' ? item('admin', `${BASE}admin.html`, 'Admin console', '⚙') : ''}
        ${item('archive', `${BASE}archive.html`, 'Game archive', '▦')}
        ${item('ratings', `${BASE}ratings.html`, 'How ratings work', '↗')}
        <hr>
        <a role="menuitem" href="${BASE}login.html?signout=1" class="acct-out"><span class="ico" aria-hidden="true">⎋</span>Sign out</a>
      </div>`;
    const btn = slot.querySelector('.acct-btn');
    const menu = slot.querySelector('.acct-menu');
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
    const open = (focusFirst) => {
      menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
      if (focusFirst) items()[0]?.focus();
      setTimeout(() => document.addEventListener('pointerdown', outside), 0);
    };
    const close = (refocus) => {
      menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside);
      if (refocus) btn.focus();
    };
    const outside = (e) => { if (!slot.contains(e.target)) close(false); };
    btn.addEventListener('click', () => (menu.hidden ? open(false) : close(false)));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); open(true); } });
    menu.addEventListener('keydown', (e) => {
      const list = items(), i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Tab') close(false);
    });
  });
}
