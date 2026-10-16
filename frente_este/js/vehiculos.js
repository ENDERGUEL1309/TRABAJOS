// Vehículos: tanque (T-64BV / T-72B3), tanqueta MT-LB y camioneta con ZU-23-2.
// Física de orugas diferencial, modelo de bicicleta para ruedas, torreta estabilizada y daños.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './texturas.js';
import { clamp, damp, dampAngle, moveTowards, moveAngleTowards, wrapAngle, segOBB, pushCircleAABB } from './util.js';

export const TIPOS = {
  tanque: {
    nombre: { UA: 'T-64BV', RU: 'T-72B3' }, oruga: true, vmax: 16, vmaxAtras: 5, acel: 3.2, ancho: 2.9, largo: 6.9, alto: 2.3,
    medio: new THREE.Vector3(1.8, 1.0, 3.5), centro: new THREE.Vector3(0, 1.05, 0), vida: 1000, blindaje: 'pesado',
    giro: 0.75, torreta: { vel: 0.55, elevMin: -0.1, elevMax: 0.25 }, arma: 'canon125', coaxial: true,
    cam3: { dist: 13, alto: 3.6 }, zoom: [45, 14], masa: 45,
  },
  mtlb: {
    nombre: { UA: 'MT-LB', RU: 'MT-LB' }, oruga: true, vmax: 17, vmaxAtras: 5, acel: 3.6, ancho: 2.5, largo: 6.4, alto: 1.9,
    medio: new THREE.Vector3(1.45, 0.75, 3.25), centro: new THREE.Vector3(0, 1.1, 0), vida: 450, blindaje: 'ligero',
    giro: 0.9, torreta: { vel: 1.1, elevMin: -0.08, elevMax: 0.5 }, arma: 'kpvt',
    cam3: { dist: 11, alto: 3.2 }, zoom: [55, 22], masa: 12,
  },
  tecnica: {
    nombre: { UA: 'Pick-up ZU-23-2', RU: 'Pick-up ZU-23-2' }, oruga: false, vmax: 27, vmaxAtras: 7, acel: 4.2, ancho: 1.9, largo: 5.3, alto: 1.9,
    medio: new THREE.Vector3(0.95, 0.75, 2.65), centro: new THREE.Vector3(0, 1.0, 0), vida: 260, blindaje: 'ninguno',
    batalla: 3.1, giroMax: 0.6, torreta: { vel: 1.6, elevMin: -0.08, elevMax: 1.45 }, arma: 'zu23',
    cam3: { dist: 9, alto: 3.0 }, zoom: [60, 30], masa: 3,
  },
};

export const ARMAS_VEH = {
  canon125: { recarga: 7.0, tipos: [
    { id: 'apfsds', nombre: 'APFSDS', vel: 1650, dano: { pesado: 750, ligero: 900, ninguno: 900 }, danoSold: 200, radio: 2, explota: false },
    { id: 'he', nombre: 'HE-FRAG', vel: 850, dano: { pesado: 220, ligero: 500, ninguno: 600 }, danoSold: 200, radio: 11, explota: true },
  ] },
  kpvt: { cadencia: 600, vel: 990, dano: { pesado: 2, ligero: 18, ninguno: 35 }, danoSold: 90, cargador: 50, recarga: 5, trazadora: 3, calibre: 2 },
  zu23: { cadencia: 800, vel: 970, dano: { pesado: 4, ligero: 22, ninguno: 40 }, danoSold: 90, cargador: 100, recarga: 6, trazadora: 2, calibre: 2.2, cebo: true },
  pkt: { cadencia: 700, vel: 830, dano: { pesado: 0, ligero: 2, ninguno: 12 }, danoSold: 40, cargador: 250, recarga: 6, trazadora: 4, calibre: 1 },
};

