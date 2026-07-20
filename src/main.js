import { initScene } from './scene.js';
import { initSections } from './sections.js';

// Ensure elements are hidden prior to animation to avoid flickering
gsap.set('.ui-element', { visibility: 'hidden' });
if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

function revealUI() {
  gsap.set('.ui-element', { visibility: 'visible' });

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

// Boot the 3D hero
initScene({ onDock: revealUI });

initMobileNav();
initSections();
initScrollReveal();
