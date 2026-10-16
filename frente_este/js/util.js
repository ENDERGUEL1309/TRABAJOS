// Utilidades comunes: ruido, matemáticas, intersecciones y aleatorio con semilla.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Suavizado independiente de la tasa de fotogramas.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
export const moveTowards = (a, b, maxDelta) => (Math.abs(b - a) <= maxDelta ? b : a + Math.sign(b - a) * maxDelta);
export const moveAngleTowards = (a, b, maxDelta) => {
  const d = wrapAngle(b - a);
  return Math.abs(d) <= maxDelta ? a + d : a + Math.sign(d) * maxDelta;
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Ruido simplex 2D (implementación compacta) ---
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const perm = new Uint8Array(512);
(function () {
  const r = mulberry32(1991);
  const p = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

export function noise2(x, y) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = grad[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = grad[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = grad[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
  return 70 * n; // ~[-1,1]
}

export function fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}

// --- Intersecciones ---
const _v = new THREE.Vector3();
// Segmento a->b contra esfera; devuelve t en [0,1] o -1.
export function segSphere(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  if (C < 0) return 0;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A === 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}

// Segmento contra caja alineada {min:{x,y,z}, max:{x,y,z}}; devuelve {t, nx,ny,nz} o null.
export function segAABB(a, b, box) {
  let tmin = 0, tmax = 1, nx = 0, ny = 0, nz = 0;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const o = [a.x, a.y, a.z];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];
  let axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (mn[i] - o[i]) * inv, t2 = (mx[i] - o[i]) * inv, s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (axis === 0) nx = sign; else if (axis === 1) ny = sign; else if (axis === 2) nz = sign;
  return { t: tmin, nx, ny, nz };
}

// Segmento contra caja orientada (matriz mundo + medias dimensiones en local).
const _inv = new THREE.Matrix4(), _la = new THREE.Vector3(), _lb = new THREE.Vector3();
export function segOBB(a, b, matrixWorld, half, center) {
  _inv.copy(matrixWorld).invert();
  _la.copy(a).applyMatrix4(_inv);
  _lb.copy(b).applyMatrix4(_inv);
  const box = {
    min: { x: center.x - half.x, y: center.y - half.y, z: center.z - half.z },
    max: { x: center.x + half.x, y: center.y + half.y, z: center.z + half.z },
  };
  return segAABB(_la, _lb, box);
}

// Empuja un círculo (x,z,r) fuera de una caja alineada en XZ. Devuelve true si corrigió.
export function pushCircleAABB(p, r, box) {
  const cx = clamp(p.x, box.min.x, box.max.x);
  const cz = clamp(p.z, box.min.z, box.max.z);
  let dx = p.x - cx, dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r;
  } else {
    // Centro dentro de la caja: sacar por el lado más cercano.
    const l = p.x - box.min.x, rr = box.max.x - p.x, b = p.z - box.min.z, f = box.max.z - p.z;
    const m = Math.min(l, rr, b, f);
    if (m === l) p.x = box.min.x - r; else if (m === rr) p.x = box.max.x + r;
    else if (m === b) p.z = box.min.z - r; else p.z = box.max.z + r;
  }
  return true;
}

export function vec(x = 0, y = 0, z = 0) { return new THREE.Vector3(x, y, z); }
export { _v as tmpVec };

export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}
