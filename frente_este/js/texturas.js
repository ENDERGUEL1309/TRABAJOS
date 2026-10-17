// Texturas procedurales generadas en canvas (sin recursos externos).
import * as THREE from 'three';
import { mulberry32, fbm, noise2 } from './util.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Mapa de normales a partir de un campo de alturas (Float32Array w*h) con bordes periódicos.
function normalFromHeight(hf, w, h, strength = 2) {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hf[y * w + ((x - 1 + w) % w)], r = hf[y * w + ((x + 1) % w)];
      const u = hf[((y - 1 + h) % h) * w + x], d = hf[((y + 1) % h) * w + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Ruido periódico (tileable) por mezcla de 4 muestras.
function tileNoise(x, y, w, h, scale, oct) {
  const s = x / w, t = y / h;
  const a = fbm(x * scale, y * scale, oct);
  const b = fbm((x - w) * scale, y * scale, oct);
  const c = fbm(x * scale, (y - h) * scale, oct);
  const d = fbm((x - w) * scale, (y - h) * scale, oct);
  return (a * (1 - s) + b * s) * (1 - t) + (c * (1 - s) + d * s) * t;
}

const cache = {};

// Detalle del suelo: tierra/hierba seca en escala de grises cálida (se multiplica por el color de vértice).
export function texSuelo(size = 512) {
  if (cache.suelo) return cache.suelo;
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  const hf = new Float32Array(size * size);
  const rnd = mulberry32(7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n1 = tileNoise(x, y, size, size, 0.02, 4);
      const n2 = tileNoise(x, y, size, size, 0.12, 2);
      const grain = rnd();
      const v = 0.78 + n1 * 0.12 + n2 * 0.08 + (grain - 0.5) * 0.12;
      hf[y * size + x] = n1 * 0.6 + n2 * 0.5 + grain * 0.35;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, v * 255 * 1.02);
      img.data[i + 1] = Math.min(255, v * 255);
      img.data[i + 2] = Math.min(255, v * 255 * 0.9);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Briznas y piedrecillas
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * size, y = rnd() * size;
    const l = 2 + rnd() * 7, a = rnd() * Math.PI;
    g.strokeStyle = rnd() < 0.5 ? 'rgba(70,64,40,0.35)' : 'rgba(250,240,200,0.25)';
    g.lineWidth = 0.6 + rnd();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const normal = toTex(normalFromHeight(hf, size, size, 3), { srgb: false });
  cache.suelo = { map: toTex(c), normalMap: normal };
  return cache.suelo;
}

// Penacho de hierba con canal alfa.
export function texHierba() {
  if (cache.hierba) return cache.hierba;
  const [c, g] = canvas(128, 128);
  const rnd = mulberry32(11);
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 46; i++) {
    const x0 = 10 + rnd() * 108, h = 60 + rnd() * 66, bend = (rnd() - 0.5) * 40;
    const tone = 0.55 + rnd() * 0.45;
    const dry = rnd();
    const r = Math.floor((dry > 0.5 ? 170 : 95) * tone), gg = Math.floor((dry > 0.5 ? 150 : 120) * tone), b = Math.floor(60 * tone);
    g.strokeStyle = `rgb(${r},${gg},${b})`;
    g.lineWidth = 1.5 + rnd() * 2;
    g.beginPath(); g.moveTo(x0, 128); g.quadraticCurveTo(x0 + bend * 0.3, 128 - h * 0.6, x0 + bend, 128 - h); g.stroke();
  }
  cache.hierba = toTex(c);
  cache.hierba.wrapS = cache.hierba.wrapT = THREE.ClampToEdgeWrapping;
  return cache.hierba;
}

// Hojas para copas de árboles (alfa).
export function texHojas() {
  if (cache.hojas) return cache.hojas;
  const [c, g] = canvas(256);
  const rnd = mulberry32(21);
  // Ramitas
  g.strokeStyle = 'rgba(60,45,30,1)';
  for (let i = 0; i < 14; i++) {
    g.lineWidth = 1 + rnd() * 2;
    const x = rnd() * 256, y = rnd() * 256, a = rnd() * 6.28;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 60, y + Math.sin(a) * 60); g.stroke();
  }
  // Hojas otoñales, más densas en el centro de la tarjeta
  for (let i = 0; i < 1300; i++) {
    const r = Math.pow(rnd(), 0.7) * 120, a = rnd() * 6.28;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r, s = 3 + rnd() * 6;
    const t = rnd();
    const seca = rnd() < 0.35;
    const R = seca ? 140 + t * 60 : 70 + t * 50, G = seca ? 100 + t * 40 : 85 + t * 45, B = seca ? 40 + t * 20 : 30 + t * 20;
    g.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
    g.beginPath(); g.ellipse(x, y, s, s * 0.5, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  cache.hojas = toTex(c);
  cache.hojas.wrapS = cache.hojas.wrapT = THREE.ClampToEdgeWrapping;
  return cache.hojas;
}

export function texCorteza() {
  if (cache.corteza) return cache.corteza;
  const [c, g] = canvas(128, 256);
  const rnd = mulberry32(5);
  g.fillStyle = '#4a4238'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 128;
    g.strokeStyle = `rgba(${20 + rnd() * 50},${18 + rnd() * 40},${15 + rnd() * 30},0.6)`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + rnd() * 10 - 5, 80, x + rnd() * 10 - 5, 170, x + rnd() * 8 - 4, 256); g.stroke();
  }
  cache.corteza = toTex(c);
  return cache.corteza;
}

