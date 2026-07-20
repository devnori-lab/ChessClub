import * as THREE from 'three';

export function initScene(callbacks = {}) {
  // ---------------------------------------------------------------
  // CONFIG & MODELS
  // ---------------------------------------------------------------
  const MODELS = [
    { url: 'src/assets/Pawn.stl',   scale: 1.0 },
    { url: 'src/assets/Knight.stl', scale: 1.0 },
    { url: 'src/assets/Bishop.stl', scale: 1.0 },
    { url: 'src/assets/Rook.stl',   scale: 1.0 },
    { url: 'src/assets/Queen.stl',  scale: 1.08 },
    { url: 'src/assets/King.stl',   scale: 1.12 },
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
    void main(){
      if (vAlpha <= 0.02) discard;
      float d = length(gl_PointCoord - vec2(0.5));
      float a = smoothstep(0.5, 0.0, d) * vAlpha;
      gl_FragColor = vec4(uGlowColor, a * 0.85);
    }
  `;

  const groundVertexShader = `
    attribute float aDist;
    varying float vDist;
    void main(){
      vDist = aDist;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const groundFragmentShader = `
    varying float vDist;
    uniform float uExplode;
    uniform vec3 uGlowColor;
    void main(){
      float reveal = smoothstep(vDist - 0.06, vDist, uExplode);
      float front = 1.0 - clamp(abs(vDist - uExplode) / 0.05, 0.0, 1.0);
      float farFade = 1.0 - smoothstep(0.12, 0.42, vDist);
      float alpha = reveal * farFade * (0.16 + front * 1.5);
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(uGlowColor, alpha);
    }
  `;

  // ---------------------------------------------------------------
  // SETUP & UTILS
  // ---------------------------------------------------------------
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 2.35, 6.2);
  camera.lookAt(0, 1.3, 0);

  function hash(n) {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  // ---------------------------------------------------------------
  // STL PARSING & GEOMETRY
  // ---------------------------------------------------------------
  function parseSTL(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength > 84) {
      const triCount = view.getUint32(80, true);
      if (84 + triCount * 50 === buffer.byteLength) {
        const positions = new Float32Array(triCount * 9);
        const normals = new Float32Array(triCount * 9);
        let offset = 84;
        for (let i = 0; i < triCount; i++) {
          const nx = view.getFloat32(offset, true), ny = view.getFloat32(offset + 4, true), nz = view.getFloat32(offset + 8, true);
          offset += 12;
          for (let v = 0; v < 3; v++) {
            const x = view.getFloat32(offset, true), y = view.getFloat32(offset + 4, true), z = view.getFloat32(offset + 8, true);
            offset += 12;
            const idx = (i * 3 + v) * 3;
            positions[idx] = x; positions[idx+1] = y; positions[idx+2] = z;
            normals[idx] = nx; normals[idx+1] = ny; normals[idx+2] = nz;
          }
          offset += 2;
        }
        return { positions, normals };
      }
    }
    const text = new TextDecoder().decode(buffer);
    const chunks = text.split(/facet\s+normal/i).slice(1);
    const positions = [], normals = [];
    const numRe = /-?\d+\.?\d*(?:[eE][-+]?\d+)?/g;
    for (const chunk of chunks) {
      const nums = chunk.match(numRe);
      if (!nums || nums.length < 12) continue;
      const nx = +nums[0], ny = +nums[1], nz = +nums[2];
      for (let v = 0; v < 3; v++) {
        const base = 3 + v * 3;
        positions.push(+nums[base], +nums[base+1], +nums[base+2]);
        normals.push(nx, ny, nz);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
  }

  function applyRotationFix(positions, normals, fixDeg) {
    if (!fixDeg || (!fixDeg.x && !fixDeg.y && !fixDeg.z)) return { positions, normals };
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(fixDeg.x || 0),
      THREE.MathUtils.degToRad(fixDeg.y || 0),
      THREE.MathUtils.degToRad(fixDeg.z || 0),
      'XYZ'
    );
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const v = new THREE.Vector3();
    const outPos = new Float32Array(positions.length);
    const outNorm = new Float32Array(normals.length);
    for (let i = 0; i < positions.length; i += 3) {
      v.set(positions[i], positions[i+1], positions[i+2]).applyQuaternion(quat);
      outPos[i]=v.x; outPos[i+1]=v.y; outPos[i+2]=v.z;
      v.set(normals[i], normals[i+1], normals[i+2]).applyQuaternion(quat);
      outNorm[i]=v.x; outNorm[i+1]=v.y; outNorm[i+2]=v.z;
    }
    return { positions: outPos, normals: outNorm };
  }

  function buildGeometry(rawPositions, rawNormals, rotationFix) {
    const { positions, normals } = applyRotationFix(rawPositions, rawNormals, rotationFix);
    const triCount = positions.length / 9;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
    
    for (let i = 0; i < positions.length; i += 3) {
      const x=positions[i], y=positions[i+1], z=positions[i+2];
      if (x<minX) minX=x; if (x>maxX) maxX=x;
      if (y<minY) minY=y; if (y>maxY) maxY=y;
      if (z<minZ) minZ=z; if (z>maxZ) maxZ=z;
    }
    
    const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2, baseY=minY;
    const sizeY = Math.max(maxY-minY, 1e-5);
    const scale = CONFIG.targetHeight / sizeY;

    const pos = new Float32Array(positions.length);
    const norm = new Float32Array(positions.length);
    const bary = new Float32Array(positions.length);
    const seed = new Float32Array(positions.length / 3);
    const baryPatterns = [[1,0,0],[0,1,0],[0,0,1]];

    for (let t = 0; t < triCount; t++) {
      const rnd = hash(t);
      let sumY = 0;
      for (let v = 0; v < 3; v++) {
        const si = (t*3+v)*3;
        const x=(positions[si]-cx)*scale, y=(positions[si+1]-baseY)*scale, z=(positions[si+2]-cz)*scale;
        pos[si]=x; pos[si+1]=y; pos[si+2]=z;
        norm[si]=normals[si]; norm[si+1]=normals[si+1]; norm[si+2]=normals[si+2];
        const bp = baryPatterns[v];
        bary[si]=bp[0]; bary[si+1]=bp[1]; bary[si+2]=bp[2];
        sumY += y;
      }
      const avgYNorm = (sumY/3) / CONFIG.targetHeight;
      const s = Math.min(1, Math.max(0, avgYNorm*0.7 + rnd*0.3));
      seed[t*3]=s; seed[t*3+1]=s; seed[t*3+2]=s;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    geo.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return geo;
  }

  const MAX_POINTS = 3200;
  function buildPointsGeometry(meshGeo, maxPoints) {
    const pos = meshGeo.getAttribute('position');
    const seed = meshGeo.getAttribute('aSeed');
    const vertCount = pos.count;
    const stride = Math.max(1, Math.ceil(vertCount / maxPoints));
    const outPos = [], outSeed = [], outOffset = [], outRand = [];
    
    for (let i = 0; i < vertCount; i += stride) {
      outPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      outSeed.push(seed.getX(i));
      const r1 = hash(i*1.37+1.0), r2 = hash(i*2.19+4.0), r3 = hash(i*3.71+7.0);
      const mag = 0.10 + hash(i*5.13+2.0) * 0.22;
      outOffset.push((r1-0.5)*2*mag, (r2-0.5)*2*mag, (r3-0.5)*2*mag);
      outRand.push(hash(i*7.77+3.0));
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPos), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(outSeed), 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(new Float32Array(outOffset), 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(outRand), 1));
    return geo;
  }

  function buildGroundGeometry() {
    const maxRadius = 22, ringCount = 14, segs = 56, spokes = 24;
    const positions = [], dist = [];
    for (let r = 1; r <= ringCount; r++) {
      const t = r / ringCount;
      const rad = maxRadius * Math.pow(t, 1.6);
      const d = rad / maxRadius;
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2, a1 = ((s+1) / segs) * Math.PI * 2;
        positions.push(Math.cos(a0)*rad, 0, Math.sin(a0)*rad, Math.cos(a1)*rad, 0, Math.sin(a1)*rad);
        dist.push(d, d);
      }
    }
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      positions.push(0,0,0, Math.cos(a)*maxRadius, 0, Math.sin(a)*maxRadius);
      dist.push(0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('aDist', new THREE.BufferAttribute(new Float32Array(dist), 1));
    return geo;
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

  // ---------------------------------------------------------------
  // MATERIALS & SCENE GRAPH
  // ---------------------------------------------------------------
  const uniforms = {
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uBaseColor: { value: new THREE.Color(CONFIG.baseColor) },
    uGlowColor: { value: new THREE.Color(CONFIG.accentColor) },
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
  };

  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: pointVertexShader, fragmentShader: pointFragmentShader,
    uniforms: pointUniforms, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const groundUniforms = {
    uExplode: { value: 0 },
    uGlowColor: uniforms.uGlowColor,
  };

  const groundMaterial = new THREE.ShaderMaterial({
    vertexShader: groundVertexShader, fragmentShader: groundFragmentShader,
    uniforms: groundUniforms, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const points = new THREE.Points(new THREE.BufferGeometry(), pointMaterial);
  const ground = new THREE.LineSegments(buildGroundGeometry(), groundMaterial);
  ground.position.y = 0.01;

  group.add(mesh, points, ground);
  scene.add(group);

  function setGeometry(geo, pGeo) {
    mesh.geometry.dispose();
    points.geometry.dispose();
    mesh.geometry = geo;
    points.geometry = pGeo || buildPointsGeometry(geo, MAX_POINTS);
  }

  // ---------------------------------------------------------------
  // PRELOAD & ANIMATION STATE
  // ---------------------------------------------------------------
  let modelsCache = [];
  let modelIndex = 0;
  let currentModelScale = 1;
  let hasDocked = false;
  let ready = false;
  let phase = 'loading';
  let phaseStart = performance.now();

  let dockFromX = 0, dockToX = 0;
  let dockFromY = 0, dockToY = 0;
  let dockFromScale = 1, dockToScale = 0.56;
  let turnFromY = 0, turnToY = Math.PI / 2;

  function worldXForFrac(frac) {
    const camDist = camera.position.z - group.position.z;
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

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    computeDockTarget();
    
    // Auto-adjust live positions if resized AFTER docking has completed
    if (hasDocked && phase !== 'dock') {
      group.position.x = dockToX;
      group.position.y = dockToY;
      group.scale.setScalar(dockToScale);
    }
  }
  
  window.addEventListener('resize', resize);
  resize();

  async function preload() {
    const results = await Promise.all(MODELS.map(async (m) => {
      try {
        const res = await fetch(m.url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        const { positions, normals } = parseSTL(buf);
        if (!positions.length) throw new Error('empty/unparsable STL');
        const rot = m.rotationFix || CONFIG.defaultRotationFix;
        const geo = buildGeometry(positions, normals, rot);
        return { geo, pGeo: buildPointsGeometry(geo, MAX_POINTS), scale: (m.scale != null ? m.scale : 1) };
      } catch (err) {
        console.error('[chess-pieces] failed to load', m.url, err);
        return null;
      }
    }));

    modelsCache = results.filter(Boolean);
    if (modelsCache.length === 0) {
      const geo = buildDefaultPawn();
      modelsCache = [{ geo, pGeo: buildPointsGeometry(geo, MAX_POINTS), scale: 1 }];
    }

    currentModelScale = modelsCache[0].scale;
    setGeometry(modelsCache[0].geo, modelsCache[0].pGeo);
    group.scale.setScalar(CONFIG.centerScale * currentModelScale);
    
    ready = true;
    phase = 'build';
    phaseStart = performance.now();
  }

  // ---------------------------------------------------------------
  // RENDER LOOP
  // ---------------------------------------------------------------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
  const easeInOutCubic = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

  const glowBackdrop = document.getElementById('glow-backdrop');
  const projected = new THREE.Vector3();

  function tick(now) {
    requestAnimationFrame(tick);
    uniforms.uTime.value = now * 0.001;

    if (!ready) { renderer.render(scene, camera); return; }

    const elapsed = now - phaseStart;

    if (reduceMotion) {
      uniforms.uProgress.value = 1.15;
      groundUniforms.uExplode.value = 1;
      group.position.x = dockToX;
      group.position.y = dockToY;
      group.scale.setScalar(dockToScale);
      if (callbacks.onDock) callbacks.onDock();
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
          dockFromX = group.position.x; 
          dockFromY = group.position.y;
          dockFromScale = group.scale.x;
        }
      } else {
        if (elapsed >= CONFIG.holdMs) {
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
      group.position.x = dockFromX + (dockToX - dockFromX) * e;
      group.position.y = dockFromY + (dockToY - dockFromY) * e;
      group.scale.setScalar(dockFromScale + (dockToScale - dockFromScale) * e);
      group.rotation.y += 0.006 * (1 - e * 0.8);
      
      if (p >= 1) {
        hasDocked = true;
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
        modelIndex = (modelIndex + 1) % modelsCache.length;
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

    // Dynamic Glow Tracker
    projected.copy(group.position).setY(group.position.y + CONFIG.targetHeight * 0.55 * group.scale.y);
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
}