// --------- Materiales y texturas ---------
function texOruga() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2826'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = '#4a4540'; g.fillRect(2, y + 2, 60, 9);
    g.fillStyle = '#1a1817'; g.fillRect(28, y, 8, 16);
    g.fillStyle = 'rgba(110,90,60,0.4)'; g.fillRect(0, y + 11, 64, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cajaG(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
}
function cilG(r1, r2, l, x, y, z, eje = 'z', seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r2, l, seg);
  if (eje === 'z') g.rotateX(Math.PI / 2); else if (eje === 'x') g.rotateZ(Math.PI / 2);
  return g.translate(x, y, z);
}
function fusion(lista) { return mergeGeometries(lista.map((g) => (g.index ? g.toNonIndexed() : g))); }
function malla(geos, mat) {
  const m = new THREE.Mesh(fusion(geos), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function materiales(faccion, tipo) {
  const tinte = faccion === 'UA' ? '#4f5634' : '#555a3a';
  const pintura = new THREE.MeshStandardMaterial({ map: TX.texBlindaje(tinte, 'bl_' + faccion), roughness: 0.75, metalness: 0.35 });
  const oscuro = new THREE.MeshStandardMaterial({ color: '#262624', roughness: 0.8, metalness: 0.4 });
  const goma = new THREE.MeshStandardMaterial({ color: '#1e1d1b', roughness: 0.95 });
  const era = new THREE.MeshStandardMaterial({ map: TX.texBlindaje(faccion === 'UA' ? '#566038' : '#5c5f40', 'era_' + faccion), roughness: 0.8, metalness: 0.3 });
  const vidrio = new THREE.MeshStandardMaterial({ color: '#141a1e', roughness: 0.1, metalness: 0.9 });
  const marca = new THREE.MeshStandardMaterial({ color: faccion === 'UA' ? '#e6e6e6' : '#e6e6e6', roughness: 0.7 });
  const tex = texOruga();
  const orugaI = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.5 });
  const orugaD = new THREE.MeshStandardMaterial({ map: tex.clone(), roughness: 0.9, metalness: 0.5 });
  orugaD.map.needsUpdate = true;
  const civil = new THREE.MeshStandardMaterial({ color: tipo === 'tecnica' ? (faccion === 'UA' ? '#5d6246' : '#6a6650') : tinte, roughness: 0.55, metalness: 0.4, map: TX.texBlindaje('#9a9a90', 'civil') });
  return { pintura, oscuro, goma, era, vidrio, marca, orugaI, orugaD, civil };
}

// Tren de rodaje de orugas para un lado. Devuelve geometrías de ruedas y de oruga.
function rodaje(lado, x, nRuedas, rRueda, z0, z1, yEje, anchoOruga, ruedas, oruga) {
  for (let i = 0; i < nRuedas; i++) {
    const z = z0 + ((z1 - z0) * i) / (nRuedas - 1);
    ruedas.push(cilG(rRueda, rRueda, anchoOruga * 0.8, x, yEje, z, 'x', 14));
    ruedas.push(cilG(rRueda * 0.35, rRueda * 0.35, anchoOruga * 0.9, x, yEje, z, 'x', 8));
  }
  const largo = z1 - z0 + rRueda * 2.6;
  const zc = (z0 + z1) / 2;
  const gO = [];
  gO.push(cajaG(anchoOruga, 0.08, largo - 0.6, x, 0.04, zc));
  gO.push(cajaG(anchoOruga, 0.08, largo - 0.4, x, yEje + rRueda + 0.05, zc));
  gO.push(cajaG(anchoOruga, 0.08, 0.9, x, yEje * 0.55, z0 - rRueda - 0.2, -0.85));
  gO.push(cajaG(anchoOruga, 0.08, 0.9, x, yEje * 0.6, z1 + rRueda + 0.2, 0.85));
  // UV a lo largo: escalar v por longitud
  for (const g of gO) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 3);
  }
  oruga.push(...gO);
  // Rueda motriz y tensora
  ruedas.push(cilG(rRueda * 0.85, rRueda * 0.85, anchoOruga * 0.7, x, yEje + 0.25, z1 + rRueda * 0.9, 'x', 10));
  ruedas.push(cilG(rRueda * 0.8, rRueda * 0.8, anchoOruga * 0.7, x, yEje + 0.2, z0 - rRueda * 0.9, 'x', 10));
}

