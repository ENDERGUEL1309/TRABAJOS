// Modelo detallado del soldado, basado en la foto de referencia: casco de corte alto con raíles,
// soporte de visión nocturna, cascos de comunicación y micrófono, gafas balísticas, pasamontañas,
// camisa de combate con mangas de camuflaje, portaplacas con MOLLE, portacargadores, radio,
// botiquín, mochila de asalto, cinturón con granadas, funda de pistola en el muslo,
// rodilleras, guantes con nudilleras y botas de desierto.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './texturas.js';

const geoCache = {};
const geo = (k, f) => geoCache[k] || (geoCache[k] = f());

// Tubo de revolución con perfil [radio, altura] (para muslos, gemelos y brazos con forma anatómica)
function torneado(perfil, seg = 12) {
  // LatheGeometry espera el perfil de abajo arriba para que las normales miren hacia fuera
  const pts = perfil.map(([r, y]) => new THREE.Vector2(r, y)).sort((a, b) => a.y - b.y);
  return new THREE.LatheGeometry(pts, seg);
}
function rbox(w, h, d, r = 0.015) { return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)); }

const matCache = {};
export function materialesSoldado(faccion) {
  if (matCache[faccion]) return matCache[faccion];
  const ua = faccion === 'UA';
  const camo = ua ? TX.texMulticam() : TX.texCamo('RU');
  const molle = ua ? TX.texMolle('#a28b68', 'molle_coyote') : TX.texMolle('#545a3e', 'molle_verde');
  const M = {
    uniforme: new THREE.MeshStandardMaterial({ map: camo, roughness: 0.95 }),
    camisa: new THREE.MeshStandardMaterial({ color: ua ? '#b7a380' : '#6a6e52', roughness: 0.95, map: ua ? null : camo }),
    equipo: new THREE.MeshStandardMaterial({ map: molle.map, normalMap: molle.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92 }),
    equipoLiso: new THREE.MeshStandardMaterial({ color: ua ? '#9c8562' : '#4f553a', roughness: 0.9 }),
    cinturon: new THREE.MeshStandardMaterial({ color: ua ? '#5f6a45' : '#3c4030', roughness: 0.85 }),
    casco: new THREE.MeshStandardMaterial({ map: ua ? TX.texCasco('#cbbd99', '#8e7a58', 'casco_ua') : TX.texCasco('#4f573a', '#3a4029', 'casco_ru'), roughness: 0.7, metalness: 0.05 }),
    oscuro: new THREE.MeshStandardMaterial({ color: '#232322', roughness: 0.6, metalness: 0.3 }),
    goma: new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.95 }),
    auriculares: new THREE.MeshStandardMaterial({ color: ua ? '#6e5a40' : '#2e302a', roughness: 0.6 }),
    lente: new THREE.MeshPhysicalMaterial({ color: '#141a1c', roughness: 0.05, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    piel: new THREE.MeshStandardMaterial({ color: '#b48a6e', roughness: 0.65 }),
    pasamontanas: new THREE.MeshStandardMaterial({ color: ua ? '#a8946e' : '#4c5038', roughness: 0.95 }),
    guante: new THREE.MeshStandardMaterial({ color: ua ? '#b19a74' : '#2c2c28', roughness: 0.85 }),
    nudillera: new THREE.MeshStandardMaterial({ color: '#1d1d1c', roughness: 0.5 }),
    bota: new THREE.MeshStandardMaterial({ color: ua ? '#bba37b' : '#2b2723', roughness: 0.92 }),
    suela: new THREE.MeshStandardMaterial({ color: '#4a4036', roughness: 0.95 }),
    rodillera: new THREE.MeshStandardMaterial({ color: ua ? '#a8916a' : '#3f4430', roughness: 0.75 }),
    funda: new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.7 }),
  };
  matCache[faccion] = M;
  return M;
}

function malla(g, m, padre, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  padre.add(o);
  return o;
}

// Segmento de miembro entre dos puntos (eje Y del perfil alineado con el segmento)
export function segmentoMiembro(g, m, desde, hasta, largoBase) {
  const dir = new THREE.Vector3().subVectors(hasta, desde);
  const o = new THREE.Mesh(g, m);
  o.scale.y = dir.length() / largoBase;
  o.position.copy(desde);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  o.castShadow = true;
  return o;
}

