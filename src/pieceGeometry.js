// =====================================================================
// pieceGeometry.js — pure typed-array geometry prep for a chess piece.
//
// Moved verbatim out of scene.js so it can run inside a Web Worker (see
// pieceWorker.js) while the animation keeps running. The math — rotation
// fix, normalisation, per-triangle seeds, barycentrics, spark points —
// is unchanged, so the build/dematerialize pattern is identical.
// =====================================================================

import { Euler, Quaternion, Vector3, MathUtils } from 'three';

export function hash(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function applyRotationFix(positions, normals, fixDeg) {
  if (!fixDeg || (!fixDeg.x && !fixDeg.y && !fixDeg.z)) return { positions, normals };
  const euler = new Euler(
    MathUtils.degToRad(fixDeg.x || 0),
    MathUtils.degToRad(fixDeg.y || 0),
    MathUtils.degToRad(fixDeg.z || 0),
    'XYZ'
  );
  const quat = new Quaternion().setFromEuler(euler);
  const v = new Vector3();
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

/** Returns { position, normal, aBary, aSeed } typed arrays. */
export function computeMeshArrays(rawPositions, rawNormals, rotationFix, targetHeight) {
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
  const scale = targetHeight / sizeY;

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
    const avgYNorm = (sumY/3) / targetHeight;
    const s = Math.min(1, Math.max(0, avgYNorm*0.7 + rnd*0.3));
    seed[t*3]=s; seed[t*3+1]=s; seed[t*3+2]=s;
  }

  return { position: pos, normal: norm, aBary: bary, aSeed: seed };
}

/** Returns { position, aSeed, aOffset, aRand } typed arrays for the spark points. */
export function computePointArrays(mesh, maxPoints) {
  const pos = mesh.position;
  const seed = mesh.aSeed;
  const vertCount = seed.length;
  const stride = Math.max(1, Math.ceil(vertCount / maxPoints));
  const outPos = [], outSeed = [], outOffset = [], outRand = [];

  for (let i = 0; i < vertCount; i += stride) {
    outPos.push(pos[i*3], pos[i*3+1], pos[i*3+2]);
    outSeed.push(seed[i]);
    const r1 = hash(i*1.37+1.0), r2 = hash(i*2.19+4.0), r3 = hash(i*3.71+7.0);
    const mag = 0.10 + hash(i*5.13+2.0) * 0.22;
    outOffset.push((r1-0.5)*2*mag, (r2-0.5)*2*mag, (r3-0.5)*2*mag);
    outRand.push(hash(i*7.77+3.0));
  }

  return {
    position: new Float32Array(outPos),
    aSeed: new Float32Array(outSeed),
    aOffset: new Float32Array(outOffset),
    aRand: new Float32Array(outRand),
  };
}

/** Typed arrays to hand across postMessage without copying. */
export function transferablesOf(...groups) {
  const list = [];
  for (const g of groups) for (const k in g) list.push(g[k].buffer);
  return list;
}