function construirTanque(faccion, M) {
  const raiz = new THREE.Group();
  const casco = new THREE.Group(); raiz.add(casco);
  const geosP = [], geosO = [], geosE = [], ruedas = [], orI = [], orD = [];
  geosP.push(cajaG(2.3, 0.85, 6.5, 0, 0.9, 0.1));                 // casco inferior
  geosP.push(cajaG(3.5, 0.28, 6.7, 0, 1.45, 0.1));                // guardabarros/cubierta
  geosP.push(cajaG(2.3, 0.12, 1.7, 0, 1.2, -3.35, -0.42));        // glacis
  geosP.push(cajaG(2.6, 0.5, 0.2, 0, 1.25, 3.45));                // trasera
  // ERA en el glacis (Kontakt-5)
  for (let i = -3; i <= 3; i++) geosE.push(cajaG(0.3, 0.1, 0.55, i * 0.33, 1.38, -3.25, -0.42));
  // Bidones traseros
  geosO.push(cilG(0.3, 0.3, 1.25, -0.7, 1.8, 3.35, 'x'));
  geosO.push(cilG(0.3, 0.3, 1.25, 0.7, 1.8, 3.35, 'x'));
  // Faldones laterales de goma con ERA delantera
  for (const s of [-1, 1]) {
    geosO.push(cajaG(0.05, 0.55, 5.6, s * 1.76, 1.08, -0.2));
    for (let k = 0; k < 4; k++) geosE.push(cajaG(0.08, 0.45, 0.42, s * 1.8, 1.1, -2.8 + k * 0.45));
    rodaje(s, s * 1.42, 6, 0.37, -2.35, 2.0, 0.42, 0.58, ruedas, s < 0 ? orI : orD);
  }
  casco.add(malla(geosP, M.pintura), malla(geosE, M.era), malla(geosO, M.goma), malla(ruedas, M.oscuro));
  const mOrI = malla(orI, M.orugaI), mOrD = malla(orD, M.orugaD);
  casco.add(mOrI, mOrD);
  // Torreta
  const torreta = new THREE.Group(); torreta.position.set(0, 1.6, -0.35); casco.add(torreta);
  const domo = new THREE.SphereGeometry(1.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1.15);
  const tP = [domo, cajaG(1.0, 0.25, 0.8, 0, 0.12, 0.95)];
  const tE = [];
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) tE.push(cajaG(0.36, 0.22, 0.3, s * (0.35 + k * 0.22), 0.3, -1.05 + k * 0.18, 0, s * 0.5));
  for (let k = -2; k <= 2; k++) tE.push(cajaG(0.32, 0.08, 0.36, k * 0.34, 0.56, -0.55));
  const tO = [
    cilG(0.32, 0.32, 0.18, -0.45, 0.6, 0.15, 'y', 12),             // cúpula de jefe
    cilG(0.28, 0.28, 0.14, 0.45, 0.58, 0.1, 'y', 12),              // escotilla tirador
    cajaG(0.28, 0.32, 0.22, 0.6, 0.62, -0.55),                     // visor del tirador
    cilG(0.035, 0.035, 1.1, -0.45, 0.88, -0.2, 'z', 6),            // ametralladora antiaérea
  ];
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) tO.push(cilG(0.04, 0.04, 0.25, s * (0.95 - k * 0.05), 0.3 + k * 0.07, -0.45 + k * 0.04, 'z', 6));
  torreta.add(malla(tP, M.pintura), malla(tE, M.era), malla(tO, M.oscuro));
  if (faccion === 'RU') {
    // Jaula anti-dron ("mangal") sobre la torreta
    const jaula = [];
    for (const [x, z] of [[-1.1, -1.0], [1.1, -1.0], [-1.1, 1.3], [1.1, 1.3]]) jaula.push(cilG(0.03, 0.03, 1.3, x, 0.95, z, 'y', 5));
    for (let k = 0; k < 9; k++) jaula.push(cajaG(2.3, 0.04, 0.04, 0, 1.6, -1.0 + k * 0.29));
    for (let k = 0; k < 6; k++) jaula.push(cajaG(0.04, 0.04, 2.4, -1.1 + k * 0.44, 1.62, 0.15));
    torreta.add(malla(jaula, M.oscuro));
  }
  // Cañón
  const canon = new THREE.Group(); canon.position.set(0, 0.28, -1.15); torreta.add(canon);
  const cG = [
    cajaG(0.5, 0.42, 0.4, 0, 0, -0.1),
    cilG(0.12, 0.12, 2.0, 0, 0, -1.3, 'z', 12),
    cilG(0.16, 0.16, 0.6, 0, 0, -2.6, 'z', 12),
    cilG(0.11, 0.11, 2.2, 0, 0, -4.0, 'z', 12),
    cilG(0.095, 0.095, 0.9, 0, 0, -5.4, 'z', 12),
  ];
  canon.add(malla(cG, M.pintura));
  const boca = new THREE.Object3D(); boca.position.set(0, 0, -5.9); canon.add(boca);
  const bocaCoax = new THREE.Object3D(); bocaCoax.position.set(0.35, 0.05, -0.6); canon.add(bocaCoax);
  const ojo1 = new THREE.Object3D(); ojo1.position.set(0.6, 0.85, -0.7); torreta.add(ojo1);
  return { raiz, casco, torreta, canon, boca, bocaCoax, ojo1, orugas: [mOrI, mOrD] };
}