export function construirSoldado(faccion, colorCinta) {
  const M = materialesSoldado(faccion);
  const raiz = new THREE.Group();
  const cadera = new THREE.Group(); cadera.position.y = 0.95; raiz.add(cadera);

  // --- Cadera y cinturón ---
  const pelvis = malla(geo('pelvis', () => rbox(0.34, 0.22, 0.24, 0.07)), M.uniforme, cadera);
  malla(geo('cinto', () => rbox(0.37, 0.065, 0.27, 0.025)), M.cinturon, cadera, 0, 0.08, 0);
  for (let i = -2; i <= 2; i++) malla(geo('granada', () => rbox(0.045, 0.08, 0.045, 0.015)), M.cinturon, cadera, i * 0.055, 0.06, 0.15);
  malla(geo('cinto_bolsa', () => rbox(0.08, 0.1, 0.06, 0.015)), M.equipoLiso, cadera, -0.17, 0.04, -0.06);

  // --- Torso ---
  const torso = new THREE.Group(); cadera.add(torso);
  const pecho = malla(geo('pecho', () => new THREE.CapsuleGeometry(0.155, 0.24, 4, 14).scale(1.2, 1, 0.78)), M.camisa, torso, 0, 0.33, 0);
  malla(geo('placa', () => rbox(0.31, 0.34, 0.06, 0.02)), M.equipo, torso, 0, 0.36, -0.125);
  malla(geo('placa', () => rbox(0.31, 0.34, 0.06, 0.02)), M.equipo, torso, 0, 0.36, 0.125);
  const faja = malla(geo('faja', () => new THREE.CylinderGeometry(0.2, 0.2, 0.17, 18, 1, true).scale(1, 1, 0.82)), M.equipo, torso, 0, 0.27, 0);
  faja.material = M.equipo.clone(); faja.material.side = THREE.DoubleSide;
  for (const s of [-1, 1]) malla(geo('tirante', () => rbox(0.07, 0.035, 0.28, 0.012)), M.equipo, torso, s * 0.1, 0.545, 0);
  // Portacargadores con solapa
  for (let i = -1; i <= 1; i++) {
    malla(geo('portacarg', () => rbox(0.078, 0.13, 0.055, 0.012)), M.equipo, torso, i * 0.088, 0.27, -0.178);
    malla(geo('solapa', () => rbox(0.08, 0.03, 0.06, 0.008)), M.equipoLiso, torso, i * 0.088, 0.345, -0.18);
  }
  malla(geo('admin', () => rbox(0.18, 0.085, 0.04, 0.012)), M.equipoLiso, torso, 0, 0.42, -0.17);
  // Radio con antena en el lado izquierdo y botiquín en el derecho
  malla(geo('radio', () => rbox(0.05, 0.13, 0.07, 0.01)), M.oscuro, torso, -0.205, 0.33, -0.02);
  malla(geo('antena', () => new THREE.CylinderGeometry(0.004, 0.006, 0.32, 5).translate(0, 0.16, 0)), M.oscuro, torso, -0.2, 0.4, 0.05).rotation.x = 0.15;
  malla(geo('botiquin', () => rbox(0.06, 0.12, 0.1, 0.02)), M.equipoLiso, torso, 0.2, 0.3, -0.03);
  // Mochila de asalto
  malla(geo('mochila', () => rbox(0.3, 0.4, 0.15, 0.045)), M.equipo, torso, 0, 0.34, 0.235);
  malla(geo('mochila_tapa', () => rbox(0.26, 0.08, 0.12, 0.03)), M.equipoLiso, torso, 0, 0.55, 0.23);
  malla(geo('mochila_bolsillo', () => rbox(0.2, 0.18, 0.05, 0.02)), M.equipo, torso, 0, 0.27, 0.32);
  // Hombros y cuello
  for (const s of [-1, 1]) malla(geo('hombro', () => new THREE.SphereGeometry(0.075, 12, 10)), M.uniforme, torso, s * 0.2, 0.5, 0);
  malla(geo('cuelloM', () => new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10)), M.pasamontanas, torso, 0, 0.58, 0);

  // --- Cabeza ---
  const cuello = new THREE.Group(); cuello.position.y = 0.6; torso.add(cuello);
  const cabeza = malla(geo('cabeza', () => new THREE.SphereGeometry(0.103, 16, 12).scale(0.9, 1.1, 1)), M.piel, cuello, 0, 0.08, 0);
  malla(geo('pasam', () => new THREE.SphereGeometry(0.107, 16, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58).scale(0.93, 1.1, 1.03)), M.pasamontanas, cuello, 0, 0.08, 0);
  // Gafas balísticas y su cinta
  malla(geo('gafas', () => rbox(0.15, 0.045, 0.03, 0.012)), M.lente, cuello, 0, 0.105, -0.092);
  malla(geo('cinta_gafas', () => new THREE.TorusGeometry(0.102, 0.008, 4, 18).rotateX(Math.PI / 2).scale(0.95, 1, 1.05)), M.oscuro, cuello, 0, 0.11, 0);
  // Casco de corte alto: casquete, raíles laterales, soporte NVG, velcro trasero
  const casco = new THREE.Group(); casco.position.y = 0.125; cuello.add(casco);
  malla(geo('casco', () => new THREE.SphereGeometry(0.138, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.92, 1.1)), M.casco, casco);
  malla(geo('casco_borde', () => new THREE.TorusGeometry(0.137, 0.008, 5, 24).rotateX(Math.PI / 2).scale(1, 1, 1.1)), M.casco, casco, 0, 0.004, 0);
  for (const s of [-1, 1]) malla(geo('rail', () => rbox(0.018, 0.03, 0.12, 0.005)), M.oscuro, casco, s * 0.132, 0.035, 0.0).rotation.z = s * 0.25;
  malla(geo('nvg', () => rbox(0.045, 0.04, 0.025, 0.006)), M.oscuro, casco, 0, 0.07, -0.142);
  malla(geo('velcro', () => rbox(0.07, 0.04, 0.01, 0.004)), M.equipoLiso, casco, 0, 0.08, 0.135).rotation.x = 0.5;
  malla(geo('cinta_casco', () => new THREE.TorusGeometry(0.139, 0.01, 4, 24).rotateX(Math.PI / 2).scale(1, 1, 1.1)), new THREE.MeshStandardMaterial({ color: colorCinta, roughness: 0.6 }), casco, 0, 0.035, 0);
  // Cascos de comunicación y micrófono
  for (const s of [-1, 1]) {
    malla(geo('copa', () => new THREE.CylinderGeometry(0.042, 0.045, 0.035, 14).rotateZ(Math.PI / 2)), M.auriculares, cuello, s * 0.112, 0.075, 0.005);
  }
  malla(geo('arco', () => new THREE.TorusGeometry(0.115, 0.007, 4, 16, Math.PI).scale(1, 1.05, 1)), M.oscuro, cuello, 0, 0.08, 0.04).rotation.y = 0;
  malla(geo('micro', () => new THREE.CylinderGeometry(0.004, 0.004, 0.1, 5).rotateX(Math.PI / 2).rotateY(0.6)), M.oscuro, cuello, -0.09, 0.04, -0.06);

  // --- Piernas ---
  const pierna = (lado) => {
    const muslo = new THREE.Group(); muslo.position.set(lado * 0.1, -0.06, 0); cadera.add(muslo);
    const m = malla(geo('muslo', () => torneado([[0.001, 0.0], [0.07, -0.01], [0.09, -0.08], [0.088, -0.22], [0.074, -0.36], [0.066, -0.43], [0.001, -0.44]])), M.uniforme, muslo);
    malla(geo('bolsillo', () => rbox(0.06, 0.13, 0.08, 0.015)), M.uniforme, muslo, lado * 0.08, -0.2, -0.01);
    if (lado > 0) {
      // Funda de pistola tipo pernera con su arnés
      malla(geo('funda', () => rbox(0.05, 0.19, 0.09, 0.012)), M.funda, muslo, 0.085, -0.17, 0.0);
      malla(geo('empu_pist', () => rbox(0.035, 0.07, 0.03, 0.008)), M.funda, muslo, 0.088, -0.04, 0.025).rotation.x = -0.3;
      malla(geo('arnes', () => new THREE.TorusGeometry(0.083, 0.008, 4, 16).rotateX(Math.PI / 2)), M.funda, muslo, 0, -0.22, 0);
    }
    const rod = new THREE.Group(); rod.position.y = -0.42; muslo.add(rod);
    const e = malla(geo('espinilla', () => torneado([[0.001, 0.0], [0.062, -0.01], [0.07, -0.1], [0.06, -0.25], [0.048, -0.37], [0.001, -0.38]])), M.uniforme, rod);
    malla(geo('rodillera', () => rbox(0.1, 0.11, 0.05, 0.02)), M.rodillera, rod, 0, -0.01, -0.065);
    // Bota de desierto: caña, pala y suela
    malla(geo('bota_cana', () => new THREE.CylinderGeometry(0.058, 0.062, 0.14, 12)), M.bota, rod, 0, -0.36, 0);
    malla(geo('bota_pala', () => rbox(0.105, 0.085, 0.24, 0.035)), M.bota, rod, 0, -0.43, -0.045);
    malla(geo('suela', () => rbox(0.11, 0.025, 0.26, 0.01)), M.suela, rod, 0, -0.47, -0.045);
    return { muslo, rod, m, e };
  };
  const pI = pierna(-1), pD = pierna(1);

  // --- Arma y brazos (giran con el cabeceo) ---
  const pivArma = new THREE.Group(); pivArma.position.set(0.05, 0.42, -0.05); torso.add(pivArma);
  // Cinta de identificación del bando en el brazo izquierdo
  const cinta = new THREE.MeshStandardMaterial({ color: colorCinta, roughness: 0.6 });

  return { raiz, cadera, torso, cuello, pivArma, pI, pD, pelvis, pecho, cabeza, materiales: M, cinta };
}