// Ladrillo envejecido: revoque pintado con desconchones que dejan ver el ladrillo (512 px = 2 m).
export function texLadrillo() {
  if (cache.ladrillo) return cache.ladrillo;
  const S = 512;
  const [c, g] = canvas(S);
  const rnd = mulberry32(3);
  g.fillStyle = '#5a4a3e'; g.fillRect(0, 0, S, S); // mortero
  const bw = 64, bh = 16;
  for (let y = 0; y < S; y += bh) {
    const off = ((y / bh) % 2) * bw * 0.5;
    for (let x = -bw; x < S; x += bw) {
      const t = rnd();
      g.fillStyle = `rgb(${120 + t * 45 | 0},${58 + t * 22 | 0},${42 + t * 16 | 0})`;
      g.fillRect(x + off + 2, y + 2, bw - 4, bh - 3);
    }
  }
  const img = g.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = tileNoise(x, y, S, S, 0.008, 4) + tileNoise(x, y, S, S, 0.05, 2) * 0.25;
    const i = (y * S + x) * 4;
    const ruido = (rnd() - 0.5) * 14;
    if (n > -0.12) {
      // revoque con ligera textura y suciedad
      const k = 0.86 + tileNoise(x, y, S, S, 0.03, 2) * 0.1;
      const borde = n < -0.06 ? 0.75 : 1;
      img.data[i] = (226 * k + ruido) * borde; img.data[i + 1] = (222 * k + ruido) * borde; img.data[i + 2] = (210 * k + ruido) * borde;
    } else {
      img.data[i] += ruido; img.data[i + 1] += ruido; img.data[i + 2] += ruido;
    }
    // Manchas de humedad en la parte baja
    const hum = Math.max(0, (y / S - 0.75) * 3) * (0.6 + n * 0.4);
    img.data[i] *= 1 - hum * 0.35; img.data[i + 1] *= 1 - hum * 0.33; img.data[i + 2] *= 1 - hum * 0.3;
  }
  g.putImageData(img, 0, 0);
  // Impactos de metralla
  for (let k = 0; k < 90; k++) {
    const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * 4;
    g.fillStyle = 'rgba(70,50,40,0.85)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,140,125,0.5)'; g.beginPath(); g.arc(x + 1, y + 1, r * 1.8, 0, Math.PI * 2); g.fill();
  }
  cache.ladrillo = toTex(c);
  return cache.ladrillo;
}

