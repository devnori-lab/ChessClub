// =====================================================================
// meshLoader.js — streams a piece model with byte-level progress.
//
// Prefers the compact gzip ".mesh" files produced by
// scripts/build-models.mjs (~10x smaller than the STLs). Browsers without
// DecompressionStream fall back to the original STL. Both paths return
// the same non-indexed { positions, normals } triangle soup, in the same
// triangle order, so everything downstream (seeds, barycentrics) is
// unchanged.
// =====================================================================

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    onProgress && onProgress(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    // content-length may describe a transport-compressed size; clamp.
    if (onProgress && total) onProgress(Math.min(0.99, received / total));
  }
  onProgress && onProgress(1);
  const out = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}

async function gunzip(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export function decodeMesh(buffer) {
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'CHM2') throw new Error('bad mesh magic');
  const T = dv.getUint32(4, true);
  const V = dv.getUint32(8, true);
  const min = [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)];
  const max = [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)];
  const scale = min.map((m, a) => Math.max(max[a] - m, 1e-9) / 65535);

  let o = 36;
  const verts = new Float32Array(V * 3);
  const acc = [0, 0, 0];
  for (let i = 0; i < V; i++) {
    for (let a = 0; a < 3; a++) {
      acc[a] = (acc[a] + dv.getInt16(o, true)) & 0xffff; o += 2;
      verts[i * 3 + a] = min[a] + acc[a] * scale[a];
    }
  }

  const positions = new Float32Array(T * 9);
  let high = 0;
  for (let i = 0; i < T * 3; i++) {
    const id = high - dv.getInt32(o, true); o += 4;
    if (id === high) high++;
    positions[i * 3] = verts[id * 3];
    positions[i * 3 + 1] = verts[id * 3 + 1];
    positions[i * 3 + 2] = verts[id * 3 + 2];
  }

  // Flat facet normals from the winding (matches the STL's stored normals);
  // the few sliver triangles where quantisation skews that are patched below.
  const normals = new Float32Array(T * 9);
  for (let t = 0; t < T; t++) {
    const b = t * 9;
    const ux = positions[b + 3] - positions[b], uy = positions[b + 4] - positions[b + 1], uz = positions[b + 5] - positions[b + 2];
    const vx = positions[b + 6] - positions[b], vy = positions[b + 7] - positions[b + 1], vz = positions[b + 8] - positions[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 1; nz = 0; }
    for (let v = 0; v < 3; v++) {
      normals[b + v * 3] = nx; normals[b + v * 3 + 1] = ny; normals[b + v * 3 + 2] = nz;
    }
  }
  const P = dv.getUint32(o, true); o += 4;
  for (let i = 0; i < P; i++, o += 10) {
    const b = dv.getUint32(o, true) * 9;
    const nx = dv.getInt16(o + 4, true) / 32767, ny = dv.getInt16(o + 6, true) / 32767, nz = dv.getInt16(o + 8, true) / 32767;
    for (let v = 0; v < 3; v++) {
      normals[b + v * 3] = nx; normals[b + v * 3 + 1] = ny; normals[b + v * 3 + 2] = nz;
    }
  }
  return { positions, normals };
}

export function parseSTL(buffer) {
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
          const idx = (i * 3 + v) * 3;
          positions[idx] = view.getFloat32(offset, true);
          positions[idx + 1] = view.getFloat32(offset + 4, true);
          positions[idx + 2] = view.getFloat32(offset + 8, true);
          offset += 12;
          normals[idx] = nx; normals[idx + 1] = ny; normals[idx + 2] = nz;
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
      positions.push(+nums[base], +nums[base + 1], +nums[base + 2]);
      normals.push(nx, ny, nz);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}

/** Decode an already-downloaded gzip .mesh buffer. */
export async function decodeGzipMesh(buffer) {
  return decodeMesh(await gunzip(buffer));
}

/**
 * Load one piece. `baseUrl` has no extension, e.g. ".../models/Pawn".
 * Resolves to { positions, normals }.
 */
export async function loadPiece(baseUrl, onProgress) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const gz = await fetchWithProgress(`${baseUrl}.mesh`, onProgress);
      return decodeMesh(await gunzip(gz));
    } catch (err) {
      console.warn('[chess-pieces] .mesh failed, falling back to STL', baseUrl, err);
    }
  }
  return parseSTL(await fetchWithProgress(`${baseUrl}.stl`, onProgress));
}
