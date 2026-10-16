// Modelos procedurales de armas portátiles (fusiles AK y lanzagranadas RPG-7).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './texturas.js';

const mats = {};
function mat(nombre) {
  if (mats[nombre]) return mats[nombre];
  const defs = {
    acero: { color: '#26282a', roughness: 0.45, metalness: 0.85 },
    pavonado: { color: '#1b1c1e', roughness: 0.55, metalness: 0.7 },
    polimero: { color: '#202020', roughness: 0.8, metalness: 0.05 },
    marron: { color: '#4a2f22', roughness: 0.7, metalness: 0.05 },
    verdeOliva: { color: '#4b5034', roughness: 0.75, metalness: 0.1 },
    lente: { color: '#0a1a14', roughness: 0.05, metalness: 0.9 },
    tubo: { color: '#4d5236', roughness: 0.6, metalness: 0.3 },
    cabeza: { color: '#5a5d44', roughness: 0.5, metalness: 0.5 },
    guante: { color: '#2b2a26', roughness: 0.9 },
    piel: { color: '#b58a6f', roughness: 0.7 },
  };
  mats[nombre] = new THREE.MeshStandardMaterial(defs[nombre]);
  return mats[nombre];
}
export function material(n) { return mat(n); }

function caja(w, h, d, x, y, z) { return new THREE.BoxGeometry(w, h, d).translate(x, y, z); }
function cil(r1, r2, l, x, y, z, seg = 10) { return new THREE.CylinderGeometry(r1, r2, l, seg).rotateX(Math.PI / 2).translate(x, y, z); }
function grupo(partes) {
  // partes: [[geometria, nombreMaterial], ...] -> un mesh por material
  const porMat = {};
  for (const [g, m] of partes) (porMat[m] ||= []).push(g.index ? g.toNonIndexed() : g);
  const G = new THREE.Group();
  for (const [m, gs] of Object.entries(porMat)) {
    const mesh = new THREE.Mesh(mergeGeometries(gs), mat(m));
    mesh.castShadow = true;
    G.add(mesh);
  }
  return G;
}

// Fusil tipo AK. Eje del cañón -Z, origen en el pistolete. variante: 'ak74' | 'ak12'
export function crearFusil(variante = 'ak74') {
  const negro = variante === 'ak12';
  const madera = negro ? 'polimero' : 'marron';
  const p = [];
  p.push([caja(0.05, 0.075, 0.30, 0, 0.035, -0.05), 'pavonado']);              // cajón de mecanismos
  p.push([caja(0.048, 0.02, 0.26, 0, 0.082, -0.06), 'acero']);                 // tapa
  p.push([cil(0.011, 0.011, 0.42, 0, 0.055, -0.40), 'acero']);                 // cañón
  p.push([cil(0.017, 0.017, 0.07, 0, 0.055, -0.63), 'pavonado']);              // freno de boca
  p.push([cil(0.012, 0.012, 0.22, 0, 0.088, -0.30), 'pavonado']);              // tubo de gases
  p.push([caja(0.058, 0.06, 0.20, 0, 0.055, -0.30), madera]);                  // guardamanos
  p.push([caja(0.012, 0.045, 0.012, 0, 0.1, -0.56), 'pavonado']);              // punto de mira
  // Cargador curvo en tres tramos
  p.push([caja(0.03, 0.07, 0.07, 0, -0.03, -0.12).rotateX(0.15), negro ? 'polimero' : 'marron']);
  p.push([caja(0.03, 0.07, 0.07, 0, -0.09, -0.135).rotateX(0.3), negro ? 'polimero' : 'marron']);
  p.push([caja(0.03, 0.07, 0.07, 0, -0.15, -0.17).rotateX(0.45), negro ? 'polimero' : 'marron']);
  p.push([caja(0.03, 0.10, 0.04, 0, -0.04, 0.03).rotateX(-0.25), 'polimero']); // pistolete
  p.push([caja(0.008, 0.01, 0.07, 0, -0.005, -0.02), 'acero']);                // guardamonte
  // Culata
  if (negro) {
    p.push([caja(0.04, 0.03, 0.22, 0, 0.05, 0.2), 'polimero']);
    p.push([caja(0.04, 0.11, 0.05, 0, 0.0, 0.31), 'polimero']);
    p.push([caja(0.02, 0.012, 0.24, 0, 0.1, -0.08), 'pavonado']);             // riel superior
  } else {
    p.push([caja(0.042, 0.06, 0.24, 0, 0.03, 0.2).rotateX(0.06), 'marron']);
    p.push([caja(0.044, 0.11, 0.04, 0, -0.005, 0.32), 'polimero']);
    p.push([caja(0.04, 0.02, 0.12, 0, 0.1, -0.05), 'pavonado']);              // montura lateral
  }
  // Colimador
  p.push([caja(0.032, 0.012, 0.07, 0, 0.11, -0.06), 'pavonado']);
  const G = grupo(p);
  // Tubo del colimador abierto (se ve a través)
  const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.07, 18, 1, true).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }));
  tubo.position.set(0, 0.135, -0.06);
  G.add(tubo);
  // Lente con retícula roja
  const lente = new THREE.Mesh(new THREE.CircleGeometry(0.016, 16), new THREE.MeshStandardMaterial({ color: '#0d1f1a', roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.12, depthWrite: false }));
  lente.position.set(0, 0.135, -0.024);
  G.add(lente);
  const punto = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 8), new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false, depthTest: false }));
  punto.position.set(0, 0.135, -0.095);
  punto.renderOrder = 10;
  G.add(punto);
  // Puntos de referencia
  const boca = new THREE.Object3D(); boca.position.set(0, 0.055, -0.68); boca.name = 'boca'; G.add(boca);
  const mira = new THREE.Object3D(); mira.position.set(0, 0.135, -0.02); mira.name = 'mira'; G.add(mira);
  const exp = new THREE.Object3D(); exp.position.set(0.03, 0.06, -0.08); exp.name = 'eyeccion'; G.add(exp);
  G.userData = { boca, mira, exp, punto };
  return G;
}

