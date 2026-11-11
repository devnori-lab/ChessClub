import { storedAccount, renderAccountMenu } from './account-menu.js';
import { initScene } from './scene.js';
import { initSections } from './sections.js';

// ---------------------------------------------------------------------
// Scroll lock — the page stays pinned at the top until the intro has
// played (pawn builds, shrinks and docks left, UI starts fading in).
// <html class="is-locked"> is set in the markup so it applies from the
// very first paint; unlockScroll() lifts it when the scene docks.
// ---------------------------------------------------------------------
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }

const LOCK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
const blockScroll = (e) => e.preventDefault();
const blockKeys = (e) => {
  if (LOCK_KEYS.has(e.key) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) e.preventDefault();
};
window.addEventListener('wheel', blockScroll, { passive: false });
window.addEventListener('touchmove', blockScroll, { passive: false });
window.addEventListener('keydown', blockKeys);

let scrollUnlocked = false;
function unlockScroll() {
  if (scrollUnlocked) return;
  scrollUnlocked = true;
  window.removeEventListener('wheel', blockScroll);
  window.removeEventListener('touchmove', blockScroll);
  window.removeEventListener('keydown', blockKeys);
  document.documentElement.classList.remove('is-locked');
  if (window.ScrollTrigger) ScrollTrigger.refresh();
  // Deep links (#events etc.) were held at the top for the intro; go now.
  const target = location.hash && document.querySelector(location.hash);
  if (target) target.scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------
// Boot loader — reflects the first piece's real download progress, then
// dissolves into the build animation. Later pieces keep loading in the
// background and are reported in the hero's bottom bar.
// ---------------------------------------------------------------------
const loaderEl = document.getElementById('boot-loader');
const ldPct = document.getElementById('ldPct');
const ldBar = document.getElementById('ldBar');
const ldArc = document.getElementById('ldArc');
const ldStatus = document.getElementById('ldStatus');
const ldDraw = loaderEl ? loaderEl.querySelectorAll('.ld-pawn .draw > *') : [];
const pieceSync = document.getElementById('pieceSync');
let loaderGone = false;

function setLoaderProgress(p) {
  const v = Math.max(0, Math.min(1, p));
  if (ldPct) ldPct.textContent = String(Math.round(v * 100)).padStart(3, '0') + '%';
  if (ldBar) ldBar.style.transform = `scaleX(${v})`;
  if (ldArc) ldArc.style.strokeDashoffset = String(1 - v);
  ldDraw.forEach((el) => { el.style.strokeDashoffset = String(1 - v); });
}

function onLoadProgress(info) {
  if (pieceSync) {
    pieceSync.textContent = info.settled >= info.total
      ? (info.loaded >= info.total ? 'All pieces ready' : `Pieces ${info.loaded}/${info.total}`)
      : `Loading ${info.name.toLowerCase()} · ${info.loaded}/${info.total}`;
    pieceSync.classList.toggle('is-loading', info.settled < info.total);
  }
  if (loaderGone || !ldStatus) return;
  const file = `${info.name.toLowerCase()}.mesh`;
  if (info.stage === 'fetch') {
    // Reserve the last 8% for decoding so the bar never stalls at 100%.
    setLoaderProgress(info.progress * 0.92);
    ldStatus.textContent = `> streaming ${file}`;
  } else if (info.stage === 'decode') {
    setLoaderProgress(0.94);
    ldStatus.textContent = `> building ${info.name.toLowerCase()} geometry`;
  } else if (info.stage === 'failed') {
    setLoaderProgress(0);
    ldStatus.textContent = `> ${file} unavailable, trying next piece`;
  }
}

function hideLoader() {
  if (loaderGone || !loaderEl) return;
  loaderGone = true;
  setLoaderProgress(1);
  if (ldStatus) ldStatus.textContent = '> ready';
  // One frame at 100% so the completed state actually registers.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    loaderEl.classList.add('is-done');
    loaderEl.setAttribute('aria-busy', 'false');
    setTimeout(() => loaderEl.remove(), 1000);
  }));
}

// Ensure elements are hidden prior to animation to avoid flickering
// Seen the intro already in this tab (e.g. back from sign-in)? Then skip
// it: index.html's inline script has already hidden the loader and lifted
// the scroll lock before first paint.
const RETURNING = document.documentElement.classList.contains('is-return');

gsap.set('.ui-element', { visibility: 'hidden' });
if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

