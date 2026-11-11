// =====================================================================
// build-models.mjs — converts the source STL chess pieces into compact,
// gzip-compressed ".mesh" files that the site streams in at runtime.
//
//   node scripts/build-models.mjs            (or: npm run models)
//
// Why: binary STL spends 50 bytes per triangle (a float normal, three
// float vertices and padding, every vertex repeated per triangle). The
// six pieces total ~50 MB, which is what made GitHub Pages so slow.
//
// What is preserved (so the shader animation looks identical):
//   * triangle order and the vertex order inside every triangle — the
//     build/dematerialize pattern seeds each triangle from its index, and
//     the wireframe glow uses per-vertex barycentric slots.
//   * the stored facet normals: they are recomputed from the winding on
//     the client, and every triangle where that recomputation (on the
//     quantised positions) drifts from the stored normal ships its
//     original normal as a patch entry — a few hundred slivers per piece.
// What changes: vertex positions are quantised to 16 bits per axis over
// the bounding box (error < 1/65535 of the piece size, far below a pixel).
//
// File layout (little-endian), gzip-compressed as a whole:
//   0   char[4]  magic "CHM2"
//   4   u32      triangle count  T
//   8   u32      unique vertex count  V
//   12  f32[3]   bbox min
//   24  f32[3]   bbox max
//   36  i16[V*3] quantised positions, delta-coded per axis (wrapping)
//   ..  i32[T*3] vertex indices, coded as (highWater - index)
//   ..  u32      normal patch count  P
//   ..  P x { u32 triangle, i16[3] normal * 32767 }
// =====================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src/assets');
const OUT = join(root, 'public/models');
const PIECES = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];

function convert(name) {
  const buf = readFileSync(join(SRC, `${name}.stl`));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const T = dv.getUint32(80, true);
  if (84 + T * 50 !== buf.byteLength) throw new Error(`${name}: not a binary STL`);

  const raw = new Float32Array(T * 9);
  const nrm = new Float32Array(T * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0, o = 84; t < T; t++, o += 50) {
    for (let k = 0; k < 3; k++) nrm[t * 3 + k] = dv.getFloat32(o + k * 4, true);
    for (let k = 0; k < 9; k++) {
      const v = dv.getFloat32(o + 12 + k * 4, true);
      raw[t * 9 + k] = v;
      const a = k % 3;
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }

  const ext = min.map((m, a) => Math.max(max[a] - m, 1e-9));
  const q = (v, a) => Math.round(((v - min[a]) / ext[a]) * 65535);

  // De-duplicate quantised vertices in order of first appearance.
  const map = new Map();
  const verts = [];
  const idx = new Uint32Array(T * 3);
  for (let i = 0; i < T * 3; i++) {
    const x = q(raw[i * 3], 0), y = q(raw[i * 3 + 1], 1), z = q(raw[i * 3 + 2], 2);
    const key = x * 4294967296 + y * 65536 + z; // < 2^48, exact in a double
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(x, y, z); }
    idx[i] = id;
  }
  const V = verts.length / 3;

  // Normal patches: recompute each facet normal exactly as the client
  // will (from the quantised, de-quantised positions) and keep the
  // stored normal wherever the two disagree noticeably.
  const deq = (v, a) => min[a] + v * (ext[a] / 65535);
  const patches = [];
  for (let t = 0; t < T; t++) {
    const p = [0, 1, 2].map((k) => {
      const id = idx[t * 3 + k];
      return [deq(verts[id * 3], 0), deq(verts[id * 3 + 1], 1), deq(verts[id * 3 + 2], 2)];
    });
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const cl = Math.hypot(cx, cy, cz);
    const n0 = nrm[t * 3], n1 = nrm[t * 3 + 1], n2 = nrm[t * 3 + 2];
    const nl = Math.hypot(n0, n1, n2) || 1;
    const dot = cl > 0 ? (n0 * cx + n1 * cy + n2 * cz) / (nl * cl) : -1;
    if (dot < 0.9995) patches.push([t, n0 / nl, n1 / nl, n2 / nl]);
  }

  // Serialise.
  const header = 36;
  const out = Buffer.alloc(header + V * 6 + T * 12 + 4 + patches.length * 10);
  out.write('CHM2', 0, 'latin1');
  out.writeUInt32LE(T, 4);
  out.writeUInt32LE(V, 8);
  for (let a = 0; a < 3; a++) {
    out.writeFloatLE(min[a], 12 + a * 4);
    out.writeFloatLE(max[a], 24 + a * 4);
  }
  let o = header;
  const prev = [0, 0, 0];
  for (let i = 0; i < V; i++) {
    for (let a = 0; a < 3; a++) {
      const v = verts[i * 3 + a];
      out.writeInt16LE(((v - prev[a] + 32768) & 0xffff) - 32768, o); o += 2;
      prev[a] = v;
    }
  }
  let high = 0;
  for (let i = 0; i < T * 3; i++) {
    out.writeInt32LE(high - idx[i], o); o += 4;
    if (idx[i] === high) high++;
  }
  out.writeUInt32LE(patches.length, o); o += 4;
  for (const [t, x, y, z] of patches) {
    out.writeUInt32LE(t, o);
    out.writeInt16LE(Math.round(x * 32767), o + 4);
    out.writeInt16LE(Math.round(y * 32767), o + 6);
    out.writeInt16LE(Math.round(z * 32767), o + 8);
    o += 10;
  }

  const gz = gzipSync(out, { level: 9 });
  writeFileSync(join(OUT, `${name}.mesh`), gz);
  console.log(
    `${name.padEnd(7)} tris ${String(T).padStart(7)}  verts ${String(V).padStart(7)}  ` +
    `stl ${(buf.byteLength / 1e6).toFixed(2)} MB -> mesh ${(gz.length / 1e6).toFixed(2)} MB  ` +
    `(normal patches: ${patches.length})`
  );
}

mkdirSync(OUT, { recursive: true });
PIECES.forEach(convert);