function construirMTLB(faccion, M) {
  const raiz = new THREE.Group();
  const casco = new THREE.Group(); raiz.add(casco);
  const P = [], O = [], ruedas = [], orI = [], orD = [];
  P.push(cajaG(2.6, 1.15, 5.6, 0, 1.15, 0.3));
  P.push(cajaG(2.6, 0.12, 1.2, 0, 1.25, -2.85, -0.75));
  P.push(cajaG(2.85, 0.1, 6.1, 0, 1.78, 0.2));
  P.push(cajaG(1.2, 0.35, 0.9, -0.55, 1.95, -1.9));                // cabina del conductor
  O.push(cajaG(0.25, 0.12, 0.05, -0.85, 2.0, -2.36), cajaG(0.25, 0.12, 0.05, -0.3, 2.0, -2.36));
  O.push(cajaG(2.2, 0.3, 0.6, 0, 2.0, 2.8));                       // cajas traseras
  for (const s of [-1, 1]) rodaje(s, s * 1.2, 6, 0.3, -2.2, 2.4, 0.36, 0.42, ruedas, s < 0 ? orI : orD);
  casco.add(malla(P, M.pintura), malla(O, M.oscuro), malla(ruedas, M.oscuro));
  const mOrI = malla(orI, M.orugaI), mOrD = malla(orD, M.orugaD);
  casco.add(mOrI, mOrD);
  const torreta = new THREE.Group(); torreta.position.set(0.6, 1.85, -1.6); casco.add(torreta);
  torreta.add(malla([cilG(0.48, 0.52, 0.42, 0, 0.2, 0, 'y', 14), cajaG(0.3, 0.2, 0.3, 0, 0.45, 0.1)], M.pintura));
  const canon = new THREE.Group(); canon.position.set(0, 0.25, -0.4); torreta.add(canon);
  canon.add(malla([cilG(0.05, 0.05, 1.6, 0, 0, -0.8, 'z', 8), cilG(0.07, 0.07, 0.25, 0, 0, -1.6, 'z', 8), cajaG(0.2, 0.2, 0.4, 0, 0, 0)], M.oscuro));
  const boca = new THREE.Object3D(); boca.position.set(0, 0, -1.75); canon.add(boca);
  const ojo1 = new THREE.Object3D(); ojo1.position.set(-0.22, 0.42, -0.35); torreta.add(ojo1);
  return { raiz, casco, torreta, canon, boca, ojo1, orugas: [mOrI, mOrD] };
}