function revealUI() {
  try { sessionStorage.setItem('introSeen', '1'); } catch (e) { /* storage blocked */ }
  gsap.set('.ui-element', { visibility: 'visible' });
  if (RETURNING) {
    // quick, quiet fade instead of the staged intro choreography
    gsap.fromTo(['.site-header', '.hud-left', '.hero-panel', '.hero-bottom'],
      { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out', stagger: 0.05 });
    return;
  }

  const tl = gsap.timeline();

  // 1. Reveal header, hero footer bar, and the left HUD column
  tl.fromTo(['.site-header', '.hero-bottom', '.hud-left'],
    { opacity: 0, y: (i, target) => target.classList.contains('site-header') ? -20 : 20 },
    { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.2 }
  );

  // 2. Draw the hero panel (scale in and fade)
  tl.fromTo('.hero-panel',
    { opacity: 0, scale: 0.98, x: 20 },
    { opacity: 1, scale: 1, x: 0, duration: 0.8, ease: 'power2.out' },
    "-=0.6"
  );

  // 3. Eyebrow line
  tl.fromTo('#intro-eyebrow',
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' },
    "-=0.2"
  );

  // 4. Stagger headline lines up
  tl.fromTo('#intro-headline',
    { y: 20, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' },
    "-=0.3"
  );

  // 5. Fade in body text and button
  tl.fromTo(['.panel-divider', '#intro-body', '.btn-terminal'],
    { y: 15, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.6, stagger: 0.15, ease: 'power2.out' },
    "-=0.4"
  );
}

function initMobileNav() {
  const toggle = document.getElementById('menuToggle');
  const nav = document.getElementById('mobileNav');
  const scrim = document.getElementById('mobileNavScrim');
  if (!toggle || !nav) return;

  function setOpen(isOpen) {
    toggle.classList.toggle('active', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    nav.classList.toggle('open', isOpen);
    nav.setAttribute('aria-hidden', String(!isOpen));
    if (scrim) scrim.classList.toggle('visible', isOpen);
    document.body.classList.toggle('nav-locked', isOpen);
  }

  toggle.addEventListener('click', () => {
    if (window.matchMedia('(min-width: 1025px)').matches) return; // decorative on desktop, no drawer to open
    setOpen(!nav.classList.contains('open'));
  });
  if (scrim) scrim.addEventListener('click', () => setOpen(false));
  nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

function initScrollReveal() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !window.gsap || !window.ScrollTrigger) {
    document.querySelectorAll('.reveal').forEach((el) => { el.style.opacity = 1; el.style.transform = 'none'; });
    return;
  }
  document.querySelectorAll('.site-section').forEach((section) => {
    const targets = section.querySelectorAll('.reveal');
    if (!targets.length) return;
    gsap.to(targets, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: 'power2.out',
      stagger: 0.08,
      scrollTrigger: {
        trigger: section,
        start: 'top 78%',
        toggleActions: 'play none none none',
      },
    });
  });
}

// ---------------------------------------------------------------------
// Scroll → 3D pose. Progress runs 0..1 across the pinned hero track; the
// scene smooths it and reports the smoothed value back each frame, which
// drives the hero UI fade so DOM and 3D move as one.
// ---------------------------------------------------------------------
const heroTrack = document.getElementById('heroTrack');
const heroEl = document.querySelector('.hero');

function heroScrollProgress() {
  if (!heroTrack) return 0;
  const range = heroTrack.offsetHeight - window.innerHeight;
  if (range <= 0) return 0;
  return Math.min(1, Math.max(0, -heroTrack.getBoundingClientRect().top / range));
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function onScrollProgress(s) {
  if (!heroEl) return;
  // UI clears out during the first ~55% so the final pose reads clean.
  const fade = smoothstep(0.0, 0.55, s);
  heroEl.style.opacity = String(1 - fade);
  heroEl.style.transform = fade > 0 ? `translate3d(0, ${(-48 * fade).toFixed(2)}px, 0)` : '';
  heroEl.classList.toggle('is-scrolled-away', fade > 0.6);
}

// Boot the 3D hero
const stage3d = initScene({
  onDock: () => { revealUI(); unlockScroll(); },
  skipIntro: RETURNING,
  onFirstReady: hideLoader,
  onLoadProgress,
  onScrollProgress,
});
if (RETURNING) { revealUI(); unlockScroll(); }

// How far the frosted sections have slid over the centred piece. The
// swap to the cheap stand-in starts once the glass edge has passed the
// piece entirely, so it's never seen un-blurred; low-power rendering only
// kicks in once the glass reaches the header (the whole view is blurred).
const firstSection = document.querySelector('.site-section');
function coverState() {
  if (!firstSection) return [0, false];
  const vh = window.innerHeight;
  const top = firstSection.getBoundingClientRect().top;
  const start = vh * 0.5 - vh * 0.16;   // glass edge just above the piece
  const end = start - vh * 0.18;
  const amount = Math.min(1, Math.max(0, (start - top) / (start - end)));
  const header = document.querySelector('.site-header');
  return [amount, top <= (header ? header.offsetHeight : 0)];
}

const syncScroll = () => {
  stage3d.setScrollProgress(heroScrollProgress());
  const [amount, full] = coverState();
  stage3d.setCover(amount, full);
};
window.addEventListener('scroll', syncScroll, { passive: true });
window.addEventListener('resize', syncScroll);
syncScroll();

// Header account link: "My Club" when a Supabase session is stored,
// without loading the Supabase SDK on this (animation-heavy) page.
// login.html forwards signed-in users to their player/admin area.
function initAccountLink() {
  const acc = storedAccount();
  renderAccountMenu(acc);
  if (!acc) return;
  document.querySelectorAll('[data-account]').forEach((a) => {
    const arrow = a.querySelector('span');
    a.textContent = ' My Club';
    if (arrow) a.prepend(arrow); else a.textContent = 'My Club';
    a.href = 'player.html';
  });
}

initAccountLink();
initMobileNav();
initSections();
initScrollReveal();
