// Session + role helpers shared by the login, player and admin pages.
import { supabase, isConfigured } from './supabase.js';
import { cacheProfile, renderAccountMenu } from './account-menu.js';

const BASE = import.meta.env.BASE_URL;
export const PAGES = {
  home: `${BASE}`,
  login: `${BASE}login.html`,
  player: `${BASE}player.html`,
  admin: `${BASE}admin.html`,
};

export async function getSession() {
  if (!isConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** { user, profile, player } for the signed-in user, or null. */
export async function getMe() {
  const session = await getSession();
  if (!session) return null;
  const uid = session.user.id;
  const [{ data: profile }, { data: player }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
    supabase.from('players').select('*').eq('profile_id', uid).maybeSingle(),
  ]);
  const me = { user: session.user, profile, player };
  cacheProfile(me);
  return me;
}

/** Header account menu for a loaded `me`. */
export function showAccount(me, current) {
  renderAccountMenu(me ? {
    id: me.user.id, email: me.user.email, role: me.profile?.role || 'player',
    name: me.player?.full_name || me.profile?.display_name || me.user.email,
    avatar: me.player?.photo_url || me.profile?.avatar_url || me.user.user_metadata?.avatar_url || null,
  } : null, current);
}

export function homeFor(me) {
  return me && me.profile && me.profile.role === 'admin' ? PAGES.admin : PAGES.player;
}

/**
 * Gate a page. Redirects to login when signed out, and to the user's own
 * area when their role doesn't match. Resolves to `me` when allowed.
 * (UI gating only — the database enforces the real rules.)
 */
export async function requireRole(role) {
  const me = await getMe();
  if (!me) {
    location.replace(`${PAGES.login}?next=${encodeURIComponent(location.pathname)}`);
    return new Promise(() => {});
  }
  if (role === 'admin' && me.profile?.role !== 'admin') {
    location.replace(PAGES.player);
    return new Promise(() => {});
  }
  return me;
}

export async function signOut() {
  cacheProfile(null);
  if (isConfigured) await supabase.auth.signOut().catch(() => {});
  location.href = PAGES.home;
}

// ---- tiny DOM helpers used by the app pages -------------------------
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, kind = 'ok', action = null) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-action'; b.textContent = action.action;
    b.onclick = () => { action.run(); el.remove(); };
    el.appendChild(b);
  }
  // Toasts must sit above an open modal <dialog> (top layer), so re-attach there.
  const modal = [...document.querySelectorAll('dialog[open]')].pop();
  (modal || document.body).appendChild(host);
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  const life = action ? 7000 : 3600;
  setTimeout(() => el.classList.add('out'), life);
  setTimeout(() => el.remove(), life + 500);
}

/** Readable message from a Supabase/PostgREST error. */
export function errText(error) {
  if (!error) return '';
  if (error.code === '42501') return error.message || 'You don’t have permission to do that.';
  if (error.code === '23505') return 'That already exists.';
  return error.message || String(error);
}