function construirTecnica(faccion, M) {
  const raiz = new THREE.Group();
  const casco = new THREE.Group(); raiz.add(casco);
  const C = [], O = [], V = [];
  C.push(cajaG(1.85, 0.5, 5.1, 0, 0.85, 0));                       // carrocería baja
  C.push(cajaG(1.8, 0.45, 1.5, 0, 1.3, -1.75));                    // capó
  C.push(cajaG(1.8, 0.85, 1.6, 0, 1.5, -0.35));                    // cabina
  C.push(cajaG(1.85, 0.5, 0.08, 0, 1.3, 2.5), cajaG(0.08, 0.5, 2.3, -0.9, 1.3, 1.35), cajaG(0.08, 0.5, 2.3, 0.9, 1.3, 1.35));
  V.push(cajaG(1.65, 0.6, 0.05, 0, 1.6, -1.17, -0.5));             // parabrisas
  V.push(cajaG(0.05, 0.45, 1.1, -0.91, 1.62, -0.35), cajaG(0.05, 0.45, 1.1, 0.91, 1.62, -0.35));
  O.push(cajaG(1.9, 0.2, 0.2, 0, 0.8, -2.6));                      // parachoques
  casco.add(malla(C, M.civil), malla(V, M.vidrio), malla(O, M.oscuro));
  // Ruedas individuales (giran)
  const ruedas = [];
  const geoR = fusion([cilG(0.38, 0.38, 0.3, 0, 0, 0, 'x', 16), cilG(0.2, 0.2, 0.32, 0, 0, 0, 'x', 8)]);
  const matR = M.goma;
  for (const [x, z] of [[-0.85, -1.65], [0.85, -1.65], [-0.85, 1.45], [0.85, 1.45]]) {
    const piv = new THREE.Group(); piv.position.set(x, 0.38, z); casco.add(piv);
    const r = new THREE.Mesh(geoR, matR); r.castShadow = true; piv.add(r);
    ruedas.push({ piv, r, delantera: z < 0 });
  }
  // ZU-23-2 en la caja
  const torreta = new THREE.Group(); torreta.position.set(0, 1.25, 1.3); casco.add(torreta);
  torreta.add(malla([cilG(0.6, 0.6, 0.12, 0, 0.06, 0, 'y', 16), cajaG(0.9, 0.5, 0.5, 0, 0.35, 0.05), cajaG(0.35, 0.05, 0.4, 0, 0.62, 0.6)], M.pintura));
  torreta.add(malla([cajaG(0.35, 0.3, 0.45, -0.55, 0.55, -0.05), cajaG(0.35, 0.3, 0.45, 0.55, 0.55, -0.05)], M.oscuro));
  const canon = new THREE.Group(); canon.position.set(0, 0.7, -0.1); torreta.add(canon);
  canon.add(malla([
    cilG(0.035, 0.035, 2.4, -0.16, 0, -1.2, 'z', 8), cilG(0.035, 0.035, 2.4, 0.16, 0, -1.2, 'z', 8),
    cilG(0.055, 0.055, 0.3, -0.16, 0, -2.45, 'z', 8), cilG(0.055, 0.055, 0.3, 0.16, 0, -2.45, 'z', 8),
    cajaG(0.6, 0.25, 0.8, 0, 0, 0.1), cajaG(0.12, 0.15, 0.2, 0.28, 0.2, 0.1),
  ], M.oscuro));
  const boca = new THREE.Object3D(); boca.position.set(-0.16, 0, -2.6); canon.add(boca);
  const boca2 = new THREE.Object3D(); boca2.position.set(0.16, 0, -2.6); canon.add(boca2);
  const ojo1 = new THREE.Object3D(); ojo1.position.set(0.28, 0.45, 0.45); canon.add(ojo1);
  return { raiz, casco, torreta, canon, boca, boca2, ojo1, ruedas };
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Vehiculo {
  constructor(juego, { id, tipo, faccion, x, z, yaw }) {
    this.juego = juego;
    this.id = id;
    this.tipo = tipo;
    this.def = TIPOS[tipo];
    this.faccion = faccion;
    this.nombre = this.def.nombre[faccion];
    this.spawn = { x, z, yaw };
    const M = materiales(faccion, tipo);
    this.M = M;
    const partes = tipo === 'tanque' ? construirTanque(faccion, M) : tipo === 'mtlb' ? construirMTLB(faccion, M) : construirTecnica(faccion, M);
    Object.assign(this, partes);
    this.raiz.traverse((o) => { o.userData.vehiculo = this; });
    juego.scene.add(this.raiz);
    this.conductor = null;  // id del soldado
    this.local = false;     // simulado en este cliente
    this.reiniciar();
  }

  reiniciar() {
    const { x, z, yaw } = this.spawn;
    this.pos = new THREE.Vector3(x, this.juego.mundo.getHeight(x, z) + 0.2, z);
    this.yaw = yaw;
    this.cabeceo = 0; this.alabeo = 0;
    this.vel = 0; this.velGiro = 0; this.vy = 0;
    this.vI = 0; this.vD = 0;
    this.giroRueda = 0;
    this.torYaw = 0; this.canElev = 0;
    this.apYaw = yaw; this.apPitch = 0;
    this.vida = this.def.vida;
    this.destruido = false;
    this.tRecarga = 0;
    this.tCad = 0; this.tCadCoax = 0;
    this.municion = 0;
    this.cargador = ARMAS_VEH[this.def.arma].cargador || 1;
    this.coax = ARMAS_VEH.pkt.cargador;
    this.desplO = [0, 0];
    this.retroceso = 0;
    this.objetivo = null;
    this.tDestruido = 0;
    this.conductor = null;
    this.raiz.visible = true;
    if (this.torretaSuelta) { this.juego.scene.remove(this.torretaSuelta); this.casco.add(this.torreta); this.torretaSuelta = null; this.torreta.position.copy(this.torPos0); this.torreta.rotation.set(0, 0, 0); }
    this.torPos0 = this.torreta.position.clone();
    this.raiz.traverse((o) => { if (o.isMesh && o.userData.matOrig) { o.material = o.userData.matOrig; } });
    this.colocar();
  }

  // Coloca la malla según el estado
  colocar() {
    this.raiz.position.copy(this.pos);
    this.raiz.rotation.set(this.cabeceo, this.yaw, this.alabeo, 'YXZ');
    this.torreta.rotation.y = this.torYaw;
    this.canon.rotation.x = this.canElev;
    this.casco.position.z = this.retroceso * 0.0;
    this.raiz.updateMatrixWorld(true);
  }

  // Dirección del arma en el mundo
  dirArma(out = new THREE.Vector3()) {
    this.canon.updateMatrixWorld(true);
    return out.set(0, 0, -1).transformDirection(this.canon.matrixWorld);
  }

  // ---- Simulación (solo el cliente que conduce, o sin conductor) ----
  simular(dt, ctrl) {
    const d = this.def, W = this.juego.mundo;
    if (this.destruido) { ctrl = null; }
    let avance = 0;
    if (d.oruga) {
      const oI = ctrl ? ctrl.orugaI : 0, oD = ctrl ? ctrl.orugaD : 0;
      const objI = oI * (oI >= 0 ? d.vmax : d.vmaxAtras), objD = oD * (oD >= 0 ? d.vmax : d.vmaxAtras);
      const fr = (Math.abs(objI) < Math.abs(this.vI) ? 2.2 : 1) * d.acel * dt;
      this.vI = moveTowards(this.vI, objI, fr);
      this.vD = moveTowards(this.vD, objD, (Math.abs(objD) < Math.abs(this.vD) ? 2.2 : 1) * d.acel * dt);
      avance = (this.vI + this.vD) / 2;
      this.velGiro = ((this.vD - this.vI) / d.ancho) * d.giro;
    } else {
      const acel = ctrl ? ctrl.acel : 0, dir = ctrl ? ctrl.dir : 0;
      if (acel > 0.05) this.vel = moveTowards(this.vel, acel * d.vmax, d.acel * dt * (this.vel < 0 ? 3 : 1));
      else if (acel < -0.05) this.vel = moveTowards(this.vel, acel * d.vmaxAtras, d.acel * dt * (this.vel > 0 ? 3 : 1.2));
      else this.vel = moveTowards(this.vel, 0, 1.5 * dt);
      avance = this.vel;
      const giro = -dir * d.giroMax * (1 - Math.min(0.6, Math.abs(this.vel) / d.vmax * 0.7));
      this.angRueda = damp(this.angRueda || 0, giro, 8, dt);
      this.velGiro = (avance / d.batalla) * Math.tan(this.angRueda);
    }
    // Pendiente: la gravedad frena cuesta arriba
    const pend = Math.sin(this.cabeceo);
    if (d.oruga) { this.vI -= pend * 3.5 * dt; this.vD -= pend * 3.5 * dt; } else this.vel -= pend * 4 * dt;
    this.yaw += this.velGiro * dt;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const nuevo = _v.set(this.pos.x + fx * avance * dt, 0, this.pos.z + fz * avance * dt);
    // Colisiones con edificios y obstáculos (círculos a lo largo del casco)
    const r = d.ancho / 2 + 0.2;
    let choque = false;
    for (const off of [-d.largo / 2 + r, 0, d.largo / 2 - r]) {
      const c = _v2.set(nuevo.x + fx * -off, 0, nuevo.z + fz * -off);
      const antes = c.clone();
      W.consultar(c.x - r, c.z - r, c.x + r, c.z + r, (col) => {
        if (col.max.y < this.pos.y + 0.6) return; // pasa por encima de lo bajo
        if (col.mat === 'madera' && d.masa > 10 && Math.abs(avance) > 2) return; // postes: los atropella
        pushCircleAABB(c, r, col);
      });
      if (c.distanceToSquared(antes) > 1e-6) { nuevo.x += c.x - antes.x; nuevo.z += c.z - antes.z; choque = true; }
      // Árboles: los blindados los derriban, la camioneta choca
      W.arbolesCerca(c.x, c.z, r + 1, (a) => {
        const dx = c.x - a.x, dz = c.z - a.z, dd = Math.hypot(dx, dz);
        if (dd < r + a.r) {
          if (d.masa > 10 && Math.abs(avance) > 1.5) { W.derribarArbol(a, fx * Math.sign(avance), fz * Math.sign(avance)); this.juego.alDerribarArbol?.(a); }
          else { nuevo.x += (dx / dd) * (r + a.r - dd); nuevo.z += (dz / dd) * (r + a.r - dd); choque = true; }
        }
      });
    }
    // Otros vehículos
    for (const o of this.juego.vehiculos) {
      if (o === this) continue;
      const dx = nuevo.x - o.pos.x, dz = nuevo.z - o.pos.z, dd = Math.hypot(dx, dz), m = (d.largo + o.def.largo) * 0.33;
      if (dd < m && dd > 0.01) { nuevo.x = o.pos.x + (dx / dd) * m; nuevo.z = o.pos.z + (dz / dd) * m; choque = true; }
    }
    if (choque) {
      if (d.oruga) { this.vI *= 0.6; this.vD *= 0.6; } else this.vel *= 0.5;
    }
    this.pos.x = clamp(nuevo.x, -1150, 1150); this.pos.z = clamp(nuevo.z, -1150, 1150);
    this.seguirTerreno(dt);
    this.velActual = avance;
    // Torreta estabilizada hacia el punto de mira
    this.apuntarTorreta(dt);
    // Animación de orugas/ruedas
    if (d.oruga) {
      this.desplO[0] += this.vI * dt * 0.33; this.desplO[1] += this.vD * dt * 0.33;
      this.M.orugaI.map.offset.y = -this.desplO[0];
      this.M.orugaD.map.offset.y = -this.desplO[1];
    } else {
      this.giroRueda += (avance * dt) / 0.38;
      for (const w of this.ruedas) { w.r.rotation.x = -this.giroRueda; if (w.delantera) w.piv.rotation.y = this.angRueda; }
    }
    this.retroceso = damp(this.retroceso, 0, 5, dt);
    this.colocar();
  }

  seguirTerreno(dt) {
    const d = this.def, W = this.juego.mundo;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const L = d.largo * 0.42, A = d.ancho * 0.45;
    const h = (a, b) => W.getHeight(this.pos.x + fx * a + rx * b, this.pos.z + fz * a + rz * b);
    const hFI = h(L, -A), hFD = h(L, A), hTI = h(-L, -A), hTD = h(-L, A);
    // Las orugas apoyan en el punto más alto de cada esquina (puente sobre trincheras)
    const front = Math.max(hFI, hFD, (hFI + hFD) / 2), back = Math.max(hTI, hTD, (hTI + hTD) / 2);
    const left = (hFI + hTI) / 2, right = (hFD + hTD) / 2;
    const objY = Math.max((front + back) / 2, W.getHeight(this.pos.x, this.pos.z) - 0.4);
    const objCab = Math.atan2(front - back, 2 * L);
    const objAla = Math.atan2(right - left, 2 * A);
    // Suspensión: muelle-amortiguador
    const k = d.oruga ? 10 : 7;
    if (this.pos.y > objY + 0.3) { this.vy -= 9.8 * dt; this.pos.y += this.vy * dt; if (this.pos.y < objY) { this.pos.y = objY; this.vy = 0; } }
    else { this.pos.y = damp(this.pos.y, objY, 14, dt); this.vy = 0; }
    this.cabeceo = damp(this.cabeceo, objCab + this.retroceso * 0.03, k, dt);
    this.alabeo = damp(this.alabeo, objAla, k, dt);
  }

  apuntarTorreta(dt) {
    const t = this.def.torreta;
    const objRel = wrapAngle(this.apYaw - this.yaw);
    this.torYaw = moveAngleTowards(this.torYaw, objRel, t.vel * dt);
    // Elevación relativa compensando el cabeceo del casco en la dirección de la torreta
    const cabEnTorreta = this.cabeceo * Math.cos(this.torYaw) - this.alabeo * Math.sin(this.torYaw);
    const objElev = clamp(this.apPitch - cabEnTorreta, t.elevMin, t.elevMax);
    this.canElev = moveTowards(this.canElev, objElev, t.vel * 0.6 * dt);
  }

  // ---- Interpolación para vehículos remotos ----
  aplicarRed(s, dt) {
    this.pos.lerp(_v.set(s.p[0], s.p[1], s.p[2]), 1 - Math.exp(-12 * dt));
    this.yaw = dampAngle(this.yaw, s.y, 12, dt);
    this.cabeceo = damp(this.cabeceo, s.c, 12, dt);
    this.alabeo = damp(this.alabeo, s.a, 12, dt);
    this.torYaw = dampAngle(this.torYaw, s.t, 14, dt);
    this.canElev = damp(this.canElev, s.e, 14, dt);
    this.velActual = s.v;
    if (this.def.oruga) {
      this.desplO[0] += s.v * dt * 0.33; this.desplO[1] += s.v * dt * 0.33;
      this.M.orugaI.map.offset.y = -this.desplO[0]; this.M.orugaD.map.offset.y = -this.desplO[1];
    } else {
      this.giroRueda += (s.v * dt) / 0.38;
      for (const w of this.ruedas) w.r.rotation.x = -this.giroRueda;
    }
    this.colocar();
  }

  estadoRed() {
    const r = (x) => Math.round(x * 100) / 100;
    return { id: this.id, p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], y: r(this.yaw), c: r(this.cabeceo), a: r(this.alabeo), t: r(this.torYaw), e: r(this.canElev), v: r(this.velActual || 0) };
  }

  // Prueba de impacto de un segmento contra el casco (caja orientada)
  impacto(a, b) {
    if (!this.raiz.visible) return null;
    if (a.distanceToSquared(this.pos) > 900 && b.distanceToSquared(this.pos) > 900) {
      // descarte rápido por distancia del segmento al centro
      const ab = _v.subVectors(b, a), t = clamp(_v2.subVectors(this.pos, a).dot(ab) / ab.lengthSq(), 0, 1);
      if (a.clone().addScaledVector(ab, t).distanceToSquared(this.pos) > 64) return null;
    }
    const h = segOBB(a, b, this.raiz.matrixWorld, this.def.medio, this.def.centro);
    if (!h) return null;
    const n = new THREE.Vector3(h.nx, h.ny, h.nz).transformDirection(this.raiz.matrixWorld);
    return { t: h.t, n };
  }

  // Empuja a un soldado fuera del casco (en el plano local)
  empujarSoldado(p, r) {
    if (!this.raiz.visible) return false;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (dx * dx + dz * dz > 49) return false;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const m = this.def.medio;
    const q = { x: lx, z: lz };
    const caja = { min: { x: -m.x, z: -m.z }, max: { x: m.x, z: m.z } };
    if (!pushCircleAABB(q, r, caja)) return false;
    p.x = this.pos.x + q.x * c + q.z * s;
    p.z = this.pos.z - q.x * s + q.z * c;
    return true;
  }

  danar(cant) {
    if (this.destruido) return false;
    this.vida -= cant;
    if (this.vida <= 0) { this.vida = 0; this.destruir(); return true; }
    return false;
  }

  destruir() {
    this.destruido = true;
    this.tDestruido = 0;
    const quemado = new THREE.MeshStandardMaterial({ color: '#1c1916', roughness: 0.95, metalness: 0.3 });
    this.raiz.traverse((o) => { if (o.isMesh) { if (!o.userData.matOrig) o.userData.matOrig = o.material; o.material = quemado; } });
    const J = this.juego;
    J.efectos.explosion(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), this.tipo === 'tanque' ? 2.2 : 1.6);
    J.audio.explosion(this.pos, 3);
    J.efectos.addFoco(this.pos.clone().add(new THREE.Vector3(0, 1.8, 0)), this.tipo === 'tanque' ? 1.3 : 0.8);
    this.foco = J.efectos.focos[J.efectos.focos.length - 1];
    // Lanzamiento de la torreta por detonación de munición (tanque)
    if (this.tipo === 'tanque') {
      const tw = new THREE.Vector3(); this.torreta.getWorldPosition(tw);
      const tq = new THREE.Quaternion(); this.torreta.getWorldQuaternion(tq);
      this.casco.remove(this.torreta);
      J.scene.add(this.torreta);
      this.torreta.position.copy(tw); this.torreta.quaternion.copy(tq);
      this.torretaSuelta = this.torreta;
      this.torVel = new THREE.Vector3((Math.random() - 0.5) * 4, 14 + Math.random() * 6, (Math.random() - 0.5) * 4);
      this.torGiro = new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3);
    }
  }

  actualizarDestruido(dt) {
    this.tDestruido += dt;
    const t = this.torretaSuelta;
    if (t && this.torVel) {
      this.torVel.y -= 9.8 * dt;
      t.position.addScaledVector(this.torVel, dt);
      t.rotation.x += this.torGiro.x * dt; t.rotation.y += this.torGiro.y * dt; t.rotation.z += this.torGiro.z * dt;
      const h = this.juego.mundo.getHeight(t.position.x, t.position.z);
      if (t.position.y < h + 0.3) { t.position.y = h + 0.3; this.torVel = null; t.rotation.x = Math.PI * (Math.random() < 0.5 ? 1 : 0.15); }
    }
    if (this.tDestruido > 90) {
      // Reaparece el vehículo en su base
      if (this.foco) { const i = this.juego.efectos.focos.indexOf(this.foco); if (i >= 0) this.juego.efectos.focos.splice(i, 1); }
      this.reiniciar();
      return true;
    }
    return false;
  }

  // Posición de cámara de primera persona (visor del tirador)
  camaraVisor(cam) {
    this.ojo1.updateMatrixWorld(true);
    this.ojo1.getWorldPosition(cam.position);
    this.canon.getWorldQuaternion(cam.quaternion);
  }
}

