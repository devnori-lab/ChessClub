import { supabase, isConfigured } from './supabase.js';
import { getMe, homeFor, PAGES, errText, signOut } from './auth.js';
import { renderAccountMenu } from './account-menu.js';

const SIGNING_OUT = new URLSearchParams(location.search).has('signout');
if (SIGNING_OUT) signOut();
renderAccountMenu(null);

const $ = (id) => document.getElementById(id);
const panes = document.querySelectorAll('[data-pane]');
const notice = $('authNotice');

function showPane(name) {
  panes.forEach((p) => { p.hidden = p.dataset.pane !== name; });
  $('authTabs').hidden = name === 'forgot' || name === 'reset';
  $('oauthBlock').hidden = name === 'forgot' || name === 'reset';
  $('googleLabel').textContent = name === 'signup' ? 'Sign up with Google' : 'Continue with Google';
  document.querySelectorAll('#authTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  const titles = { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password', reset: 'Choose a new password' };
  $('authTitle').textContent = titles[name];
}

function say(msg, kind = '') {
  notice.textContent = msg;
  notice.className = `notice ${kind}`;
  notice.hidden = !msg;
}

async function busy(form, fn) {
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

// Only follow ?next= to our own pages.
function nextUrl(me) {
  const next = new URLSearchParams(location.search).get('next');
  if (next && next.startsWith(import.meta.env.BASE_URL) && !next.includes('//')) {
    if (next.includes('admin') && me.profile?.role !== 'admin') return homeFor(me);
    return next;
  }
  return homeFor(me);
}

async function goHome() {
  const me = await getMe();
  if (me) location.replace(nextUrl(me));
}

document.querySelectorAll('#authTabs [data-tab]').forEach((b) => b.addEventListener('click', () => { say(''); showPane(b.dataset.tab); }));
$('forgotBtn').addEventListener('click', () => { say(''); $('fpEmail').value = $('siEmail').value; showPane('forgot'); });
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { say(''); showPane('signin'); }));

if (!isConfigured) {
  $('configError').hidden = false;
  document.querySelectorAll('form button, form input').forEach((el) => { el.disabled = true; });
} else {
  const redirectTo = `${location.origin}${PAGES.login}`;

  // Google: Supabase sends the user to Google and back to this page, where
  // the session is picked up from the URL and goHome() routes them.
  $('googleBtn').addEventListener('click', async () => {
    $('googleBtn').disabled = true;
    say('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    if (error) {
      $('googleBtn').disabled = false;
      say(/provider is not enabled|Unsupported provider/i.test(error.message)
        ? 'Google sign-in isn’t switched on yet — please use email for now.' : errText(error), 'error');
    }
  });

  // Errors come back in the URL (e.g. the user cancelled at Google).
  const urlErr = new URLSearchParams(location.hash.slice(1)).get('error_description')
    || new URLSearchParams(location.search).get('error_description');
  if (urlErr) say(urlErr.replace(/\+/g, ' '), 'error');

  $('signinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, async () => {
      say('');
      const { error } = await supabase.auth.signInWithPassword({ email: $('siEmail').value.trim(), password: $('siPass').value });
      if (error) {
        say(error.message === 'Email not confirmed'
          ? 'Please confirm your email first — check your inbox for the link.'
          : 'Wrong email or password.', 'error');
        return;
      }
      await goHome();
    });
  });

  $('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, async () => {
      say('');
      const { data, error } = await supabase.auth.signUp({
        email: $('suEmail').value.trim(),
        password: $('suPass').value,
        options: { data: { full_name: $('suName').value.trim() }, emailRedirectTo: redirectTo },
      });
      if (error) { say(errText(error), 'error'); return; }
      if (data.session) { await goHome(); return; } // email confirmation disabled
      e.target.reset();
      showPane('signin');
      say('Account created. Check your email and click the confirmation link, then sign in.');
    });
  });

  $('forgotForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, async () => {
      const { error } = await supabase.auth.resetPasswordForEmail($('fpEmail').value.trim(), { redirectTo: `${redirectTo}?mode=reset` });
      if (error) { say(errText(error), 'error'); return; }
      showPane('signin');
      say('If that email has an account, a reset link is on its way.');
    });
  });

  $('resetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, async () => {
      const { error } = await supabase.auth.updateUser({ password: $('rpPass').value });
      if (error) { say(errText(error), 'error'); return; }
      say('Password updated.');
      await goHome();
    });
  });

  // Arriving from a reset email (?mode=reset): the link signs the user in,
  // then they pick a new password instead of being redirected.
  const recovering = new URLSearchParams(location.search).get('mode') === 'reset'
    || location.hash.includes('type=recovery');
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { say(''); showPane('reset'); }
  });

  if (recovering) {
    showPane('reset');
  } else if (!SIGNING_OUT) {
    // Already signed in (or just confirmed via email link) → your area.
    goHome();
  }
}
