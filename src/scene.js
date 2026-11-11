import * as THREE from 'three';
import { loadPiece, decodeGzipMesh } from './meshLoader.js';
import { computeMeshArrays, computePointArrays } from './pieceGeometry.js';

export function initScene(callbacks = {}) {
  // ---------------------------------------------------------------
  // CONFIG & MODELS
  // ---------------------------------------------------------------
  // `url` has no extension: meshLoader fetches the compact .mesh build
  // (scripts/build-models.mjs) and falls back to the .stl if needed.
  // Order matters — pieces appear in exactly this sequence.
  const MODELS = [
    { name: 'Pawn',   url: `${import.meta.env.BASE_URL}models/Pawn`,   scale: 1.0 },
    { name: 'Knight', url: `${import.meta.env.BASE_URL}models/Knight`, scale: 1.0 },
    { name: 'Bishop', url: `${import.meta.env.BASE_URL}models/Bishop`, scale: 1.0 },
    { name: 'Rook',   url: `${import.meta.env.BASE_URL}models/Rook`,   scale: 1.0 },
    { name: 'Queen',  url: `${import.meta.env.BASE_URL}models/Queen`,  scale: 1.08 },
    { name: 'King',   url: `${import.meta.env.BASE_URL}models/King`,   scale: 1.12 },
  ];

  const CONFIG = {
    dockSide: 'left',
    defaultRotationFix: { x: 0, y: 90, z: 0 },
    accentColor: 0x8fe7ff,
    baseColor: 0x1a4a5c,
    targetHeight: 2.5,
    centerScale: 1.0,
    dockScale: 0.76,
    // Keep in sync with the CSS layout breakpoint (@media max-width: 1024px
    // in style.css). Mismatched breakpoints previously caused the piece to
    // dock to the desktop "left" x-position on tablet-width screens while
    // the CSS had already switched to the stacked mobile layout.
    mobileBreakpoint: 1024,

    buildDurationMs: 2600,
    introHoldMs: 700,
    dockDurationMs: 1400,
    holdMs: 1300,
    turnDurationMs: 1500,
    dematerializeDurationMs: 1100,

    // Scroll pose: how quickly the rendered pose chases the scroll position
    // (higher = snappier). Wheel ticks get smoothed into a glide.
    scrollDamping: 7,

    // "Covered" mode — the frosted sections hide the piece completely, so
    // the real 270k-triangle mesh is swapped for the grid's cheap glow
    // stand-in, the canvas renders at reduced resolution and frame rate,
    // and the grid glows brighter so it still reads through the blur.
    coveredPixelRatio: 0.5,
    coveredFps: 30,
    coveredGlowBoost: 1.0,
  };

  // ---------------------------------------------------------------
  // SHADERS
  // ---------------------------------------------------------------
  const vertexShader = `
    attribute vec3 aBary;
    attribute float aSeed;
    uniform float uProgress;
    varying vec3 vBary;
    varying float vReveal;
    varying float vSeed;
    varying vec3 vNormalW;
    varying vec3 vViewDir;

    void main(){
      vBary = aBary;
      vSeed = aSeed;
      float reveal = smoothstep(aSeed - 0.12, aSeed + 0.02, uProgress);
      vReveal = clamp(reveal, 0.0, 1.0);

      vec3 finalPos = position;
      vec3 originPos = vec3(0.0, position.y * 0.15, 0.0);
      vec3 dir = normalize(finalPos - originPos + 1e-4);
      float overshoot = sin(clamp((uProgress - aSeed) * 9.0, 0.0, 3.14159)) * 0.05 * (1.0 - vReveal);
      vec3 grownPos = mix(originPos, finalPos, vReveal) + dir * overshoot;

      vec4 worldPos = modelMatrix * vec4(grownPos, 1.0);
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vViewDir = normalize(cameraPosition - worldPos.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const fragmentShader = `
    varying vec3 vBary;
    varying float vReveal;
    varying float vSeed;
    varying vec3 vNormalW;
    varying vec3 vViewDir;
    uniform float uTime;
    uniform vec3 uBaseColor;
    uniform vec3 uGlowColor;
    uniform float uOpacity;

    float edgeFactor(vec3 bary){
      vec3 d = fwidth(bary);
      vec3 a3 = smoothstep(vec3(0.0), d, bary);
      return 1.0 - min(min(a3.x, a3.y), a3.z);
    }

    float rand1(float n){ return fract(sin(n * 43758.5453) * 43758.5453); }

    void main(){
      vec3 N = normalize(vNormalW);
      vec3 V = normalize(vViewDir);
      float ndv = clamp(dot(N, V), 0.0, 1.0);
      float fresnel = pow(1.0 - ndv, 2.2);

      vec3 L = normalize(vec3(0.4, 0.8, 0.6));
      float diff = clamp(dot(N, L), 0.0, 1.0);
      vec3 facetColor = mix(uBaseColor * 0.35, uBaseColor, diff);
      vec3 rim = uGlowColor * fresnel * 1.3;

      float edge = edgeFactor(vBary);
      float wave = fract(vSeed * 4.0 - uTime * 0.15);
      float travel = smoothstep(0.0, 0.06, wave) * smoothstep(0.24, 0.06, wave);
      float edgeGlow = edge * (0.30 + travel * 1.6);
      vec3 builtColor = facetColor + rim + uGlowColor * edgeGlow;

      float flicker = rand1(vSeed * 91.7 + floor(uTime * 9.0));
      vec3 unbuiltColor = uGlowColor * edge * (0.55 + flicker * 0.85);

      vec3 finalColor = mix(unbuiltColor, builtColor, vReveal);
      float alpha = mix(edge * (0.30 + flicker * 0.25), 1.0, vReveal);

      alpha *= uOpacity;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  const pointVertexShader = `
    attribute float aSeed;
    attribute vec3 aOffset;
    attribute float aRand;
    uniform float uProgress;
    uniform float uTime;
    varying float vAlpha;
    void main(){
      float d = uProgress - aSeed;
      float band = smoothstep(-0.18, 0.0, d) * smoothstep(0.30, 0.04, d);
      float twinkle = 0.4 + 0.6 * sin(uTime * (4.0 + aRand * 5.0) + aRand * 6.2831);
      vAlpha = band * clamp(twinkle, 0.0, 1.0);
      vec3 p = position + aOffset * band;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (1.6 + 2.0 * band) * (240.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const pointFragmentShader = `
    varying float vAlpha;
    uniform vec3 uGlowColor;
    uniform float uOpacity;
    void main(){
      if (vAlpha <= 0.02) discard;
      float d = length(gl_PointCoord - vec2(0.5));
      float a = smoothstep(0.5, 0.0, d) * vAlpha;
      gl_FragColor = vec4(uGlowColor, a * 0.85 * uOpacity);
    }
  `;

  // Ground grid: drawn procedurally on one quad instead of as 1px line
  // segments, which lets every line carry a soft glow halo. Same layout as
  // before — 14 rings at radius 22·(k/14)^1.6 and 24 spokes — and the same
  // reveal / explode-front / far-fade terms, so the timing is unchanged.
  // uCore paints a cheap stand-in for the piece (seen face-on, behind the
  // frosted sections) that breathes with the build/dematerialize cycle.
  const groundVertexShader = `
    varying vec2 vP;
    void main(){
      vP = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const groundFragmentShader = `
    varying vec2 vP;
    uniform float uExplode;
    uniform float uGlow;
    uniform float uCore;
    uniform float uIdlePulse;
    uniform float uProgress;
    uniform float uTime;
    uniform vec3 uGlowColor;

    const float MAX_R = 22.0;
    const float RINGS = 14.0;
    const float SPOKES = 24.0;
    const float TAU = 6.2831853;

    float ringRadius(float k){ return MAX_R * pow(clamp(k, 1.0, RINGS) / RINGS, 1.6); }

    void main(){
      float r = length(vP);
      float dist = r / MAX_R;
      float px = max(length(fwidth(vP)) * 0.7071, 1e-5); // world units per pixel

      // nearest ring
      float t = pow(dist, 1.0 / 1.6) * RINGS;
      float dR = min(abs(r - ringRadius(floor(t))), abs(r - ringRadius(ceil(t)))) / px;
      // nearest spoke
      float sector = TAU / SPOKES;
      float da = mod(atan(vP.y, vP.x) + sector * 0.5, sector) - sector * 0.5;
      float dS = r * abs(sin(da)) / px;

      float d = min(dR, dS);
      float core = 1.0 - smoothstep(0.0, 1.1, d);
      float halo = exp(-dR / 7.0) + exp(-dS / 7.0) * 0.8;

      float reveal = smoothstep(dist - 0.06, dist, uExplode);
      float front = 1.0 - clamp(abs(dist - uExplode) / 0.05, 0.0, 1.0);
      float farFade = 1.0 - smoothstep(0.12, 0.42, dist);

      // Idle ripple: while the grid rests fully revealed (between the build
      // and dematerialize pulses), a faint ring drifts out every few seconds.
      float idle = smoothstep(0.85, 1.0, uExplode) * uIdlePulse;
      float rp = fract(uTime / 3.4);
      float ripple = idle * (1.0 - rp) * exp(-pow((dist - rp * 0.46) / 0.022, 2.0));

      // The halo is strong only on the moving pulses; at rest it's a dim hint.
      float energy = max(front, ripple * 0.7);
      float haloW = mix(0.10, 0.55, energy) * uGlow;
      float lineA = reveal * farFade * (0.12 + front * 1.5 + ripple * 0.45);
      float alpha = lineA * (core + halo * haloW);
      // soft shock-wave sweeping out with the explode front (and ripple)
      alpha += (front * front * 0.10 + ripple * ripple * 0.035) * farFade * uGlow;

      // face-on stand-in for the piece while it's hidden under the glass
      float build = clamp(uProgress, 0.0, 1.0);
      float pulse = 0.85 + 0.15 * sin(uTime * 2.3);
      float disc = exp(-r * r / 0.55) * 0.75 + exp(-pow((r - 0.62) / 0.09, 2.0)) * 0.45;
      alpha += uCore * build * pulse * disc;

      if (alpha < 0.004) discard;
      gl_FragColor = vec4(uGlowColor, min(alpha, 1.0));
    }
  `;

  // ---------------------------------------------------------------
  // SETUP & UTILS
  // ---------------------------------------------------------------
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const fullPixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(fullPixelRatio());
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 2.35, 6.2);
  camera.lookAt(0, 1.3, 0);

  // ---------------------------------------------------------------
  // GEOMETRY (typed-array prep lives in pieceGeometry.js so the worker
  // can run it; these wrap the arrays into BufferGeometries)
  // ---------------------------------------------------------------
  function toGeometry(arrays, itemSizes) {
    const geo = new THREE.BufferGeometry();
    for (const k in itemSizes) geo.setAttribute(k, new THREE.BufferAttribute(arrays[k], itemSizes[k]));
    return geo;
  }
  const MESH_ATTRS = { position: 3, normal: 3, aBary: 3, aSeed: 1 };
  const POINT_ATTRS = { position: 3, aSeed: 1, aOffset: 3, aRand: 1 };

  function buildGeometry(rawPositions, rawNormals, rotationFix) {
    return computeMeshArrays(rawPositions, rawNormals, rotationFix, CONFIG.targetHeight);
  }

  const MAX_POINTS = 3200;

  function buildGroundGeometry() {
    // A quad in its own XY plane (the shader's polar input), laid flat by
    // the mesh rotation below. Covers out to the far-fade cutoff (≈ 9.3).
    return new THREE.PlaneGeometry(19.2, 19.2);
  }

  function buildDefaultPawn() {
    const profile = [
      new THREE.Vector2(0.58, 0.00), new THREE.Vector2(0.62, 0.04),
      new THREE.Vector2(0.56, 0.09), new THREE.Vector2(0.30, 0.13),
      new THREE.Vector2(0.27, 0.40), new THREE.Vector2(0.38, 0.45),
      new THREE.Vector2(0.40, 0.58), new THREE.Vector2(0.27, 0.64),
      new THREE.Vector2(0.25, 0.74), new THREE.Vector2(0.42, 0.82),
      new THREE.Vector2(0.30, 0.92), new THREE.Vector2(0.34, 1.10),
      new THREE.Vector2(0.02, 1.24),
    ];
    let lathe = new THREE.LatheGeometry(profile, 10);
    lathe = lathe.toNonIndexed();
    lathe.computeVertexNormals();
    const pos = lathe.getAttribute('position').array;
    const norm = lathe.getAttribute('normal').array;
    return buildGeometry(new Float32Array(pos), new Float32Array(norm), null);
  }

  function makeEntry(meshArrays, pointArrays, scale) {
    return {
      geo: toGeometry(meshArrays, MESH_ATTRS),
      pGeo: toGeometry(pointArrays || computePointArrays(meshArrays, MAX_POINTS), POINT_ATTRS),
      scale,
    };
  }

  // ---------------------------------------------------------------
  // MATERIALS & SCENE GRAPH
  // ---------------------------------------------------------------
  const uniforms = {
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uBaseColor: { value: new THREE.Color(CONFIG.baseColor) },
    uGlowColor: { value: new THREE.Color(CONFIG.accentColor) },
    uOpacity: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, side: THREE.DoubleSide,
  });
  material.extensions = { derivatives: true };

  const pointUniforms = {
    uProgress: uniforms.uProgress,
    uTime: uniforms.uTime,
    uGlowColor: uniforms.uGlowColor,
    uOpacity: uniforms.uOpacity,
  };

  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: pointVertexShader, fragmentShader: pointFragmentShader,
    uniforms: pointUniforms, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const groundUniforms = {
    uExplode: { value: 0 },
    uGlow: { value: 1 },
    uCore: { value: 0 },
    uIdlePulse: { value: 1 },
    uProgress: uniforms.uProgress,
    uTime: uniforms.uTime,
    uGlowColor: uniforms.uGlowColor,
  };

  const groundMaterial = new THREE.ShaderMaterial({
    vertexShader: groundVertexShader, fragmentShader: groundFragmentShader,
    uniforms: groundUniforms, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  groundMaterial.extensions = { derivatives: true };

  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const points = new THREE.Points(new THREE.BufferGeometry(), pointMaterial);
  // The quad's geometry is in its own XY; rotate it flat into XZ.
  const ground = new THREE.Mesh(buildGroundGeometry(), groundMaterial);
  ground.rotation.x = Math.PI / 2;
  ground.position.y = 0.01;

  group.add(mesh, points, ground);
  scene.add(group);

  function setGeometry(geo, pGeo) {
    // Cached geometries are reused every cycle, so they are not disposed
    // here (the GPU buffers simply stay resident — six pieces).
    mesh.geometry = geo;
    points.geometry = pGeo;
  }

  // ---------------------------------------------------------------
  // PRELOAD & ANIMATION STATE
  // ---------------------------------------------------------------
  // One slot per MODELS entry, filled progressively:
  //   undefined = still loading, null = failed (skipped), object = ready.
  const modelsCache = new Array(MODELS.length);
  let modelIndex = 0;
  let nextModelIndex = 0;
  let currentModelScale = 1;
  let hasDocked = false;
  let ready = false;
  let phase = 'loading';
  let phaseStart = performance.now();

  // The intro/dock animation writes the piece's "base" position here; the
  // scroll pose then blends it toward screen-centre (see applyScrollPose).
  const basePos = new THREE.Vector3();
  let dockFromX = 0, dockToX = 0;
  let dockFromY = 0, dockToY = 0;
  let dockFromScale = 1, dockToScale = 0.56;
  let turnFromY = 0, turnToY = Math.PI / 2;

  function worldXForFrac(frac) {
    const camDist = camera.position.z - basePos.z;
    const vFOV = camera.fov * Math.PI / 180;
    const halfHeight = Math.tan(vFOV/2) * camDist;
    const halfWidth = halfHeight * camera.aspect;
    let x = (frac*2 - 1) * halfWidth;
    return Math.max(-halfWidth*0.62, Math.min(halfWidth*0.62, x));
  }

  function computeDockTarget() {
    const isMobile = window.innerWidth <= CONFIG.mobileBreakpoint;
    if (isMobile) {
      dockToX = 0; // Keep centered horizontally on mobile
      dockToY = 1.0; // Lift the entire grid and piece up so it doesn't hide behind UI
      dockToScale = (CONFIG.dockScale * currentModelScale) * 0.75; // Shrink slightly more
    } else {
      const frac = CONFIG.dockSide === 'left' ? 0.24 : 0.76;
      dockToX = worldXForFrac(frac);
      dockToY = 0;
      dockToScale = CONFIG.dockScale * currentModelScale;
    }
  }

  let lowPower = false;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(lowPower ? CONFIG.coveredPixelRatio : fullPixelRatio());
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    computeDockTarget();
    
    // Auto-adjust live positions if resized AFTER docking has completed
    if (hasDocked && phase !== 'dock') {
      basePos.x = dockToX;
      basePos.y = dockToY;
      group.scale.setScalar(dockToScale);
    }
  }
  
  window.addEventListener('resize', resize);
  resize();

  // Pieces load strictly one after another, in display order, so the
  // first one (the pawn) gets the whole connection and the show can start
  // as soon as it lands; the rest stream in behind the running animation.
  // Fetch + decode + geometry prep run in a worker so the animation never
  // hitches; if workers are unavailable it all runs on the main thread.
  let worker = null;
  try {
    worker = new Worker(new URL('./pieceWorker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    worker = null;
  }

  // index.html starts downloading the pawn from an inline <script> in
  // <head>, in parallel with the JS bundle. Use those bytes if available.
  async function takePrefetch(i, onProgress) {
    const pf = window.__pawnPrefetch;
    if (i !== 0 || !pf || !pf.promise) return null;
    pf.listeners.push(onProgress);
    onProgress(pf.progress);
    try { return await pf.promise; }
    catch (err) { return null; }
    finally { window.__pawnPrefetch = null; }
  }

  function loadInWorker(i, onProgress, buffer) {
    return new Promise((resolve, reject) => {
      const m = MODELS[i];
      const onMessage = (e) => {
        const d = e.data;
        if (d.id !== i) return;
        if (d.type === 'progress') { onProgress(d.progress); return; }
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (d.type === 'done') resolve(makeEntry(d.mesh, d.points, m.scale != null ? m.scale : 1));
        else reject(new Error(d.message));
      };
      const onError = (e) => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(e.error || new Error(e.message || 'worker error'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({
        id: i, url: new URL(m.url, location.href).href, buffer,
        rotationFix: m.rotationFix || CONFIG.defaultRotationFix,
        targetHeight: CONFIG.targetHeight, maxPoints: MAX_POINTS,
      }, buffer ? [buffer] : []);
    });
  }

  async function loadOnMainThread(i, onProgress, buffer) {
    const m = MODELS[i];
    const { positions, normals } = buffer ? await decodeGzipMesh(buffer) : await loadPiece(m.url, onProgress);
    if (!positions.length) throw new Error('empty/unparsable model');
    const arrays = buildGeometry(positions, normals, m.rotationFix || CONFIG.defaultRotationFix);
    return makeEntry(arrays, null, m.scale != null ? m.scale : 1);
  }

  async function loadOne(i, onProgress) {
    try {
      const buffer = await takePrefetch(i, onProgress);
      if (buffer) onProgress(1);
      if (worker) {
        // A transferred buffer is detached, so a retry would refetch.
        try { return await loadInWorker(i, onProgress, buffer); }
        catch (err) {
          console.warn('[chess-pieces] worker load failed, retrying on main thread', MODELS[i].url, err);
          worker.terminate(); worker = null;
        }
      }
      return await loadOnMainThread(i, onProgress, buffer && buffer.byteLength ? buffer : null);
    } catch (err) {
      console.error('[chess-pieces] failed to load', MODELS[i].url, err);
      return null;
    }
  }

  function start(i) {
    modelIndex = i;
    nextModelIndex = i;
    const first = modelsCache[i];
    currentModelScale = first.scale;
    setGeometry(first.geo, first.pGeo);
    computeDockTarget();
    if (callbacks.skipIntro) {
      // Returning visitor: skip the centre build + dock and start the
      // regular cycle already in the docked pose (exactly how every later
      // piece builds), so the Pawn → King sequence is unchanged.
      basePos.set(dockToX, dockToY, 0);
      group.scale.setScalar(dockToScale);
      hasDocked = true;
      dockAnnounced = true;
    } else {
      group.scale.setScalar(CONFIG.centerScale * currentModelScale);
    }

    ready = true;
    phase = 'build';
    phaseStart = performance.now();
    if (callbacks.onFirstReady) callbacks.onFirstReady();
  }

  function report(i, stage, progress) {
    if (!callbacks.onLoadProgress) return;
    callbacks.onLoadProgress({
      index: i, name: MODELS[i].name, stage, progress,
      total: MODELS.length,
      loaded: modelsCache.filter(Boolean).length,
      settled: modelsCache.filter((s) => s !== undefined).length,
    });
  }

  async function preload() {
    for (let i = 0; i < MODELS.length; i++) {
      report(i, 'fetch', 0);
      const entry = await loadOne(i, (p) => report(i, p >= 1 ? 'decode' : 'fetch', p));
      modelsCache[i] = entry;
      report(i, entry ? 'ready' : 'failed', 1);
      if (entry && !ready) start(i);
    }
    if (worker) { worker.terminate(); worker = null; }

    if (!ready) {
      // Nothing loaded at all — fall back to a procedural pawn.
      modelsCache[0] = makeEntry(buildDefaultPawn(), null, 1);
      start(0);
    }
  }

  // Next piece in display order, skipping failures. Returns -1 while that
  // piece is still loading: the current one simply holds a little longer,
  // so the sequence is never reordered or skipped on a slow connection.
  function peekNextModel() {
    for (let k = 1; k <= MODELS.length; k++) {
      const i = (modelIndex + k) % MODELS.length;
      const slot = modelsCache[i];
      if (slot === null) continue;
      return slot === undefined ? -1 : i;
    }
    return modelIndex;
  }

  // ---------------------------------------------------------------
  // SCROLL POSE
  // 0 = docked hero pose, 1 = centred on screen with the grid parallel
  // to the screen and the piece pointing straight out at the viewer.
  // ---------------------------------------------------------------
  let scrollTarget = 0;
  let scrollSmooth = 0;
  let lastScrollReported = -1;
  const centerPos = new THREE.Vector3(0, 1.3, 0); // camera.lookAt target = screen centre
  // Tilt (about X) that turns the piece's +Y axis to face the camera:
  // R_x(t)·(0,1,0) = (0, cos t, sin t) ∥ (camera.position − target).
  const faceTilt = Math.atan2(camera.position.z - centerPos.z, camera.position.y - centerPos.y);

  function applyScrollPose(dt) {
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * CONFIG.scrollDamping);
    scrollSmooth += (scrollTarget - scrollSmooth) * k;
    if (Math.abs(scrollTarget - scrollSmooth) < 1e-4) scrollSmooth = scrollTarget;

    const e = easeInOutCubic(scrollSmooth);
    group.position.lerpVectors(basePos, centerPos, e);
    // Euler 'XYZ' applies the animation's Y spin in the piece's own frame
    // first, then this tilt — so turns keep working once it faces you.
    group.rotation.x = faceTilt * e;

    if (callbacks.onScrollProgress && scrollSmooth !== lastScrollReported) {
      lastScrollReported = scrollSmooth;
      callbacks.onScrollProgress(scrollSmooth);
    }
  }

  // ---------------------------------------------------------------
  // RENDER LOOP
  // ---------------------------------------------------------------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) groundUniforms.uIdlePulse.value = 0;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
  const easeInOutCubic = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

  const glowBackdrop = document.getElementById('glow-backdrop');
  const projected = new THREE.Vector3();
  let lastNow = performance.now();
  let dockAnnounced = false;

  // 0 = piece fully visible, 1 = fully under the glass (fake stand-in).
  let cover = 0;
  function applyCover() {
    uniforms.uOpacity.value = 1 - cover;
    groundUniforms.uCore.value = cover;
    groundUniforms.uGlow.value = 1 + cover * CONFIG.coveredGlowBoost;
    mesh.visible = points.visible = cover < 1;
  }

  function tick(now) {
    requestAnimationFrame(tick);
    // Under the glass nobody can see 60 fps; the state machine is
    // time-based, so skipped frames don't alter the piece timing.
    if (lowPower && now - lastNow < 1000 / CONFIG.coveredFps - 2) return;
    uniforms.uTime.value = now * 0.001;
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;

    if (!ready) { renderer.render(scene, camera); return; }

    const elapsed = now - phaseStart;

    if (reduceMotion) {
      uniforms.uProgress.value = 1.15;
      groundUniforms.uExplode.value = 1;
      basePos.x = dockToX;
      basePos.y = dockToY;
      group.scale.setScalar(dockToScale);
      hasDocked = true;
      if (!dockAnnounced) { dockAnnounced = true; if (callbacks.onDock) callbacks.onDock(); }
      phase = 'static';
    } 
    else if (phase === 'build') {
      const p = Math.min(1, elapsed / CONFIG.buildDurationMs);
      uniforms.uProgress.value = easeOutCubic(p) * 1.15;
      groundUniforms.uExplode.value = easeOutQuint(p);
      if (!hasDocked) group.rotation.y += 0.006;
      if (p >= 1) { phase = 'hold'; phaseStart = now; }
    } 
    else if (phase === 'hold') {
      if (!hasDocked) {
        group.rotation.y += 0.006;
        if (elapsed >= CONFIG.introHoldMs) {
          phase = 'dock'; phaseStart = now;
          dockFromX = basePos.x;
          dockFromY = basePos.y;
          dockFromScale = group.scale.x;
        }
      } else {
        // Hold until the next piece in the sequence has finished loading.
        const next = elapsed >= CONFIG.holdMs ? peekNextModel() : -1;
        if (next !== -1) {
          nextModelIndex = next;
          phase = 'turn'; phaseStart = now;
          turnFromY = group.rotation.y;
          turnToY = turnFromY + Math.PI / 2;
        }
      }
    } 
    else if (phase === 'dock') {
      const p = Math.min(1, elapsed / CONFIG.dockDurationMs);
      const e = easeInOutCubic(p);
      
      // Interpolate both X (desktop) and Y (mobile) simultaneously
      basePos.x = dockFromX + (dockToX - dockFromX) * e;
      basePos.y = dockFromY + (dockToY - dockFromY) * e;
      group.scale.setScalar(dockFromScale + (dockToScale - dockFromScale) * e);
      group.rotation.y += 0.006 * (1 - e * 0.8);
      
      if (p >= 1) {
        hasDocked = true;
        dockAnnounced = true;
        if (callbacks.onDock) callbacks.onDock();
        phase = 'hold'; 
        phaseStart = now;
      }
    } 
    else if (phase === 'turn') {
      const p = Math.min(1, elapsed / CONFIG.turnDurationMs);
      const e = easeInOutCubic(p);
      group.rotation.y = turnFromY + (turnToY - turnFromY) * e;
      if (p >= 1) { phase = 'dematerialize'; phaseStart = now; }
    } 
    else if (phase === 'dematerialize') {
      const p = Math.min(1, elapsed / CONFIG.dematerializeDurationMs);
      const e = easeInOutCubic(p);
      uniforms.uProgress.value = (1 - e) * 1.15;
      groundUniforms.uExplode.value = 1 - e;
      
      if (p >= 1) {
        modelIndex = nextModelIndex;
        const next = modelsCache[modelIndex];
        currentModelScale = next.scale;
        setGeometry(next.geo, next.pGeo);
        group.rotation.y = 0;
        
        // Ensure scale is maintained after switching models
        group.scale.setScalar(CONFIG.dockScale * currentModelScale * (window.innerWidth <= CONFIG.mobileBreakpoint ? 0.75 : 1));
        
        uniforms.uProgress.value = 0;
        groundUniforms.uExplode.value = 0;
        phase = 'build'; phaseStart = now;
      }
    }

    applyScrollPose(dt);

    // Dynamic Glow Tracker — follows the piece's own axis, so it stays on
    // the piece as the scroll pose tilts it toward the viewer.
    group.updateMatrixWorld();
    projected.set(0, CONFIG.targetHeight * 0.55, 0);
    group.localToWorld(projected);
    projected.project(camera);
    const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    
    if (glowBackdrop) {
      glowBackdrop.style.transform = `translate(${sx}px, ${sy}px)`;
      glowBackdrop.style.opacity = Math.min(1, uniforms.uProgress.value) * 0.85;
    }

    renderer.render(scene, camera);
  }

  // Boot
  preload();
  requestAnimationFrame(tick);

  return {
    /** Raw scroll progress through the hero, 0..1 (smoothed internally). */
    setScrollProgress(p) {
      scrollTarget = Math.min(1, Math.max(0, p || 0));
    },
    /**
     * How much of the piece the frosted UI covers (0..1), and whether the
     * whole viewport is behind glass (enables reduced resolution / fps).
     */
    setCover(amount, fullyCovered) {
      const c = Math.min(1, Math.max(0, amount || 0));
      if (c !== cover) { cover = c; applyCover(); }
      const lp = !!fullyCovered && cover >= 1;
      if (lp !== lowPower) { lowPower = lp; resize(); }
    },
  };
}