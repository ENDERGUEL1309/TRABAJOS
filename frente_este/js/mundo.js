// Mundo: terreno de estepa con trincheras y cráteres, cinturones forestales, aldea destruida,
// bloque de viviendas, elevador de grano, cielo nublado, iluminación y colisiones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, noise2, mulberry32, clamp, segAABB, pushCircleAABB } from './util.js';
import * as TX from './texturas.js';

export const MAPA = 1200;   // medio lado del mapa completo (m)
export const ZONA = 320;    // medio lado de la zona de combate de alta resolución (m)

// --- Elementos analíticos del paisaje ---
const carreteraZ = (x) => 8 + 25 * Math.sin(x * 0.003);
const carreteraX = (z) => -40 + 20 * Math.sin(z * 0.004 + 1.0);
function distCarreteras(x, z) {
  const d1 = Math.abs(z - carreteraZ(x)) / Math.sqrt(1 + (0.075 * Math.cos(x * 0.003)) ** 2);
  const d2 = Math.abs(x - carreteraX(z)) / Math.sqrt(1 + (0.08 * Math.cos(z * 0.004 + 1)) ** 2);
  return Math.min(d1, d2);
}
const CELDA_X = 310, CELDA_Z = 270, ORIGEN = -1250;
function tipoCampo(x, z) {
  const cx = Math.floor((x - ORIGEN) / CELDA_X), cz = Math.floor((z - ORIGEN) / CELDA_Z);
  const h = Math.abs(Math.sin(cx * 127.1 + cz * 311.7) * 43758.5453) % 1;
  return h < 0.25 ? 0 : h < 0.5 ? 1 : h < 0.7 ? 2 : 3; // 0 arado, 1 rastrojo trigo, 2 girasol, 3 barbecho
}
function distCinturon(x, z) {
  const fx = (((x - ORIGEN) % CELDA_X) + CELDA_X) % CELDA_X;
  const fz = (((z - ORIGEN) % CELDA_Z) + CELDA_Z) % CELDA_Z;
  return Math.min(fx, CELDA_X - fx, fz, CELDA_Z - fz);
}
const ALDEA = { x: 10, z: 0, r: 120 };

function alturaBase(x, z) {
  let h = fbm(x * 0.0011, z * 0.0011, 4) * 30 + fbm(x * 0.006, z * 0.006, 3) * 3.2 + noise2(x * 0.05, z * 0.05) * 0.18;
  // Barranco (balka) al este
  const bx = 430 + 60 * Math.sin(z * 0.004);
  const db = Math.abs(x - bx);
  if (db < 45) h -= 9 * (1 - (db / 45) ** 2);
  // Aplanar la aldea
  const da = Math.hypot(x - ALDEA.x, z - ALDEA.z);
  if (da < ALDEA.r + 60) {
    const k = clamp((ALDEA.r + 60 - da) / 60, 0, 1);
    const ref = fbm(ALDEA.x * 0.0011, ALDEA.z * 0.0011, 4) * 30;
    h = h * (1 - k * 0.85) + ref * k * 0.85;
  }
  // Carreteras ligeramente rebajadas
  const dc = distCarreteras(x, z);
  if (dc < 6) h -= 0.25 * (1 - dc / 6);
  return h;
}

// Trincheras: polilíneas en zigzag
function crearTrincheras() {
  const lineas = [];
  for (const lado of [-1, 1]) {
    const x0 = lado * 150;
    const pts = [];
    for (let z = -230, k = 0; z <= 230; z += 11, k++) pts.push([x0 + (k % 2 ? 3.5 : -3.5) + 6 * Math.sin(z * 0.02), z]);
    lineas.push(pts);
    // Trinchera de comunicación hacia la retaguardia
    const com = [];
    for (let x = x0, k = 0; Math.abs(x) <= 215; x += lado * 9, k++) com.push([x, 30 + (k % 2 ? 2.5 : -2.5)]);
    lineas.push(com);
  }
  // Posiciones avanzadas en la aldea (zanja corta)
  lineas.push([[-70, -60], [-62, -50], [-66, -38], [-58, -28]]);
  lineas.push([[85, 55], [78, 45], [84, 35], [76, 25]]);
  return lineas;
}

function cajaGeo(w, h, d, ts = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [su, sv] = f < 2 ? [d, h] : f < 4 ? [w, d] : [w, h];
    for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * su / ts, uv.getY(i) * sv / ts); }
  }
  return g;
}
function conColor(g, c) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function fusionar(geos) {
  const lista = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of lista) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return mergeGeometries(lista, false);
}

export { cajaGeo, conColor, fusionar, rotar };

export class Mundo {
  // mapa: null para el Frente Este; o un módulo de mapa { id, configurar(mundo), construir(mundo) }
  constructor(scene, renderer, calidad, mapa = null) {
    this.mapa = mapa ? mapa.id : 'frente';
    this.ZONA = ZONA; this.MAPA = MAPA;
    this.alturaFn = alturaBase;
    this.pasoInterior = calidad.pasoTerreno;
    this.colorSuelo = null;   // (x, z, color, n1, n2) => void
    this.infoHierba = null;   // (x, z, rnd) => null | { alto, verde }
    this.limites = null;      // { x0, x1, z0, z1 } zona jugable
    this.ajusteCielo = { hor: '#b5b8b4', cen: '#6f8296', sol: [-0.55, 0.32, -0.45], niebla: 0.0019, luz: 2.4, ambiente: 0.55 };
    this.scene = scene;
    this.calidad = calidad;
    this.rnd = mulberry32(2022);
    this.colisores = [];          // {min,max,mat}
    this.rejilla = new Map();     // hash espacial de colisores (celdas de 8 m)
    this.arboles = [];            // {x,z,y,r,vivo,iTronco,iCopa,iSeco}
    this.rejillaArboles = new Map();
    this.fuegos = [];             // posiciones de incendios para humo
    this.tiempo = 0;
    if (mapa) mapa.configurar(this);
    this.trincheras = mapa ? [] : crearTrincheras();

    this.crearCielo(renderer);
    this.crearLuces();
    this.crearTerreno();
    this.hierba = new Map();
    this.crearMaterialHierba();
    if (mapa) { mapa.construir(this); return; }
    this.crearArboles();
    this.crearAldea();
    this.crearBloque();
    this.crearElevador();
    this.crearTrincherasMalla();
    this.crearObstaculos();
    this.crearPostes();
    this.crearBases();
  }