// Restos calcinados decorativos
export function crearRestos(juego, tipo, faccion, x, z, yaw) {
  const M = materiales(faccion, tipo);
  const p = tipo === 'tanque' ? construirTanque(faccion, M) : tipo === 'mtlb' ? construirMTLB(faccion, M) : construirTecnica(faccion, M);
  const q = new THREE.MeshStandardMaterial({ map: TX.texBlindaje('#2b241f', 'restos'), roughness: 0.95, metalness: 0.3 });
  p.raiz.traverse((o) => { if (o.isMesh) o.material = q; });
  const y = juego.mundo.getHeight(x, z);
  p.raiz.position.set(x, y - 0.1, z);
  p.raiz.rotation.set((Math.random() - 0.5) * 0.1, yaw, (Math.random() - 0.5) * 0.15);
  if (tipo === 'tanque' && Math.random() < 0.7) {
    p.casco.remove(p.torreta);
    juego.scene.add(p.torreta);
    p.torreta.position.set(x + 5 + Math.random() * 4, y + 0.4, z + (Math.random() - 0.5) * 8);
    p.torreta.rotation.set(Math.PI * 0.9, Math.random() * 6, 0.3);
  }
  juego.scene.add(p.raiz);
  const T = TIPOS[tipo];
  juego.mundo.addColisor({ x: x - T.largo / 2, y, z: z - T.largo / 2 }, { x: x + T.largo / 2, y: y + T.alto, z: z + T.largo / 2 }, 'metal');
}