// Fachada de bloque soviético de paneles con ventanas.
export function texFachada() {
  if (cache.fachada) return cache.fachada;
  const [c, g] = canvas(512);
  const rnd = mulberry32(9);
  g.fillStyle = '#9d9a90'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? 40 : 200},${rnd() < 0.5 ? 40 : 200},${rnd() < 0.5 ? 40 : 190},0.05)`;
    g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 6, 2 + rnd() * 6);
  }
  // Juntas de panel
  g.strokeStyle = 'rgba(50,50,50,0.5)'; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke(); }
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, 512); g.stroke(); }
  // Ventanas: 2 por panel horizontal, 4 plantas
  for (let fy = 0; fy < 4; fy++) {
    for (let fx = 0; fx < 4; fx++) {
      const x = fx * 128 + 34, y = fy * 128 + 30;
      const broken = rnd() < 0.55, burnt = rnd() < 0.3;
      g.fillStyle = broken ? '#121212' : '#2a3036';
      g.fillRect(x, y, 60, 64);
      if (!broken) {
        g.fillStyle = 'rgba(160,180,190,0.25)'; g.fillRect(x + 3, y + 3, 26, 58);
        g.strokeStyle = '#ddd'; g.lineWidth = 3; g.strokeRect(x, y, 60, 64);
        g.beginPath(); g.moveTo(x + 30, y); g.lineTo(x + 30, y + 64); g.stroke();
      }
      if (burnt) {
        const gr = g.createLinearGradient(0, y + 60, 0, y - 60);
        gr.addColorStop(0, 'rgba(10,10,10,0.9)'); gr.addColorStop(1, 'rgba(10,10,10,0)');
        g.fillStyle = gr; g.fillRect(x - 20, y - 60, 100, 124);
      }
    }
  }
  cache.fachada = toTex(c);
  return cache.fachada;
}

export function texMadera() {
  if (cache.madera) return cache.madera;
  const [c, g] = canvas(256);
  const rnd = mulberry32(17);
  for (let y = 0; y < 256; y += 32) {
    const t = rnd();
    g.fillStyle = `rgb(${95 + t * 30 | 0},${75 + t * 22 | 0},${50 + t * 15 | 0})`;
    g.fillRect(0, y, 256, 31);
    for (let k = 0; k < 20; k++) {
      g.strokeStyle = 'rgba(40,30,20,0.25)'; g.lineWidth = 1;
      const yy = y + rnd() * 30;
      g.beginPath(); g.moveTo(0, yy); g.lineTo(256, yy + rnd() * 4 - 2); g.stroke();
    }
    g.fillStyle = 'rgba(20,15,10,0.8)'; g.fillRect(0, y + 31, 256, 1);
  }
  cache.madera = toTex(c);
  return cache.madera;
}

// Pintura militar verde con desgaste, barro y óxido. tint: color base.
export function texBlindaje(tint = '#4b5236', key = 'blindaje') {
  if (cache[key]) return cache[key];
  const [c, g] = canvas(256);
  const rnd = mulberry32(key.length * 31 + 7);
  g.fillStyle = tint; g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const n = tileNoise(x, y, 256, 256, 0.03, 4);
      const n2 = tileNoise(x, y, 256, 256, 0.16, 2);
      const i = (y * 256 + x) * 4;
      const k = 1 + n * 0.18 + n2 * 0.06;
      img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
      // Barro en la parte baja de la textura
      const mud = Math.max(0, (y / 256 - 0.55) * 2.2 + n * 0.8);
      if (mud > 0) {
        const m = Math.min(1, mud);
        img.data[i] = img.data[i] * (1 - m) + 92 * m;
        img.data[i + 1] = img.data[i + 1] * (1 - m) + 80 * m;
        img.data[i + 2] = img.data[i + 2] * (1 - m) + 60 * m;
      }
    }
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(110,60,30,${rnd() * 0.25})` : `rgba(20,20,15,${rnd() * 0.2})`;
    g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * 8, 0, Math.PI * 2); g.fill();
  }
  cache[key] = toTex(c);
  return cache[key];
}

// Camuflaje pixelado (UA tipo MM-14) o digital (RU tipo EMR).
export function texCamo(faccion) {
  const key = 'camo_' + faccion;
  if (cache[key]) return cache[key];
  const [c, g] = canvas(256);
  const rnd = mulberry32(faccion === 'UA' ? 14 : 88);
  const pal = faccion === 'UA'
    ? ['#6b6b4c', '#4d553a', '#7f7a5a', '#3a3a2c']
    : ['#6e6b52', '#556046', '#3c4433', '#8a8466'];
  g.fillStyle = pal[0]; g.fillRect(0, 0, 256, 256);
  const px = faccion === 'UA' ? 6 : 4;
  for (let layer = 1; layer < pal.length; layer++) {
    for (let y = 0; y < 256; y += px) {
      for (let x = 0; x < 256; x += px) {
        const n = noise2(x * 0.03 + layer * 17, y * 0.03 - layer * 5) + noise2(x * 0.1, y * 0.1 + layer) * 0.3;
        if (n > 0.25 + layer * 0.08 - rnd() * 0.1) { g.fillStyle = pal[layer]; g.fillRect(x, y, px, px); }
      }
    }
  }
  cache[key] = toTex(c, { repeat: 1 });
  return cache[key];
}

export function texSaco() {
  if (cache.saco) return cache.saco;
  const [c, g] = canvas(128);
  const rnd = mulberry32(23);
  g.fillStyle = '#7d7356'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) { g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.05})`; g.fillRect(0, y, 128, 1); }
  for (let x = 0; x < 128; x += 2) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`; g.fillRect(x, 0, 1, 128); }
  cache.saco = toTex(c);
  return cache.saco;
}