  // ---------------- Cielo y luz ----------------
  crearCielo(renderer) {
    const AC = this.ajusteCielo;
    this.colorHorizonte = new THREE.Color(AC.hor);
    const cenit = new THREE.Color(AC.cen);
    this.sol = new THREE.Vector3(...AC.sol).normalize();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uSol: { value: this.sol }, uHor: { value: this.colorHorizonte }, uCen: { value: cenit },
        uColSol: { value: new THREE.Color('#ffe7c4') }, uTiempo: { value: 0 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 uSol, uHor, uCen, uColSol; uniform float uTiempo;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHor, uCen, pow(h, 0.55));
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.1) * 1.3 + vec2(uTiempo*0.004, uTiempo*0.0015);
            float c = fbm(uv * 1.4);
            float cover = smoothstep(0.38, 0.72, c + 0.06);
            float sh = fbm(uv * 2.8 + 4.0);
            vec3 nube = mix(vec3(0.42,0.44,0.46), vec3(0.80,0.79,0.77), sh);
            col = mix(col, nube, cover * smoothstep(0.0, 0.2, d.y) * 0.92);
          }
          float s = max(dot(d, normalize(uSol)), 0.0);
          col += uColSol * (pow(s, 900.0) * 2.0 + pow(s, 10.0) * 0.22);
          col = mix(col, uHor, smoothstep(0.03, -0.06, d.y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.matCielo = mat;
    this.cielo = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
    this.cielo.frustumCulled = false;
    this.cielo.renderOrder = -1;
    this.scene.add(this.cielo);
    this.scene.fog = new THREE.FogExp2(this.colorHorizonte.clone(), AC.niebla);
    this.scene.background = this.colorHorizonte.clone();

    // Mapa de entorno para reflejos PBR
    const pm = new THREE.PMREMGenerator(renderer);
    const esc = new THREE.Scene();
    const domo = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
    esc.add(domo);
    const suelo = new THREE.Mesh(new THREE.CircleGeometry(100, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4a4434' }));
    suelo.position.y = -2;
    esc.add(suelo);
    this.scene.environment = pm.fromScene(esc, 0.02).texture;
    pm.dispose();
  }

  crearLuces() {
    const s = new THREE.DirectionalLight('#ffe2c0', this.ajusteCielo.luz);
    s.castShadow = true;
    const q = this.calidad;
    s.shadow.mapSize.set(q.sombra, q.sombra);
    const R = q.radioSombra;
    Object.assign(s.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 400 });
    s.shadow.bias = -0.0005;
    s.shadow.normalBias = 0.05;
    this.luzSol = s;
    this.scene.add(s, s.target);
    this.scene.add(new THREE.HemisphereLight('#b9c3cc', '#5b4c38', this.ajusteCielo.ambiente));
  }

  // ---------------- Terreno ----------------
  crearTerreno() {
    const q = this.calidad;
    // Rejilla interior
    const Z = this.ZONA, MP = this.MAPA, H = this.alturaFn;
    const n = Math.round((Z * 2) / this.pasoInterior);
    const paso = (Z * 2) / n;
    const N1 = n + 1;
    const alt = new Float32Array(N1 * N1);
    for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) alt[j * N1 + i] = H(-Z + i * paso, -Z + j * paso);
    this.int = { n, paso, N1, x0: -Z, alt, oscuro: new Float32Array(N1 * N1) };
    void q;

    // Trincheras (estampado sobre la rejilla, combinando por máximo)
    const prof = new Float32Array(N1 * N1);
    this.segTrinchera = [];
    for (const linea of this.trincheras) {
      for (let k = 0; k < linea.length - 1; k++) {
        const [ax, az] = linea[k], [bx, bz] = linea[k + 1];
        this.segTrinchera.push([ax, az, bx, bz]);
        this.estampar(Math.min(ax, bx) - 4, Math.min(az, bz) - 4, Math.max(ax, bx) + 4, Math.max(az, bz) + 4, (x, z, idx) => {
          const d = distSeg(x, z, ax, az, bx, bz);
          const v = 1.95 * (1 - smooth(0.95, 1.55, d)) - 0.45 * Math.exp(-(((d - 2.5) / 0.7) ** 2));
          if (v > prof[idx] || (prof[idx] <= 0 && v < prof[idx])) prof[idx] = v;
        });
      }
    }
    for (let i = 0; i < alt.length; i++) alt[i] -= prof[i];
    this.profTrinchera = prof;

    // Cráteres de artillería preexistentes (más densos en tierra de nadie)
    const r = this.rnd;
    for (let k = 0; k < (this.mapa === 'frente' ? 260 : 0); k++) {
      let x = (r() * 2 - 1) * (ZONA - 20), z = (r() * 2 - 1) * (ZONA - 20);
      if (r() < 0.6) x = (r() * 2 - 1) * 140;
      if (Math.hypot(x - ALDEA.x, z - ALDEA.z) < 60 && r() < 0.7) continue;
      const rad = 1.5 + r() ** 2 * 5;
      this.crater(x, z, rad, rad * 0.35, false);
    }

    const geoI = this.crearGeoRejilla(this.int, true);
    this.geoInterior = geoI;
    const tex = TX.texSuelo();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.97, metalness: 0,
    });
    this.matTerreno = mat;
    const mI = new THREE.Mesh(geoI, mat);
    mI.receiveShadow = true;
    this.scene.add(mI);

    // Rejilla exterior (baja resolución), hundida bajo la interior
    const ne = this.mapa === 'frente' ? 240 : 120, pe = (MP * 2) / ne, NE = ne + 1;
    const ae = new Float32Array(NE * NE);
    for (let j = 0; j < NE; j++) for (let i = 0; i < NE; i++) {
      const x = -MP + i * pe, z = -MP + j * pe;
      let h = H(x, z);
      if (Math.abs(x) < Z - 0.01 && Math.abs(z) < Z - 0.01) h -= 4;
      ae[j * NE + i] = h;
    }
    this.ext = { n: ne, paso: pe, N1: NE, x0: -MP, alt: ae, oscuro: new Float32Array(NE * NE) };
    const geoE = this.crearGeoRejilla(this.ext, false);
    const mE = new THREE.Mesh(geoE, mat);
    mE.receiveShadow = true;
    this.scene.add(mE);
    // Faldón para el horizonte
    const anillo = new THREE.Mesh(new THREE.RingGeometry(MP * 1.41, 4000, 32, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#6b6347', roughness: 1 }));
    anillo.position.y = -2;
    this.scene.add(anillo);
  }

  estampar(x0, z0, x1, z1, fn) {
    const g = this.int;
    const i0 = Math.max(0, Math.floor((x0 - g.x0) / g.paso)), i1 = Math.min(g.n, Math.ceil((x1 - g.x0) / g.paso));
    const j0 = Math.max(0, Math.floor((z0 - g.x0) / g.paso)), j1 = Math.min(g.n, Math.ceil((z1 - g.x0) / g.paso));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(g.x0 + i * g.paso, g.x0 + j * g.paso, j * g.N1 + i, i, j);
    return [i0, i1, j0, j1];
  }

  crearGeoRejilla(g, interior) {
    const { n, paso, N1, x0, alt } = g;
    const pos = new Float32Array(N1 * N1 * 3), nor = new Float32Array(N1 * N1 * 3);
    const uv = new Float32Array(N1 * N1 * 2), col = new Float32Array(N1 * N1 * 3);
    for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
      const k = j * N1 + i, x = x0 + i * paso, z = x0 + j * paso;
      pos[k * 3] = x; pos[k * 3 + 1] = alt[k]; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 3.5; uv[k * 2 + 1] = z / 3.5;
    }
    const idx = new Uint32Array(n * n * 6);
    let p = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * N1 + i, b = (j + 1) * N1 + i, c = a + 1, d = b + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = c; idx[p++] = b; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    g.geo = geo;
    g.interior = interior;
    this.actualizarRegion(g, 0, n, 0, n);
    geo.computeBoundingSphere();
    return geo;
  }

  // Recalcula normales y colores de una región de la rejilla.
  actualizarRegion(g, i0, i1, j0, j1) {
    const { N1, paso, x0, alt, geo, oscuro } = g;
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, col = geo.attributes.color.array;
    const C = {
      seca: new THREE.Color('#8a7f57'), verde: new THREE.Color('#5d6638'), tierra: new THREE.Color('#5e4a35'),
      barro: new THREE.Color('#3d3226'), camino: new THREE.Color('#6c5e4a'), asfalto: new THREE.Color('#4a4743'),
      arado: new THREE.Color('#4b3b2b'), trigo: new THREE.Color('#a39363'), girasol: new THREE.Color('#5a4b37'),
    };
    const tmp = new THREE.Color();
    for (let j = Math.max(0, j0); j <= Math.min(g.n, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(g.n, i1); i++) {
      const k = j * N1 + i;
      const hl = alt[j * N1 + Math.max(0, i - 1)], hr = alt[j * N1 + Math.min(N1 - 1, i + 1)];
      const hd = alt[Math.max(0, j - 1) * N1 + i], hu = alt[Math.min(N1 - 1, j + 1) * N1 + i];
      let nx = hl - hr, ny = 2 * paso, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      pos[k * 3 + 1] = alt[k];
      // Color
      const x = x0 + i * paso, z = x0 + j * paso;
      const n1 = noise2(x * 0.02, z * 0.02), n2 = noise2(x * 0.15, z * 0.15);
      if (this.colorSuelo) this.colorSuelo(x, z, tmp, n1, n2);
      else {
      const tipo = tipoCampo(x, z);
      if (tipo === 0) tmp.copy(C.arado).lerp(C.tierra, 0.5 + 0.5 * Math.sin(x * 2.2 + z * 0.3) * 0.5);
      else if (tipo === 1) tmp.copy(C.trigo).lerp(C.seca, 0.4 + n2 * 0.3);
      else if (tipo === 2) tmp.copy(C.girasol).lerp(C.seca, 0.3 + n2 * 0.3);
      else tmp.copy(C.seca).lerp(C.verde, clamp(0.45 + n1 * 0.6, 0, 1));
      const dcin = distCinturon(x, z);
      if (dcin < 12) tmp.lerp(C.verde, (1 - dcin / 12) * 0.6);
      const dc = distCarreteras(x, z);
      if (dc < 4.5) {
        const enAldea = Math.hypot(x - ALDEA.x, z - ALDEA.z) < ALDEA.r;
        tmp.lerp(enAldea ? C.asfalto : C.camino, clamp((4.5 - dc) / 1.5, 0, 1) * (0.8 + n2 * 0.2));
      }
      }
      const pend = 1 - ny;
      if (pend > 0.12) tmp.lerp(C.tierra, clamp((pend - 0.12) * 4, 0, 0.9));
      if (g.interior && this.profTrinchera && Math.abs(this.profTrinchera[k]) > 0.15) tmp.lerp(C.barro, 0.85);
      const o = oscuro[k];
      if (o > 0) tmp.lerp(C.barro, Math.min(0.9, o)).multiplyScalar(1 - Math.min(0.55, o * 0.5));
      const v = 0.92 + n2 * 0.08;
      col[k * 3] = tmp.r * v; col[k * 3 + 1] = tmp.g * v; col[k * 3 + 2] = tmp.b * v;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  // Cráter: deforma la rejilla interior y oscurece el suelo.
  crater(x, z, r, prof, actualizar = true) {
    if (Math.abs(x) > this.ZONA - r - 2 || Math.abs(z) > this.ZONA - r - 2) return;
    const g = this.int;
    const R = r * 1.8;
    const [i0, i1, j0, j1] = this.estampar(x - R, z - R, x + R, z + R, (px, pz, k) => {
      const d = Math.hypot(px - x, pz - z);
      if (d < r) g.alt[k] -= prof * (1 - (d / r) ** 2);
      g.alt[k] += prof * 0.3 * Math.exp(-(((d - r) / (0.35 * r)) ** 2));
      if (d < R) g.oscuro[k] = Math.max(g.oscuro[k], (1 - d / R) * 1.2);
    });
    if (actualizar && g.geo) {
      this.actualizarRegion(g, i0 - 1, i1 + 1, j0 - 1, j1 + 1);
      // Las matas de hierba de la celda se regeneran
      for (const [key, celda] of this.hierba) {
        const [cx, cz] = key.split(',').map(Number);
        const S = this.calidad.celdaHierba;
        if (x + R > cx * S && x - R < (cx + 1) * S && z + R > cz * S && z - R < (cz + 1) * S) {
          this.scene.remove(celda); celda.dispose(); this.hierba.delete(key);
        }
      }
    }
  }

  // Altura exacta de la malla (misma triangulación que la geometría).
  getHeight(x, z) {
    const g = Math.abs(x) < this.ZONA - 0.001 && Math.abs(z) < this.ZONA - 0.001 ? this.int : this.ext;
    const fx = clamp((x - g.x0) / g.paso, 0, g.n - 0.0001), fz = clamp((z - g.x0) / g.paso, 0, g.n - 0.0001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const N1 = g.N1, a = g.alt;
    const h00 = a[j * N1 + i], h10 = a[j * N1 + i + 1], h01 = a[(j + 1) * N1 + i], h11 = a[(j + 1) * N1 + i + 1];
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

  getNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    out.set(this.getHeight(x - e, z) - this.getHeight(x + e, z), 2 * e, this.getHeight(x, z - e) - this.getHeight(x, z + e));
    return out.normalize();
  }

  // ---------------- Colisores ----------------
  addColisor(min, max, mat = 'ladrillo') {
    const c = { min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z }, mat };
    this.colisores.push(c);
    const S = 8;
    for (let gx = Math.floor(min.x / S); gx <= Math.floor(max.x / S); gx++)
      for (let gz = Math.floor(min.z / S); gz <= Math.floor(max.z / S); gz++) {
        const k = gx + ',' + gz;
        if (!this.rejilla.has(k)) this.rejilla.set(k, []);
        this.rejilla.get(k).push(c);
      }
    return c;
  }

  consultar(x0, z0, x1, z1, fn) {
    const S = 8, vistos = new Set();
    for (let gx = Math.floor(Math.min(x0, x1) / S); gx <= Math.floor(Math.max(x0, x1) / S); gx++)
      for (let gz = Math.floor(Math.min(z0, z1) / S); gz <= Math.floor(Math.max(z0, z1) / S); gz++) {
        const l = this.rejilla.get(gx + ',' + gz);
        if (l) for (const c of l) if (!vistos.has(c)) { vistos.add(c); fn(c); }
      }
  }

  arbolesCerca(x, z, r, fn) {
    const S = 8;
    for (let gx = Math.floor((x - r) / S); gx <= Math.floor((x + r) / S); gx++)
      for (let gz = Math.floor((z - r) / S); gz <= Math.floor((z + r) / S); gz++) {
        const l = this.rejillaArboles.get(gx + ',' + gz);
        if (l) for (const a of l) if (a.vivo) fn(a);
      }
  }

  // Empuja un círculo fuera de muros y troncos. yPies/alto definen la franja vertical del cuerpo.
  resolverCirculo(p, r, yPies, alto) {
    let choque = false;
    this.consultar(p.x - r, p.z - r, p.x + r, p.z + r, (c) => {
      if (yPies + alto < c.min.y || yPies + 0.35 > c.max.y) return; // se puede pasar por encima de lo bajo
      if (pushCircleAABB(p, r, c)) choque = true;
    });
    this.arbolesCerca(p.x, p.z, r + 1, (a) => {
      const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz), m = r + a.r;
      if (d < m && d > 1e-4) { p.x = a.x + (dx / d) * m; p.z = a.z + (dz / d) * m; choque = true; }
    });
    if (this.limites) { const Lm = this.limites; p.x = clamp(p.x, Lm.x0, Lm.x1); p.z = clamp(p.z, Lm.z0, Lm.z1); }
    else { const L = this.MAPA - 30; p.x = clamp(p.x, -L, L); p.z = clamp(p.z, -L, L); }
    return choque;
  }

  // Altura del suelo pisable (terreno o techo de colisores bajos como sacos o escombros).
  sueloEn(x, z, yActual) {
    let h = this.getHeight(x, z);
    this.consultar(x, z, x, z, (c) => {
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z && c.max.y <= yActual + 0.6 && c.max.y > h) h = c.max.y;
    });
    return h;
  }

  // Intersección de un segmento con terreno, colisores y troncos. Devuelve el impacto más cercano o null.
  segmento(a, b, paso = 1.0, sinArboles = false) {
    let mejor = null;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    // Colisores
    this.consultar(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), (c) => {
      const h = segAABB(a, b, c);
      if (h && (!mejor || h.t < mejor.t)) mejor = { t: h.t, n: new THREE.Vector3(h.nx, h.ny, h.nz), mat: c.mat };
    });
    // Troncos (cilindros aproximados por círculos en XZ)
    if (len < 400 && !sinArboles) {
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      this.arbolesCerca(mx, mz, len / 2 + 1, (t) => {
        const fx = a.x - t.x, fz = a.z - t.z;
        const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - t.r * t.r;
        const disc = B * B - 4 * A * C;
        if (disc < 0 || A < 1e-9) return;
        const tt = (-B - Math.sqrt(disc)) / (2 * A);
        if (tt < 0 || tt > 1) return;
        const y = a.y + dy * tt;
        if (y < t.y || y > t.y + t.alto) return;
        if (!mejor || tt < mejor.t) mejor = { t: tt, n: new THREE.Vector3(a.x + dx * tt - t.x, 0, a.z + dz * tt - t.z).normalize(), mat: 'madera' };
      });
    }
    // Terreno: avance por pasos y refinamiento por bisección
    const tMax = mejor ? mejor.t : 1;
    const pasos = Math.max(1, Math.ceil((len * tMax) / paso));
    let t0 = 0;
    for (let s = 1; s <= pasos; s++) {
      const t = (s / pasos) * tMax;
      const y = a.y + dy * t;
      if (y < this.getHeight(a.x + dx * t, a.z + dz * t)) {
        let lo = t0, hi = t;
        for (let it = 0; it < 6; it++) {
          const m = (lo + hi) / 2;
          if (a.y + dy * m < this.getHeight(a.x + dx * m, a.z + dz * m)) hi = m; else lo = m;
        }
        const px = a.x + dx * hi, pz = a.z + dz * hi;
        mejor = { t: hi, n: this.getNormal(px, pz), mat: 'tierra' };
        break;
      }
      t0 = t;
    }
    if (mejor) mejor.p = new THREE.Vector3(a.x + dx * mejor.t, a.y + dy * mejor.t, a.z + dz * mejor.t);
    return mejor;
  }

  lineaVision(a, b) { return !this.segmento(a, b, 2.5); }

  // ---------------- Vegetación ----------------
  crearArboles() {
    const r = this.rnd;
    const posiciones = [];
    const densidad = this.calidad.arboles;
    const tryPlace = (x, z, escala) => {
      if (Math.abs(x) > MAPA - 20 || Math.abs(z) > MAPA - 20) return;
      if (distCarreteras(x, z) < 5) return;
      if (Math.hypot(x - ALDEA.x, z - ALDEA.z) < 95 && r() < 0.85) return;
      if (Math.abs(x) < ZONA && Math.abs(z) < ZONA && this.cercaTrinchera(x, z, 3.5)) return;
      posiciones.push([x, z, escala]);
    };
    // Cinturones forestales en los bordes de los campos
    for (let k = 0; k <= 8; k++) {
      const x = ORIGEN + k * CELDA_X;
      for (let z = -MAPA; z < MAPA; z += 5.2 / densidad) {
        if (noise2(x * 0.01, z * 0.012) < -0.35) continue;
        tryPlace(x + (r() - 0.5) * 3, z + (r() - 0.5) * 2, 0.8 + r() * 0.5);
      }
    }
    for (let k = 0; k <= 9; k++) {
      const z = ORIGEN + k * CELDA_Z;
      for (let x = -MAPA; x < MAPA; x += 5.2 / densidad) {
        if (noise2(x * 0.012, z * 0.01) < -0.35) continue;
        tryPlace(x + (r() - 0.5) * 2, z + (r() - 0.5) * 3, 0.8 + r() * 0.5);
      }
    }
    // Huertos y árboles sueltos en la aldea
    for (let k = 0; k < 120; k++) {
      const a = r() * Math.PI * 2, d = 30 + r() * 90;
      tryPlace(ALDEA.x + Math.cos(a) * d, ALDEA.z + Math.sin(a) * d, 0.6 + r() * 0.4);
    }

    this.instanciarArboles(posiciones, (x) => r() < 0.22 || (Math.abs(x) < 170 && r() < 0.3));
  }

  // posiciones: [[x, z, escala], ...]; muertoFn(x, z) decide si el árbol está destrozado
  instanciarArboles(posiciones, muertoFn = () => false) {
    const r = this.rnd;
    const geoTronco = new THREE.CylinderGeometry(0.12, 0.22, 1, 6, 1).translate(0, 0.5, 0);
    // Copa: tarjetas de hojas con alfa, normales esféricas para simular volumen
    const tarjetas = [];
    const rc = mulberry32(31);
    for (let k = 0; k < 11; k++) {
      const s = 0.9 + rc() * 0.7;
      const g = new THREE.PlaneGeometry(1.6 * s, 1.6 * s);
      g.rotateX((rc() - 0.5) * Math.PI); g.rotateY(rc() * Math.PI); g.rotateZ((rc() - 0.5) * 0.8);
      g.translate((rc() - 0.5) * 1.0, (rc() - 0.5) * 0.8, (rc() - 0.5) * 1.0);
      tarjetas.push(g.toNonIndexed());
    }
    const copa = mergeGeometries(tarjetas);
    const pc = copa.attributes.position, nc0 = copa.attributes.normal;
    for (let i = 0; i < pc.count; i++) {
      const v = new THREE.Vector3(pc.getX(i), pc.getY(i) + 0.3, pc.getZ(i)).normalize();
      nc0.setXYZ(i, v.x, v.y, v.z);
    }
    // Ramas secas para árboles destrozados
    const ramas = [];
    for (let k = 0; k < 5; k++) {
      const g = new THREE.CylinderGeometry(0.03, 0.06, 1.4, 4).translate(0, 0.7, 0);
      g.rotateZ((k % 2 ? 1 : -1) * (0.5 + k * 0.12));
      g.rotateY(k * 1.3);
      g.translate(0, 0.55 + k * 0.08, 0);
      ramas.push(g.toNonIndexed());
    }
    const geoRamas = mergeGeometries(ramas);

    const matTronco = new THREE.MeshStandardMaterial({ map: TX.texCorteza(), roughness: 0.95 });
    const matCopa = new THREE.MeshStandardMaterial({ map: TX.texHojas(), roughness: 0.9, alphaTest: 0.5, side: THREE.DoubleSide });
    matCopa.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
    };
    const nT = posiciones.length;
    const troncos = new THREE.InstancedMesh(geoTronco, matTronco, nT);
    const copas = new THREE.InstancedMesh(copa, matCopa, nT);
    const secos = new THREE.InstancedMesh(geoRamas, matTronco, nT);
    let nc = 0, ns = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const cA = new THREE.Color('#8f8a4c'), cB = new THREE.Color('#6a6d3a'), cC = new THREE.Color('#a77d3c'), tmp = new THREE.Color();
    posiciones.forEach(([x, z, esc], i) => {
      const y = this.getHeight(x, z) - 0.1;
      const muerto = muertoFn(x, z);
      const alto = (muerto ? 3 + r() * 4 : 6 + r() * 5) * esc;
      e.set((r() - 0.5) * 0.08, r() * 6.28, (r() - 0.5) * 0.08);
      q.setFromEuler(e);
      m.compose(p.set(x, y, z), q, s.set(esc * (0.9 + r() * 0.4), alto, esc * (0.9 + r() * 0.4)));
      troncos.setMatrixAt(i, m);
      const arbol = { x, z, y, r: 0.22 * esc, alto, vivo: true, i, iCopa: -1, iSeco: -1, q: q.clone(), esc, muerto };
      if (!muerto) {
        const rc = (1.9 + r() * 1.3) * esc;
        m.compose(p.set(x, y + alto * 0.78, z), q, s.set(rc, rc * (1.1 + r() * 0.4), rc));
        copas.setMatrixAt(nc, m);
        tmp.copy(cA).lerp(r() < 0.5 ? cB : cC, r());
        copas.setColorAt(nc, tmp);
        arbol.iCopa = nc++;
        arbol.rc = rc;
      } else {
        m.compose(p.set(x, y + alto * 0.55, z), q, s.set(esc * 1.5, esc * 2.2, esc * 1.5));
        secos.setMatrixAt(ns, m);
        arbol.iSeco = ns++;
      }
      this.arboles.push(arbol);
      if (Math.abs(x) < this.ZONA + 40 && Math.abs(z) < this.ZONA + 40) {
        const k = Math.floor(x / 8) + ',' + Math.floor(z / 8);
        if (!this.rejillaArboles.has(k)) this.rejillaArboles.set(k, []);
        this.rejillaArboles.get(k).push(arbol);
      }
    });
    copas.count = nc; secos.count = ns;
    for (const im of [troncos, copas, secos]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.scene.add(im); }
    this.imTroncos = troncos; this.imCopas = copas; this.imSecos = secos;
  }

  // Un vehículo derriba un árbol en la dirección (dx,dz).
  derribarArbol(a, dx, dz) {
    if (!a.vivo) return;
    a.vivo = false;
    const eje = new THREE.Vector3(dz, 0, -dx).normalize();
    const caida = new THREE.Quaternion().setFromAxisAngle(eje, -1.45);
    const q = caida.multiply(a.q);
    const m = new THREE.Matrix4();
    const tr = new THREE.Matrix4();
    this.imTroncos.getMatrixAt(a.i, tr);
    const s = new THREE.Vector3(), p = new THREE.Vector3(), qq = new THREE.Quaternion();
    tr.decompose(p, qq, s);
    m.compose(p, q, s);
    this.imTroncos.setMatrixAt(a.i, m);
    this.imTroncos.instanceMatrix.needsUpdate = true;
    const off = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (a.iCopa >= 0) {
      this.imCopas.getMatrixAt(a.iCopa, tr); tr.decompose(p, qq, s);
      m.compose(new THREE.Vector3(a.x, a.y + 0.8, a.z).addScaledVector(off, a.alto * 0.78), q, s);
      this.imCopas.setMatrixAt(a.iCopa, m);
      this.imCopas.instanceMatrix.needsUpdate = true;
    }
    if (a.iSeco >= 0) {
      this.imSecos.getMatrixAt(a.iSeco, tr); tr.decompose(p, qq, s);
      m.compose(new THREE.Vector3(a.x, a.y + 0.5, a.z).addScaledVector(off, a.alto * 0.55), q, s);
      this.imSecos.setMatrixAt(a.iSeco, m);
      this.imSecos.instanceMatrix.needsUpdate = true;
    }
  }

  cercaTrinchera(x, z, d) {
    if (!this.segTrinchera) return false;
    for (const [ax, az, bx, bz] of this.segTrinchera) if (distSeg(x, z, ax, az, bx, bz) < d) return true;
    return false;
  }

  crearMaterialHierba() {
    const mat = new THREE.MeshStandardMaterial({ map: TX.texHierba(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTiempo = { value: 0 };
      // Normales siempre hacia arriba también en la cara trasera (si no, la hierba sale negra)
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
      sh.vertexShader = 'uniform float uTiempo;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
         float fase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
         float viento = sin(uTiempo * 1.6 + fase) * 0.6 + sin(uTiempo * 3.7 + fase * 2.0) * 0.25;
         transformed.x += viento * 0.12 * uv.y * uv.y;
         transformed.z += viento * 0.05 * uv.y * uv.y;
         #endif`);
      mat.userData.shader = sh;
    };
    this.matHierba = mat;
    // Mata: 3 planos cruzados con normales verticales
    const planos = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.PlaneGeometry(1, 0.8).translate(0, 0.4, 0).rotateY((k * Math.PI) / 3);
      planos.push(g.toNonIndexed());
    }
    const g = mergeGeometries(planos);
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    this.geoHierba = g;
  }

  celdaHierba(cx, cz) {
    const S = this.calidad.celdaHierba;
    const r = mulberry32((cx * 73856093) ^ (cz * 19349663));
    const dens = this.calidad.densidadHierba;
    const n = Math.floor(S * S * dens);
    const im = new THREE.InstancedMesh(this.geoHierba, this.matHierba, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    const seco = new THREE.Color('#d8c690'), verde = new THREE.Color('#8f9a5c');
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = (cx + r()) * S, z = (cz + r()) * S;
      let info = null, tipo = 3;
      if (this.infoHierba) { info = this.infoHierba(x, z, r); if (!info) continue; }
      else {
        tipo = tipoCampo(x, z);
        if (tipo === 0 && r() < 0.8) continue;
        if (distCarreteras(x, z) < 3.8) continue;
      }
      if (Math.abs(x) < this.ZONA && Math.abs(z) < this.ZONA) {
        const g = this.int;
        const ii = Math.round((x - g.x0) / g.paso), jj = Math.round((z - g.x0) / g.paso);
        const idx = jj * g.N1 + ii;
        if (Math.abs(this.profTrinchera[idx]) > 0.3 || g.oscuro[idx] > 0.5) continue;
      }
      let dentro = false;
      this.consultar(x, z, x, z, (col) => { if (x > col.min.x && x < col.max.x && z > col.min.z && z < col.max.z) dentro = true; });
      if (dentro) continue;
      const alto = info ? info.alto * (0.7 + r() * 0.6) : tipo === 3 ? 0.8 + r() * 0.9 : tipo === 1 ? 0.45 + r() * 0.3 : 0.6 + r() * 0.6;
      const ancho = 0.7 + r() * 0.7;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * 6.28);
      m.compose(p.set(x, this.getHeight(x, z) - 0.05, z), q, s.set(ancho, alto, ancho));
      im.setMatrixAt(k, m);
      c.copy(seco).lerp(verde, info ? info.verde * (0.6 + r() * 0.4) : tipo === 3 ? r() * 0.8 : r() * 0.3);
      im.setColorAt(k, c);
      k++;
    }
    im.count = k;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.frustumCulled = true;
    return im;
  }

  // ---------------- Edificios ----------------
  crearAldea() {
    const r = mulberry32(77);
    const geosMuro = [], geosTecho = [], geosSuelo = [], escombros = [];
    const colores = ['#e9e4d6', '#d6dfe2', '#e8dcae', '#cfd8c4', '#e3d3c3'].map((c) => new THREE.Color(c));
    const hollin = new THREE.Color('#3a3530');
    const casas = [];
    // Casas a lo largo de las carreteras dentro de la aldea
    for (let x = ALDEA.x - 105; x <= ALDEA.x + 105; x += 19 + r() * 6) {
      for (const lado of [-1, 1]) {
        if (r() < 0.15) continue;
        const z = carreteraZ(x) + lado * (14 + r() * 5);
        casas.push([x, z, lado > 0 ? 2 : 0]);
      }
    }
    for (let z = -110; z <= 110; z += 20 + r() * 6) {
      for (const lado of [-1, 1]) {
        if (r() < 0.2 || Math.abs(z - carreteraZ(carreteraX(z))) < 20) continue;
        casas.push([carreteraX(z) + lado * (14 + r() * 4), z, lado > 0 ? 1 : 3]);
      }
    }
    const libres = (x, z, w, d) => {
      let ok = true;
      this.consultar(x - w, z - d, x + w, z + d, (c) => {
        if (c.max.x > x - w / 2 - 2 && c.min.x < x + w / 2 + 2 && c.max.z > z - d / 2 - 2 && c.min.z < z + d / 2 + 2) ok = false;
      });
      return ok;
    };
    for (const [x, z, rot] of casas) {
      const w = 7 + r() * 3, d = 8 + r() * 3;
      const ww = rot % 2 ? d : w, dd = rot % 2 ? w : d;
      if (!libres(x, z, ww, dd) || this.cercaTrinchera(x, z, 9)) continue;
      const danio = r();
      const quemada = r() < 0.35;
      const col = quemada ? hollin.clone().lerp(colores[0], 0.3) : colores[Math.floor(r() * colores.length)];
      this.casa(x, z, rot, w, d, danio, col, r, geosMuro, geosTecho, geosSuelo, escombros);
      if (quemada && r() < 0.5) this.fuegos.push(new THREE.Vector3(x, this.getHeight(x, z) + 2, z));
    }
    const matMuro = new THREE.MeshStandardMaterial({ map: TX.texLadrillo(), vertexColors: true, roughness: 0.92 });
    const matTecho = new THREE.MeshStandardMaterial({ color: '#7d7f7a', roughness: 0.8, metalness: 0.1, map: TX.texHormigon() });
    const matSuelo = new THREE.MeshStandardMaterial({ map: TX.texMadera(), roughness: 0.9 });
    for (const [geos, mat] of [[geosMuro, matMuro], [geosTecho, matTecho], [geosSuelo, matSuelo]]) {
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(fusionar(geos), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    // Escombros: ladrillos instanciados
    const geoL = new THREE.BoxGeometry(0.25, 0.08, 0.12);
    const im = new THREE.InstancedMesh(geoL, new THREE.MeshStandardMaterial({ color: '#8a5a44', roughness: 0.95 }), escombros.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    escombros.forEach(([x, z, k], i) => {
      e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, this.getHeight(x, z) + 0.04 + r() * 0.1 * k, z), q, new THREE.Vector3(1 + k, 1 + k * 2, 1 + k));
      im.setMatrixAt(i, m);
    });
    im.castShadow = im.receiveShadow = true;
    this.scene.add(im);
  }

  casa(cx, cz, rot, w, d, danio, color, r, gM, gT, gS, escombros) {
    const H = 2.9, t = 0.35;
    const ys = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([a, b]) => {
      const [x, z] = rotar(a, b, rot); return this.getHeight(cx + x, cz + z);
    });
    const y0 = Math.max(...ys) + 0.15;
    const yMin = Math.min(...ys) - 0.3;
    const grupo = new THREE.Matrix4().makeRotationY((rot * Math.PI) / 2).setPosition(cx, 0, cz);
    const pieza = (lx, ly, lz, sw, sh, sd, lista, colr, mat = 'ladrillo', colisor = true, ts = 2) => {
      const g = cajaGeo(sw, sh, sd, ts).translate(lx, ly, lz).applyMatrix4(grupo);
      conColor(g, colr);
      lista.push(g);
      if (colisor) {
        g.computeBoundingBox();
        this.addColisor(g.boundingBox.min, g.boundingBox.max, mat);
      }
    };
    // Zócalo hasta el terreno
    pieza(0, (yMin + y0) / 2, 0, w, y0 - yMin, d, gM, color.clone().multiplyScalar(0.7), 'hormigon', true);
    pieza(0, y0 + 0.02, 0, w - 2 * t, 0.06, d - 2 * t, gS, new THREE.Color(1, 1, 1), 'madera', false);
    // Muros con aberturas
    const muros = [
      { L: w, pos: (s) => [s, d / 2 - t / 2], eje: 'x', huecos: [[0, 1.0, 0, 2.1], [-w / 3, 1.2, 0.9, 2.1], [w / 3, 1.2, 0.9, 2.1]] },
      { L: w, pos: (s) => [s, -d / 2 + t / 2], eje: 'x', huecos: [[-w / 4, 1.2, 0.9, 2.1], [w / 4, 1.2, 0.9, 2.1]] },
      { L: d - 2 * t, pos: (s) => [-w / 2 + t / 2, s], eje: 'z', huecos: [[0, 1.2, 0.9, 2.1]] },
      { L: d - 2 * t, pos: (s) => [w / 2 - t / 2, s], eje: 'z', huecos: [[r() < 0.5 ? -0.8 : 0.8, 1.0, 0, 2.1]] },
    ];
    for (const muro of muros) {
      const huecos = muro.huecos.map((h) => [...h]);
      // Brechas de impactos
      if (r() < danio * 0.9) {
        const c = (r() - 0.5) * muro.L * 0.6, an = 1.4 + r() * 2;
        huecos.push([c, an, r() < 0.5 ? 0 : 0.3 + r() * 0.6, H - r() * 0.8]);
        for (let k = 0; k < 25; k++) {
          const [px, pz] = muro.pos(c + (r() - 0.5) * an * 1.5);
          const [ox, oz] = muro.eje === 'x' ? [px, pz + (r() - 0.5) * 3] : [px + (r() - 0.5) * 3, pz];
          const [wx, wz] = rotar(ox, oz, rot);
          escombros.push([cx + wx, cz + wz, r() < 0.15 ? 1 : 0]);
        }
      }
      huecos.sort((a, b) => a[0] - b[0]);
      // Fusionar huecos solapados
      const hs = [];
      for (const h of huecos) {
        const a0 = h[0] - h[1] / 2, a1 = h[0] + h[1] / 2;
        const prev = hs[hs.length - 1];
        if (prev && a0 < prev.b) { prev.b = Math.max(prev.b, a1); prev.sill = Math.min(prev.sill, h[2]); prev.top = Math.max(prev.top, h[3]); }
        else hs.push({ a: Math.max(-muro.L / 2 + 0.3, a0), b: Math.min(muro.L / 2 - 0.3, a1), sill: h[2], top: h[3] });
      }
      let cursor = -muro.L / 2;
      const alturaMuro = H - (r() < danio * 0.5 ? r() * 1.2 : 0);
      const tramo = (s0, s1, yb, yt) => {
        if (s1 - s0 < 0.05 || yt - yb < 0.05) return;
        const sc = (s0 + s1) / 2, [px, pz] = muro.pos(sc);
        const [sw, sd] = muro.eje === 'x' ? [s1 - s0, t] : [t, s1 - s0];
        pieza(px, y0 + (yb + yt) / 2, pz, sw, yt - yb, sd, gM, color);
      };
      for (const h of hs) {
        tramo(cursor, h.a, 0, alturaMuro);
        if (h.sill > 0) tramo(h.a, h.b, 0, h.sill);
        if (h.top < alturaMuro) tramo(h.a, h.b, h.top, alturaMuro);
        cursor = h.b;
      }
      tramo(cursor, muro.L / 2, 0, alturaMuro);
    }
    // Tejado a dos aguas sobre el lado largo (eje x local)
    const rid = 1.7, voladizo = 0.4;
    const semi = d / 2 + voladizo;
    const ang = Math.atan2(rid, d / 2);
    const largo = Math.hypot(semi, rid * (semi / (d / 2)));
    for (const lado of [-1, 1]) {
      for (let seg = 0; seg < 3; seg++) {
        if (r() < danio * 0.55) continue;
        const sw = (w + voladizo * 2) / 3;
        const sx = -w / 2 - voladizo + sw * (seg + 0.5);
        const g = cajaGeo(sw, 0.06, largo, 1.5);
        g.rotateX(lado * ang);
        g.translate(sx, y0 + H + rid / 2 - 0.02, lado * (d / 4 + voladizo / 4) - lado * 0.05);
        g.applyMatrix4(grupo);
        conColor(g, new THREE.Color(1, 1, 1));
        gT.push(g);
      }
    }
    // Hastiales triangulares
    for (const lado of [-1, 1]) {
      if (r() < danio * 0.4) continue;
      const sh = new THREE.Shape();
      sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(0, rid); sh.lineTo(-d / 2, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      g.translate(lado * (w / 2) - (lado > 0 ? t : 0), y0 + H, 0);
      g.applyMatrix4(grupo);
      conColor(g, color);
      gM.push(g);
    }
  }

  crearBloque() {
    // Bloque de viviendas de 5 plantas parcialmente derrumbado
    const x0 = 55, z0 = -75, y = this.getHeight(x0, z0) - 0.5;
    const tex = TX.texFachada();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const geos = [];
    const piezas = [[-30, 8, 15], [8, 22, 8.5], [22, 30, 15]]; // [x desde, x hasta, altura]
    for (const [a, b, h] of piezas) {
      const g = cajaGeo(b - a, h, 12, 12).translate(x0 + (a + b) / 2, y + h / 2, z0);
      geos.push(g);
      this.addColisor({ x: x0 + a, y: y, z: z0 - 6 }, { x: x0 + b, y: y + h, z: z0 + 6 }, 'hormigon');
    }
    // Losas colgando del derrumbe
    const losa = cajaGeo(7, 0.25, 11, 12);
    losa.rotateZ(0.5).translate(x0 + 12, y + 10.5, z0);
    geos.push(losa);
    const mesh = new THREE.Mesh(fusionar(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    // Montón de escombros
    const esc = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ map: TX.texHormigon(), roughness: 1, color: '#9a9690' }));
    const p = esc.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + noise2(p.getX(i) * 3, p.getZ(i) * 3) * 0.3;
      p.setXYZ(i, p.getX(i) * k, Math.max(0, p.getY(i)) * k, p.getZ(i) * k);
    }
    esc.geometry.computeVertexNormals();
    esc.scale.set(9, 4, 9);
    esc.position.set(x0 + 15, y, z0 + 4);
    esc.castShadow = esc.receiveShadow = true;
    this.scene.add(esc);
    this.addColisor({ x: x0 + 9, y, z: z0 - 4 }, { x: x0 + 21, y: y + 2.2, z: z0 + 11 }, 'hormigon');
    this.fuegos.push(new THREE.Vector3(x0 + 15, y + 9, z0));
  }

  crearElevador() {
    const x0 = -95, z0 = 85, y = this.getHeight(x0, z0) - 0.5;
    const mat = new THREE.MeshStandardMaterial({ map: TX.texHormigon(), roughness: 0.9, color: '#b8b4aa' });
    const geos = [];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.CylinderGeometry(4, 4, 26, 20).translate(x0 + k * 8.2, y + 13, z0);
      geos.push(g);
      this.addColisor({ x: x0 + k * 8.2 - 3.6, y, z: z0 - 3.6 }, { x: x0 + k * 8.2 + 3.6, y: y + 26, z: z0 + 3.6 }, 'hormigon');
    }
    geos.push(cajaGeo(7, 36, 8, 4).translate(x0 - 8, y + 18, z0));
    this.addColisor({ x: x0 - 11.5, y, z: z0 - 4 }, { x: x0 - 4.5, y: y + 36, z: z0 + 4 }, 'hormigon');
    geos.push(cajaGeo(34, 3, 5, 4).translate(x0 + 12, y + 27.5, z0));
    const mesh = new THREE.Mesh(fusionar(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  crearTrincherasMalla() {
    // Revestimiento de tablones y sacos terreros a lo largo de las trincheras
    const tablas = [], sacos = [];
    for (const [ax, az, bx, bz] of this.segTrinchera) {
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      const nx = -uz, nz = ux;
      for (let s = 0.2; s < L; s += 0.32) {
        for (const lado of [-1, 1]) {
          const x = ax + ux * s + nx * lado * 1.0, z = az + uz * s + nz * lado * 1.0;
          tablas.push([x, z, Math.atan2(ux, uz)]);
        }
      }
      for (let s = 0.5; s < L; s += 0.7) {
        const x = ax + ux * s + nx * 1.9, z = az + uz * s + nz * 1.9;
        if (Math.abs(ax) > 100) sacos.push([x, z, Math.atan2(ux, uz)]);
      }
    }
    const matM = new THREE.MeshStandardMaterial({ map: TX.texMadera(), roughness: 0.95, color: '#a09080' });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 2.2, 0.05), matM, tablas.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    tablas.forEach(([x, z, a], i) => {
      const h = this.getHeight(x, z);
      const fondo = Math.min(h, this.alturaFondo(x, z));
      e.set((Math.random() - 0.5) * 0.06, a, (Math.random() - 0.5) * 0.04); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, fondo + 1.05, z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
    });
    im.castShadow = im.receiveShadow = true;
    this.scene.add(im);
    const imS = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.4, 2, 6).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: TX.texSaco(), roughness: 1 }), sacos.length * 2);
    let k = 0;
    sacos.forEach(([x, z, a]) => {
      for (let capa = 0; capa < 2; capa++) {
        e.set(0, a + Math.PI / 2, 0); q.setFromEuler(e);
        m.compose(new THREE.Vector3(x, this.getHeight(x, z) + 0.12 + capa * 0.28, z), q, new THREE.Vector3(1, 0.8, 1));
        imS.setMatrixAt(k++, m);
      }
    });
    imS.castShadow = imS.receiveShadow = true;
    this.scene.add(imS);
  }

  alturaFondo(x, z) {
    let mn = Infinity;
    for (const dx of [-1.2, 0, 1.2]) for (const dz of [-1.2, 0, 1.2]) mn = Math.min(mn, this.getHeight(x + dx, z + dz));
    return mn;
  }

  crearObstaculos() {
    const r = mulberry32(55);
    // Dientes de dragón (pirámides de hormigón) delante de las trincheras
    const dientes = [];
    for (const lado of [-1, 1]) for (let z = -200; z <= 200; z += 2.6) {
      if (r() < 0.12) continue;
      dientes.push([lado * 128 + (r() - 0.5) * 1.5, z + (r() - 0.5)]);
      if (r() < 0.5) dientes.push([lado * 125 + (r() - 0.5) * 1.5, z + 1.3]);
    }
    const geoD = new THREE.ConeGeometry(0.75, 1.1, 4, 1).translate(0, 0.55, 0);
    const imD = new THREE.InstancedMesh(geoD, new THREE.MeshStandardMaterial({ map: TX.texHormigon(), roughness: 0.95, color: '#c0bcb2' }), dientes.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    dientes.forEach(([x, z], i) => {
      const y = this.getHeight(x, z) - 0.1;
      e.set((r() - 0.5) * 0.15, Math.PI / 4 + (r() - 0.5) * 0.3, (r() - 0.5) * 0.15); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      imD.setMatrixAt(i, m);
      this.addColisor({ x: x - 0.45, y, z: z - 0.45 }, { x: x + 0.45, y: y + 1.0, z: z + 0.45 }, 'hormigon');
    });
    imD.castShadow = imD.receiveShadow = true;
    this.scene.add(imD);
    // Erizos checos en la carretera
    const erizos = [];
    for (const x of [-120, -118, -116, 116, 118, 121]) erizos.push([x, carreteraZ(x) + (r() - 0.5) * 5]);
    for (let k = 0; k < 14; k++) erizos.push([(r() - 0.5) * 260, (r() - 0.5) * 380]);
    const vigas = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.BoxGeometry(0.14, 1.9, 0.14);
      if (k === 0) g.rotateZ(Math.PI / 2 - 0.6);
      if (k === 1) g.rotateX(Math.PI / 2 - 0.6);
      if (k === 2) g.rotateZ(-0.6).rotateY(Math.PI / 2);
      vigas.push(g.toNonIndexed());
    }
    const geoE = mergeGeometries(vigas).translate(0, 0.75, 0);
    const imE = new THREE.InstancedMesh(geoE, new THREE.MeshStandardMaterial({ map: TX.texBlindaje('#4a3a2e', 'oxido'), roughness: 0.7, metalness: 0.6 }), erizos.length);
    erizos.forEach(([x, z], i) => {
      const y = this.getHeight(x, z);
      e.set(0, r() * 6, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      imE.setMatrixAt(i, m);
      this.addColisor({ x: x - 0.7, y, z: z - 0.7 }, { x: x + 0.7, y: y + 1.4, z: z + 0.7 }, 'metal');
    });
    imE.castShadow = imE.receiveShadow = true;
    this.scene.add(imE);
    // Coches calcinados
    const matQ = new THREE.MeshStandardMaterial({ map: TX.texBlindaje('#3a2c24', 'quemado'), roughness: 0.8, metalness: 0.5 });
    const coche = fusionar([
      cajaGeo(1.75, 0.7, 4.2).translate(0, 0.65, 0),
      cajaGeo(1.6, 0.55, 2.0).translate(0, 1.25, -0.2),
      new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8).rotateZ(Math.PI / 2).translate(0, 0.3, 1.3),
      new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8).rotateZ(Math.PI / 2).translate(0, 0.3, -1.3),
    ]);
    for (let k = 0; k < 9; k++) {
      const x = (r() - 0.5) * 300, z = carreteraZ(x) + (r() - 0.5) * 9;
      const c = new THREE.Mesh(coche, matQ);
      const y = this.getHeight(x, z);
      c.position.set(x, y - 0.15, z);
      c.rotation.set((r() - 0.5) * 0.2, r() * 6, (r() - 0.5) * 0.3);
      c.castShadow = c.receiveShadow = true;
      this.scene.add(c);
      this.addColisor({ x: x - 1.8, y, z: z - 1.8 }, { x: x + 1.8, y: y + 1.5, z: z + 1.8 }, 'metal');
    }
  }

  crearPostes() {
    // Tendido eléctrico de madera a lo largo de la carretera principal, con postes caídos
    const r = mulberry32(99);
    const geoP = new THREE.CylinderGeometry(0.11, 0.14, 8, 6).translate(0, 4, 0);
    const geoC = new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, 7.5, 0);
    const poste = fusionar([geoP, geoC]);
    const mat = new THREE.MeshStandardMaterial({ map: TX.texCorteza(), color: '#8a7a68', roughness: 0.95 });
    const puntos = [];
    const posts = [];
    for (let x = -1100; x <= 1100; x += 45) {
      const z = carreteraZ(x) - 8;
      if (Math.hypot(x - ALDEA.x, z - ALDEA.z) < 30) continue;
      const caido = r() < 0.18;
      const y = this.getHeight(x, z);
      posts.push([x, y, z, caido]);
      if (!caido) puntos.push(new THREE.Vector3(x, y + 7.5, z)); else puntos.push(null);
    }
    const im = new THREE.InstancedMesh(poste, mat, posts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    posts.forEach(([x, y, z, caido], i) => {
      e.set(caido ? 1.3 + r() * 0.2 : (r() - 0.5) * 0.05, r() * 0.3, caido ? 0 : (r() - 0.5) * 0.06); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y - 0.2, z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
      if (Math.abs(x) < ZONA) this.addColisor({ x: x - 0.2, y, z: z - 0.2 }, { x: x + 0.2, y: y + 8, z: z + 0.2 }, 'madera');
    });
    im.castShadow = true;
    this.scene.add(im);
    // Cables con catenaria
    const verts = [];
    for (let k = 0; k < puntos.length - 1; k++) {
      const a = puntos[k], b = puntos[k + 1];
      if (!a) continue;
      for (const off of [-0.7, 0.7]) {
        const fin = b ? b.clone() : a.clone().add(new THREE.Vector3(30, -7, 3));
        let prev = null;
        for (let s = 0; s <= 10; s++) {
          const t = s / 10;
          const p = a.clone().lerp(fin, t);
          p.z += off;
          p.y -= Math.sin(t * Math.PI) * (b ? 1.6 : 0.5);
          if (prev) verts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
          prev = p;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1d1d1b', transparent: true, opacity: 0.7 })));
  }

  crearBases() {
    // Posiciones de base: x negativa Ucrania (UA), positiva Rusia (RU)
    this.bases = {};
    const matS = new THREE.MeshStandardMaterial({ map: TX.texSaco(), roughness: 1 });
    const geoS = new THREE.CapsuleGeometry(0.2, 0.45, 2, 6).rotateZ(Math.PI / 2);
    const sacos = [];
    for (const [fac, lado] of [['UA', -1], ['RU', 1]]) {
      const bx = lado * 255;
      const spawns = [];
      for (let k = 0; k < 6; k++) spawns.push(new THREE.Vector3(bx + (k % 2) * 6 * lado, 0, -25 + k * 10));
      for (const s of spawns) s.y = this.getHeight(s.x, s.z);
      const vehiculos = [
        { tipo: 'tanque', x: bx - lado * 12, z: 55 },
        { tipo: 'mtlb', x: bx - lado * 14, z: -50 },
        { tipo: 'tecnica', x: bx - lado * 20, z: carreteraZ(bx - lado * 20) + 5 },
      ];
      const aeronaves = [{ tipo: 'heli', x: bx + lado * 38, z: -75 }, { tipo: 'avion', x: bx + lado * 40, z: 95 }];
      this.bases[fac] = { spawns, vehiculos, aeronaves, x: bx, yaw: lado < 0 ? -Math.PI / 2 : Math.PI / 2 };
      // Muro de sacos en U frente a la base
      for (let z = -40; z <= 40; z += 0.75) {
        if (Math.abs(z) < 5) continue;
        const x = bx - lado * 30;
        for (let capa = 0; capa < 3; capa++) sacos.push([x, z + (capa % 2) * 0.35, 0]);
      }
      // Cajas de munición
      const matC = new THREE.MeshStandardMaterial({ map: TX.texMadera(), color: '#6d7a52', roughness: 0.9 });
      for (let k = 0; k < 8; k++) {
        const x = bx + lado * (4 + (k % 4) * 0.9), z = 40 + Math.floor(k / 4) * 0.6;
        const c = new THREE.Mesh(cajaGeo(0.8, 0.45, 0.5, 1), matC);
        c.position.set(x, this.getHeight(x, z) + 0.22, z);
        c.rotation.y = k * 0.1;
        c.castShadow = c.receiveShadow = true;
        this.scene.add(c);
      }
    }
    const im = new THREE.InstancedMesh(geoS, matS, sacos.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    sacos.forEach(([x, z], i) => {
      const capa = i % 3;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2 + (Math.random() - 0.5) * 0.2);
      m.compose(new THREE.Vector3(x, this.getHeight(x, z) + 0.14 + capa * 0.3, z), q, new THREE.Vector3(1, 0.8, 1));
      im.setMatrixAt(i, m);
      if (capa === 0) this.addColisor({ x: x - 0.25, y: this.getHeight(x, z), z: z - 0.4 }, { x: x + 0.25, y: this.getHeight(x, z) + 0.95, z: z + 0.4 }, 'tierra');
    });
    im.castShadow = im.receiveShadow = true;
    this.scene.add(im);
  }

  // ---------------- Actualización ----------------
  update(dt, foco) {
    this.tiempo += dt;
    this.matCielo.uniforms.uTiempo.value = this.tiempo;
    this.cielo.position.copy(foco);
    if (this.matHierba.userData.shader) this.matHierba.userData.shader.uniforms.uTiempo.value = this.tiempo;
    // Sombra que sigue al foco, ajustada a la rejilla de texeles para evitar parpadeo
    const R = this.calidad.radioSombra, texel = (2 * R) / this.calidad.sombra;
    const fx = Math.round(foco.x / texel) * texel, fz = Math.round(foco.z / texel) * texel;
    this.luzSol.target.position.set(fx, foco.y, fz);
    this.luzSol.position.set(fx + this.sol.x * 200, foco.y + this.sol.y * 200, fz + this.sol.z * 200);
    // Hierba en celdas alrededor del foco
    const S = this.calidad.celdaHierba, rad = this.calidad.radioHierba;
    if (rad > 0) {
      const cx0 = Math.floor(foco.x / S), cz0 = Math.floor(foco.z / S), nC = Math.ceil(rad / S);
      const usados = new Set();
      let creadas = 0;
      for (let dz = -nC; dz <= nC; dz++) for (let dx = -nC; dx <= nC; dx++) {
        const cx = cx0 + dx, cz = cz0 + dz;
        const ccx = (cx + 0.5) * S, ccz = (cz + 0.5) * S;
        if (Math.hypot(ccx - foco.x, ccz - foco.z) > rad + S * 0.7) continue;
        const k = cx + ',' + cz;
        usados.add(k);
        if (!this.hierba.has(k)) {
          if (creadas > 2) continue; // repartir el coste entre fotogramas
          const c = this.celdaHierba(cx, cz);
          this.hierba.set(k, c);
          this.scene.add(c);
          creadas++;
        }
        this.hierba.get(k).visible = true;
      }
      for (const [k, c] of this.hierba) {
        if (!usados.has(k)) {
          c.visible = false;
          const [cx, cz] = k.split(',').map(Number);
          if (Math.hypot((cx + 0.5) * S - foco.x, (cz + 0.5) * S - foco.z) > rad * 2.5) { this.scene.remove(c); c.dispose(); this.hierba.delete(k); }
        }
      }
    }
  }
}

function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function rotar(x, z, rot) {
  const a = (rot * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}
export { carreteraZ };
