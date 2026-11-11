// Session + role helpers shared by the login, player and admin pages.
import { supabase, isConfigured } from './supabase.js';

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
  return { user: session.user, profile, player };
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
  if (isConfigured) await supabase.auth.signOut();
  location.href = PAGES.home;
}

// ---- tiny DOM helpers used by the app pages -------------------------
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, kind = 'ok') {
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
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4100);
}

/** Readable message from a Supabase/PostgREST error. */
export function errText(error) {
  if (!error) return '';
  if (error.code === '42501') return error.message || 'You don’t have permission to do that.';
  if (error.code === '23505') return 'That already exists.';
  return error.message || String(error);
}