export function texHormigon() {
  if (cache.hormigon) return cache.hormigon;
  const [c, g] = canvas(256);
  const rnd = mulberry32(29);
  g.fillStyle = '#8c8a84'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? 50 : 200},${rnd() < 0.5 ? 50 : 200},${rnd() < 0.5 ? 50 : 200},0.06)`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 4, 1 + rnd() * 4);
  }
  cache.hormigon = toTex(c);
  return cache.hormigon;
}

// Partícula blanda (humo/polvo) con alfa.
export function texHumo() {
  if (cache.humo) return cache.humo;
  const [c, g] = canvas(128);
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = (x - 64) / 64, dy = (y - 64) / 64;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(x * 0.05, y * 0.05, 4) * 0.5 + 0.5;
      const a = Math.max(0, 1 - d) ** 1.5 * (0.5 + n * 0.8);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  cache.humo = toTex(c);
  cache.humo.wrapS = cache.humo.wrapT = THREE.ClampToEdgeWrapping;
  return cache.humo;
}

export function texFogonazo() {
  if (cache.fogonazo) return cache.fogonazo;
  const [c, g] = canvas(128);
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.25, 'rgba(255,190,90,0.9)');
  gr.addColorStop(1, 'rgba(255,90,10,0)');
  g.fillStyle = gr;
  g.translate(64, 64);
  for (let i = 0; i < 5; i++) {
    g.rotate(Math.PI * 2 / 5 + 0.3);
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, -64); g.lineTo(6, 0); g.fill();
  }
  g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
  cache.fogonazo = toTex(c);
  cache.fogonazo.wrapS = cache.fogonazo.wrapT = THREE.ClampToEdgeWrapping;
  return cache.fogonazo;
}

// Revestimiento de tablas horizontales (casas americanas de los 50). Blanco: se tiñe con color de vértice.
export function texRevestimiento() {
  if (cache.revest) return cache.revest;
  const S = 256;
  const [c, g] = canvas(S);
  const rnd = mulberry32(51);
  g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, S, S);
  const tabla = 16; // 256 px = 2 m -> tablas de 12,5 cm
  for (let y = 0; y < S; y += tabla) {
    const gr = g.createLinearGradient(0, y, 0, y + tabla);
    gr.addColorStop(0, 'rgba(0,0,0,0.18)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.02)');
    g.fillStyle = gr; g.fillRect(0, y, S, tabla);
    g.fillStyle = 'rgba(40,35,30,0.35)'; g.fillRect(0, y, S, 1);
  }
  // Pintura desconchada y suciedad
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * 5;
    g.fillStyle = rnd() < 0.7 ? `rgba(120,100,80,${0.08 + rnd() * 0.15})` : `rgba(255,255,255,${rnd() * 0.15})`;
    g.beginPath(); g.ellipse(x, y, r * 2, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  const gr = g.createLinearGradient(0, S * 0.7, 0, S);
  gr.addColorStop(0, 'rgba(90,75,55,0)'); gr.addColorStop(1, 'rgba(90,75,55,0.25)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  cache.revest = toTex(c);
  return cache.revest;
}

// Tejas asfálticas
export function texTejas() {
  if (cache.tejas) return cache.tejas;
  const S = 256;
  const [c, g] = canvas(S);
  const rnd = mulberry32(61);
  g.fillStyle = '#4a4542'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 21) {
    const off = ((y / 21) % 2) * 16;
    for (let x = -32; x < S; x += 32) {
      const t = rnd();
      g.fillStyle = `rgb(${62 + t * 30 | 0},${58 + t * 26 | 0},${55 + t * 22 | 0})`;
      g.fillRect(x + off + 1, y + 1, 30, 19);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + off, y + 18, 32, 3);
    }
  }
  for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? 0 : 200},${rnd() < 0.5 ? 0 : 190},${rnd() < 0.5 ? 0 : 170},0.08)`; g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
  cache.tejas = toTex(c);
  return cache.tejas;
}

// Suelo de madera para interiores
export function texParquet() {
  if (cache.parquet) return cache.parquet;
  const S = 256;
  const [c, g] = canvas(S);
  const rnd = mulberry32(71);
  for (let y = 0; y < S; y += 16) {
    let x = -rnd() * 64;
    while (x < S) {
      const l = 48 + rnd() * 64, t = rnd();
      g.fillStyle = `rgb(${120 + t * 40 | 0},${82 + t * 26 | 0},${50 + t * 16 | 0})`;
      g.fillRect(x, y, l - 1, 15);
      for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(60,35,20,0.15)'; g.fillRect(x, y + rnd() * 15, l, 1); }
      x += l;
    }
  }
  cache.parquet = toTex(c);
  return cache.parquet;
}
