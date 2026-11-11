// Off-main-thread loader: fetch + decode + geometry prep for one piece at
// a time, so the running animation never stalls while the next one loads.
import { loadPiece, decodeGzipMesh } from './meshLoader.js';
import { computeMeshArrays, computePointArrays, transferablesOf } from './pieceGeometry.js';

self.onmessage = async (e) => {
  const { id, url, buffer, rotationFix, targetHeight, maxPoints } = e.data;
  try {
    // `buffer` = gzip .mesh bytes the page already prefetched (the pawn).
    const { positions, normals } = buffer
      ? await decodeGzipMesh(buffer)
      : await loadPiece(url, (p) => self.postMessage({ id, type: 'progress', progress: p }));
    if (!positions.length) throw new Error('empty/unparsable model');
    const mesh = computeMeshArrays(positions, normals, rotationFix, targetHeight);
    const points = computePointArrays(mesh, maxPoints);
    self.postMessage({ id, type: 'done', mesh, points }, transferablesOf(mesh, points));
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.message || err) });
  }
};