// RPG-7 con granada PG-7V. Origen en el pistolete, eje -Z.
export function crearRPG(conGranada = true) {
  const p = [];
  p.push([cil(0.035, 0.035, 0.95, 0, 0.06, -0.12, 12), 'tubo']);
  p.push([cil(0.045, 0.06, 0.2, 0, 0.06, 0.42, 12), 'tubo']);       // tobera trasera
  p.push([cil(0.05, 0.05, 0.14, 0, 0.06, 0.02, 12), 'marron']);     // protector térmico
  p.push([cil(0.05, 0.05, 0.14, 0, 0.06, -0.24, 12), 'marron']);
  p.push([caja(0.03, 0.1, 0.04, 0, -0.03, 0.0).rotateX(-0.2), 'polimero']);
  p.push([caja(0.03, 0.1, 0.04, 0, -0.03, -0.2).rotateX(-0.2), 'polimero']);
  p.push([caja(0.03, 0.05, 0.12, -0.05, 0.12, -0.08), 'pavonado']);  // óptica PGO-7
  const G = grupo(p);
  const gran = grupo([
    [cil(0.02, 0.02, 0.18, 0, 0.06, -0.68, 10), 'cabeza'],
    [cil(0.042, 0.0, 0.14, 0, 0.06, -0.92, 12), 'cabeza'],
    [cil(0.042, 0.042, 0.1, 0, 0.06, -0.8, 12), 'cabeza'],
  ]);
  gran.visible = conGranada;
  G.add(gran);
  const boca = new THREE.Object3D(); boca.position.set(0, 0.06, -0.7); G.add(boca);
  const mira = new THREE.Object3D(); mira.position.set(-0.05, 0.12, 0.05); G.add(mira);
  const cola = new THREE.Object3D(); cola.position.set(0, 0.06, 0.55); G.add(cola);
  G.userData = { boca, mira, cola, granada: gran };
  return G;
}

// Granada propulsada en vuelo (proyectil visible).
export function crearCohete() {
  return grupo([
    [cil(0.042, 0.0, 0.14, 0, 0, -0.12, 10), 'cabeza'],
    [cil(0.042, 0.042, 0.1, 0, 0, -0.01, 10), 'cabeza'],
    [cil(0.02, 0.02, 0.35, 0, 0, 0.2, 8), 'tubo'],
  ]);
}

// Manos/antebrazos para la vista en primera persona (coordenadas del arma: origen en el pistolete, cañón -Z).
function segmento(geo, mat, desde, hasta) {
  const dir = new THREE.Vector3().subVectors(hasta, desde);
  const m = new THREE.Mesh(geo, mat);
  m.scale.y = dir.length() / 0.4;
  m.position.copy(desde).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
export function crearBrazos(faccion, manoIzq = new THREE.Vector3(-0.025, 0.02, -0.3)) {
  const camo = new THREE.MeshStandardMaterial({ map: TX.texCamo(faccion), roughness: 0.95 });
  const G = new THREE.Group();
  const manga = new THREE.CapsuleGeometry(0.042, 0.4, 3, 10);
  const guante = new THREE.BoxGeometry(0.06, 0.055, 0.1);
  // Derecha: mano en el pistolete, codo abajo a la derecha y hacia atrás
  const manoD = new THREE.Vector3(0.0, -0.05, 0.04);
  G.add(segmento(manga, camo, new THREE.Vector3(0.02, -0.08, 0.1), new THREE.Vector3(0.14, -0.3, 0.38)));
  const md = new THREE.Mesh(guante, mat('guante')); md.position.copy(manoD); md.rotation.x = -0.35; G.add(md);
  // Izquierda: mano bajo el guardamanos, codo abajo a la izquierda
  G.add(segmento(manga, camo, manoIzq.clone().add(new THREE.Vector3(-0.03, -0.05, 0.08)), new THREE.Vector3(-0.2, -0.32, 0.05)));
  const mi = new THREE.Mesh(guante, mat('guante')); mi.position.copy(manoIzq).add(new THREE.Vector3(0, -0.025, 0)); mi.rotation.set(0.15, 0, 0.6); G.add(mi);
  G.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return G;
}