// Brazos que sujetan el arma: de los hombros a la empuñadura y al guardamanos
const geoBrazo = () => torneado([[0.001, 0], [0.058, -0.01], [0.062, -0.08], [0.052, -0.2], [0.045, -0.28], [0.001, -0.29]], 10);
const geoAntebrazo = () => torneado([[0.001, 0], [0.046, -0.01], [0.05, -0.08], [0.04, -0.23], [0.036, -0.26], [0.001, -0.27]], 10);
export function construirBrazos(M, cinta, manoD, manoI) {
  const G = new THREE.Group();
  const hD = new THREE.Vector3(0.15, 0.1, 0.04), hI = new THREE.Vector3(-0.17, 0.1, 0.04);
  const codoD = new THREE.Vector3(0.2, -0.12, -0.04);
  const codoI = new THREE.Vector3(-0.1, -0.13, (manoI.z + hI.z) / 2 + 0.02);
  const ad = segmentoMiembro(geo('brazo', geoBrazo), M.uniforme, hD, codoD, 0.29);
  const ai = segmentoMiembro(geo('brazo', geoBrazo), M.uniforme, hI, codoI, 0.29);
  G.add(ad, ai,
    segmentoMiembro(geo('antebrazo', geoAntebrazo), M.uniforme, codoD, manoD, 0.27),
    segmentoMiembro(geo('antebrazo', geoAntebrazo), M.uniforme, codoI, manoI, 0.27));
  // Cinta del bando
  const c = segmentoMiembro(geo('cinta_b', () => new THREE.CylinderGeometry(0.064, 0.064, 0.05, 10).translate(0, -0.1, 0)), cinta, hI, codoI, 1);
  c.scale.y = 1;
  G.add(c);
  // Guantes con nudillera
  for (const p of [manoD, manoI]) {
    const g = new THREE.Mesh(geo('guante', () => rbox(0.06, 0.05, 0.1, 0.02)), M.guante); g.position.copy(p); g.castShadow = true; G.add(g);
    const n = new THREE.Mesh(geo('nudillo', () => rbox(0.05, 0.015, 0.035, 0.006)), M.nudillera); n.position.copy(p).add(new THREE.Vector3(0, 0.026, -0.02)); G.add(n);
  }
  G.userData = { brazoD: ad, brazoI: ai };
  return G;
}
