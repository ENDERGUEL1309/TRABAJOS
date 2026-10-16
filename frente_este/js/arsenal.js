// Arsenal: armas de infantería, accesorios, clases (operadores) y modelos procedurales paramétricos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { material } from './modelos.js';

// dano: daño a vehículos por tipo de blindaje
const BALA = { pesado: 0, ligero: 0.5, ninguno: 5 };
export const ARMAS = {
  // --- Fusiles de asalto ---
  ak74: { nombre: 'AK-74M', tipo: 'fusil', municion: '5,45×39', cadencia: 650, auto: true, vel: 880, danoSold: 34, cargador: 30, cargadores: 6, recarga: 2.6, retroceso: 0.014, dispCadera: 0.012, dispMira: 0.0016, dano: BALA, trazadora: 4, calibre: 1,
    modelo: { familia: 'ak', canon: 0.42, madera: true }, mira: 'colimador' },
  ak12: { nombre: 'AK-12', tipo: 'fusil', municion: '5,45×39', cadencia: 700, auto: true, vel: 900, danoSold: 33, cargador: 30, cargadores: 6, recarga: 2.5, retroceso: 0.013, dispCadera: 0.012, dispMira: 0.0015, dano: BALA, trazadora: 4, calibre: 1,
    modelo: { familia: 'ak', canon: 0.42, riel: true }, mira: 'colimador' },
  m4a1: { nombre: 'M4A1', tipo: 'fusil', municion: '5,56×45', cadencia: 800, auto: true, vel: 900, danoSold: 31, cargador: 30, cargadores: 6, recarga: 2.3, retroceso: 0.011, dispCadera: 0.011, dispMira: 0.0014, dano: BALA, trazadora: 4, calibre: 1,
    modelo: { familia: 'ar', canon: 0.36 }, mira: 'holo' },
  bren2: { nombre: 'CZ Bren 2', tipo: 'fusil', municion: '5,56×45', cadencia: 760, auto: true, vel: 880, danoSold: 32, cargador: 30, cargadores: 6, recarga: 2.4, retroceso: 0.012, dispCadera: 0.011, dispMira: 0.0015, dano: BALA, trazadora: 4, calibre: 1,
    modelo: { familia: 'bren', canon: 0.36, color: 'verdeOliva' }, mira: 'colimador' },
  aks74u: { nombre: 'AKS-74U', tipo: 'carabina', municion: '5,45×39', cadencia: 700, auto: true, vel: 735, danoSold: 30, cargador: 30, cargadores: 6, recarga: 2.4, retroceso: 0.016, dispCadera: 0.009, dispMira: 0.0025, dano: BALA, trazadora: 4, calibre: 1,
    modelo: { familia: 'ak', canon: 0.21, madera: true, plegable: true }, mira: 'hierro' },
  // --- Ametralladoras (soporte) ---
  pkm: { nombre: 'PKM', tipo: 'ametralladora', municion: '7,62×54R', cadencia: 650, auto: true, vel: 825, danoSold: 45, cargador: 100, cargadores: 4, recarga: 6.5, retroceso: 0.02, dispCadera: 0.02, dispMira: 0.0035, dano: { pesado: 0, ligero: 1, ninguno: 8 }, trazadora: 3, calibre: 1.5,
    modelo: { familia: 'pkm', canon: 0.6, madera: true }, mira: 'hierro', bipode: true, velMov: 0.85 },
  rpk74: { nombre: 'RPK-74M', tipo: 'ametralladora', municion: '5,45×39', cadencia: 600, auto: true, vel: 960, danoSold: 36, cargador: 45, cargadores: 6, recarga: 3.2, retroceso: 0.014, dispCadera: 0.016, dispMira: 0.0018, dano: BALA, trazadora: 3, calibre: 1.1,
    modelo: { familia: 'ak', canon: 0.59, rpk: true }, mira: 'hierro', bipode: true, velMov: 0.9 },
  // --- Francotirador ---
  svd: { nombre: 'SVD Dragunov', tipo: 'tirador', municion: '7,62×54R', cadencia: 300, auto: false, vel: 830, danoSold: 80, cargador: 10, cargadores: 5, recarga: 3, retroceso: 0.03, dispCadera: 0.03, dispMira: 0.0004, dano: { pesado: 0, ligero: 2, ninguno: 12 }, trazadora: 0, calibre: 1.6,
    modelo: { familia: 'svd', canon: 0.62, madera: true }, mira: 'pso1' },
  t5000: { nombre: 'ORSIS T-5000', tipo: 'francotirador', municion: '.338 Lapua', cadencia: 45, auto: false, cerrojo: 1.3, vel: 900, danoSold: 120, cargador: 5, cargadores: 6, recarga: 3.4, retroceso: 0.05, dispCadera: 0.04, dispMira: 0.0002, dano: { pesado: 0, ligero: 4, ninguno: 25 }, trazadora: 0, calibre: 2,
    modelo: { familia: 'cerrojo', canon: 0.7 }, mira: 'tele8' },
  m82: { nombre: 'Barrett M82A1', tipo: 'antimaterial', municion: '12,7×99', cadencia: 90, auto: false, vel: 850, danoSold: 150, cargador: 10, cargadores: 4, recarga: 4.2, retroceso: 0.07, dispCadera: 0.05, dispMira: 0.0003, dano: { pesado: 3, ligero: 35, ninguno: 70 }, trazadora: 0, calibre: 2.6,
    modelo: { familia: 'm82', canon: 0.74 }, mira: 'tele8', bipode: true, velMov: 0.8 },
  // --- Pistolas ---
  pm: { nombre: 'Makarov PM', tipo: 'pistola', municion: '9×18', cadencia: 400, auto: false, vel: 315, danoSold: 24, cargador: 8, cargadores: 5, recarga: 1.8, retroceso: 0.02, dispCadera: 0.012, dispMira: 0.004, dano: { pesado: 0, ligero: 0, ninguno: 2 }, trazadora: 0, calibre: 0.6,
    modelo: { familia: 'pistola' }, mira: 'hierro' },
  glock: { nombre: 'Glock 17', tipo: 'pistola', municion: '9×19', cadencia: 450, auto: false, vel: 375, danoSold: 25, cargador: 17, cargadores: 4, recarga: 1.7, retroceso: 0.018, dispCadera: 0.011, dispMira: 0.0035, dano: { pesado: 0, ligero: 0, ninguno: 2 }, trazadora: 0, calibre: 0.6,
    modelo: { familia: 'pistola', polimero: true }, mira: 'hierro' },
  // --- Antitanque ---
  rpg7: { nombre: 'RPG-7', tipo: 'lanzador', municion: 'PG-7VL', cohete: true, vel: 115, velMax: 295, cargador: 1, cargadores: 4, recarga: 4.2, retroceso: 0.05, dispCadera: 0.012, dispMira: 0.003, danoSold: 200, radio: 7,
    dano: { pesado: 650, ligero: 850, ninguno: 850 }, modelo: { familia: 'rpg' }, mira: 'hierro', zoomPropio: 2.5 },
  nlaw: { nombre: 'NLAW', tipo: 'lanzador', municion: 'NLAW (ataque superior)', cohete: true, vel: 200, velMax: 220, cargador: 1, cargadores: 2, recarga: 5, retroceso: 0.04, dispCadera: 0.01, dispMira: 0.0015, danoSold: 200, radio: 6,
    dano: { pesado: 950, ligero: 950, ninguno: 950 }, modelo: { familia: 'nlaw' }, mira: 'hierro', zoomPropio: 2.5 },
  rpg26: { nombre: 'RPG-26', tipo: 'lanzador', municion: 'PG-26', cohete: true, vel: 145, velMax: 145, cargador: 1, cargadores: 3, recarga: 2.5, retroceso: 0.04, dispCadera: 0.012, dispMira: 0.004, danoSold: 180, radio: 6,
    dano: { pesado: 450, ligero: 750, ninguno: 750 }, modelo: { familia: 'rpg26' }, mira: 'hierro', zoomPropio: 1.6 },
};

// Accesorios. Multiplicadores aplicados a las estadísticas base.
export const ACCESORIOS = {
  mira: {
    hierro: { nombre: 'Miras metálicas', zoom: 1.1 },
    colimador: { nombre: 'Colimador (punto rojo)', zoom: 1.25 },
    holo: { nombre: 'Holográfico', zoom: 1.3 },
    acog: { nombre: 'Óptica 4×', zoom: 4, visor: true },
    pso1: { nombre: 'PSO-1 4×', zoom: 4, visor: true, reticula: 'pso' },
    tele8: { nombre: 'Telescópica 8×', zoom: 8, visor: true, reticula: 'mil' },
  },
  boca: {
    ninguno: { nombre: 'Bocacha de serie' },
    silenciador: { nombre: 'Silenciador', ruido: 0.3, retroceso: 0.92, vel: 0.95, silencio: true },
    compensador: { nombre: 'Compensador', retroceso: 0.75, dispCadera: 1.05 },
    apagallamas: { nombre: 'Apagallamas', fogonazo: 0.3 },
  },
  empunadura: {
    ninguna: { nombre: 'Sin empuñadura' },
    vertical: { nombre: 'Empuñadura vertical', retroceso: 0.82, dispCadera: 0.9 },
    angulada: { nombre: 'Empuñadura angulada', retroceso: 0.9, velApuntar: 1.4 },
    bipode: { nombre: 'Bípode', retrocesoAgachado: 0.35 },
  },
  cargador: {
    estandar: { nombre: 'Cargador estándar' },
    ampliado: { nombre: 'Cargador ampliado', capacidad: 1.5, recarga: 1.15 },
    rapido: { nombre: 'Recarga rápida (cinta/acoplado)', recarga: 0.75 },
  },
};

// Qué accesorios admite cada tipo de arma
const PERMITIDOS = {
  fusil: { mira: ['hierro', 'colimador', 'holo', 'acog'], boca: ['ninguno', 'silenciador', 'compensador', 'apagallamas'], empunadura: ['ninguna', 'vertical', 'angulada'], cargador: ['estandar', 'ampliado', 'rapido'] },
  carabina: { mira: ['hierro', 'colimador', 'holo'], boca: ['ninguno', 'silenciador', 'compensador'], empunadura: ['ninguna', 'vertical', 'angulada'], cargador: ['estandar', 'ampliado', 'rapido'] },
  ametralladora: { mira: ['hierro', 'colimador', 'holo', 'acog'], boca: ['ninguno', 'compensador', 'apagallamas'], empunadura: ['bipode', 'ninguna', 'vertical'], cargador: ['estandar', 'rapido'] },
  tirador: { mira: ['pso1', 'acog', 'colimador'], boca: ['ninguno', 'silenciador', 'compensador'], empunadura: ['ninguna', 'bipode'], cargador: ['estandar', 'ampliado'] },
  francotirador: { mira: ['tele8', 'acog'], boca: ['ninguno', 'silenciador', 'compensador'], empunadura: ['bipode', 'ninguna'], cargador: ['estandar'] },
  antimaterial: { mira: ['tele8', 'acog'], boca: ['ninguno', 'compensador'], empunadura: ['bipode'], cargador: ['estandar'] },
  pistola: { mira: ['hierro', 'colimador'], boca: ['ninguno', 'silenciador'], empunadura: ['ninguna'], cargador: ['estandar', 'ampliado'] },
  lanzador: { mira: ['hierro'], boca: ['ninguno'], empunadura: ['ninguna'], cargador: ['estandar'] },
};
export function permitidos(id) { return PERMITIDOS[ARMAS[id].tipo]; }
export function accesoriosPorDefecto(id) {
  const P = permitidos(id), a = ARMAS[id];
  return { mira: P.mira.includes(a.mira) ? a.mira : P.mira[0], boca: P.boca[0], empunadura: a.bipode ? 'bipode' : P.empunadura[0], cargador: 'estandar' };
}

// Estadísticas finales del arma con sus accesorios
export function estadisticas(id, acc = accesoriosPorDefecto(id)) {
  const b = ARMAS[id];
  const d = { ...b, id, acc };
  const mods = ['mira', 'boca', 'empunadura', 'cargador'].map((k) => ACCESORIOS[k][acc[k]] || {});
  for (const m of mods) {
    if (m.retroceso) d.retroceso *= m.retroceso;
    if (m.dispCadera) d.dispCadera *= m.dispCadera;
    if (m.vel) d.vel *= m.vel;
    if (m.capacidad) d.cargador = Math.round(d.cargador * m.capacidad);
    if (m.recarga) d.recarga *= m.recarga;
    if (m.velApuntar) d.velApuntar = m.velApuntar;
    if (m.silencio) d.silenciador = true;
    if (m.fogonazo) d.fogonazo = m.fogonazo;
    if (m.retrocesoAgachado) d.retrocesoAgachado = m.retrocesoAgachado;
  }
  const mira = ACCESORIOS.mira[acc.mira];
  d.zoom = b.zoomPropio || mira.zoom;
  d.visor = !!mira.visor;
  d.reticula = mira.reticula || 'mil';
  d.fov = 72 / Math.min(d.zoom, 1.6);
  return d;
}

// Clases / operadores
export const CLASES = {
  asalto: { nombre: 'Asalto', desc: 'Fusil de asalto, granadas extra y pistola. Rápido y versátil.', primarias: ['ak74', 'ak12', 'm4a1', 'bren2'], secundarias: ['pm', 'glock'], especiales: [], granadas: 3, drones: 1, vida: 100 },
  soporte: { nombre: 'Soporte', desc: 'Ametralladora con bípode. Reabastece de munición a los aliados cercanos.', primarias: ['pkm', 'rpk74'], secundarias: ['pm', 'glock'], especiales: [], granadas: 2, drones: 1, vida: 100, reabastece: true },
  francotirador: { nombre: 'Francotirador', desc: 'Fusil de precisión con óptica de 4× a 8×. Letal a larga distancia.', primarias: ['svd', 't5000', 'm82'], secundarias: ['pm', 'glock'], especiales: [], granadas: 1, drones: 1, vida: 100 },
  antitanque: { nombre: 'Antitanque', desc: 'Carabina y lanzacohetes contra blindados y helicópteros.', primarias: ['aks74u', 'ak74', 'm4a1'], secundarias: ['pm', 'glock'], especiales: ['rpg7', 'nlaw', 'rpg26'], granadas: 2, drones: 0, vida: 100 },
  operador: { nombre: 'Operador de drones', desc: 'Carabina y 5 drones FPV kamikaze con más batería.', primarias: ['aks74u', 'ak74'], secundarias: ['pm', 'glock'], especiales: [], granadas: 1, drones: 5, vida: 100, bateriaDron: 1.6 },
};

export function equipoPorDefecto(clase, faccion) {
  const C = CLASES[clase];
  const pref = (lista, ua, ru) => (lista.includes(faccion === 'UA' ? ua : ru) ? (faccion === 'UA' ? ua : ru) : lista[0]);
  const primaria = pref(C.primarias, clase === 'asalto' ? 'ak74' : C.primarias[0], clase === 'asalto' ? 'ak12' : C.primarias[0]);
  return {
    clase,
    primaria, accPrimaria: accesoriosPorDefecto(primaria),
    secundaria: faccion === 'UA' ? 'glock' : 'pm', accSecundaria: accesoriosPorDefecto(faccion === 'UA' ? 'glock' : 'pm'),
    especial: C.especiales.length ? pref(C.especiales, 'nlaw', 'rpg7') : null,
  };
}

// ---------------- Modelos ----------------
function caja(w, h, d, x, y, z, rx = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); return g.translate(x, y, z); }
function cil(r1, r2, l, x, y, z, seg = 10, abierto = false) { return new THREE.CylinderGeometry(r1, r2, l, seg, 1, abierto).rotateX(Math.PI / 2).translate(x, y, z); }
function grupo(partes) {
  const porMat = {};
  for (const [g, m] of partes) (porMat[m] ||= []).push(g.index ? g.toNonIndexed() : g);
  const G = new THREE.Group();
  for (const [m, gs] of Object.entries(porMat)) { const mesh = new THREE.Mesh(mergeGeometries(gs), material(m)); mesh.castShadow = true; G.add(mesh); }
  return G;
}

// Devuelve un grupo con userData { boca, mira (punto del ojo), manoIzq, punto (retícula) }
export function crearModeloArma(id, acc = accesoriosPorDefecto(id)) {
  const a = ARMAS[id], M = a.modelo;
  const p = [];
  const mad = M.madera ? 'marron' : M.color || 'polimero';
  let bocaZ = -0.6, bocaY = 0.055, rielY = 0.1, manoIzq = new THREE.Vector3(-0.025, 0.02, -0.3);
  const f = M.familia;
  if (f === 'ak' || f === 'ar' || f === 'bren' || f === 'pkm' || f === 'svd' || f === 'cerrojo' || f === 'm82') {
    const L = M.canon;
    const recL = f === 'pkm' || f === 'm82' ? 0.38 : 0.3;
    p.push([caja(0.052, 0.075, recL, 0, 0.035, -0.05), f === 'bren' ? (M.color || 'verdeOliva') : 'pavonado']);
    if (f === 'ar' || f === 'bren' || M.riel || f === 'cerrojo' || f === 'm82') p.push([caja(0.03, 0.014, recL + 0.06, 0, 0.08, -0.06), 'pavonado']);
    else p.push([caja(0.048, 0.02, recL - 0.04, 0, 0.082, -0.06), 'acero']);
    const z0 = -0.05 - recL / 2;
    const rB = f === 'm82' ? 0.016 : f === 'pkm' ? 0.013 : 0.011;
    p.push([cil(rB, rB, L, 0, 0.055, z0 - L / 2), 'acero']);
    bocaZ = z0 - L;
    // Guardamanos
    const gL = f === 'cerrojo' || f === 'm82' ? 0.3 : Math.min(0.26, L * 0.55);
    const gW = f === 'ar' ? 0.06 : 0.058;
    p.push([caja(gW, 0.062, gL, 0, 0.055, z0 - gL / 2), f === 'ar' || f === 'cerrojo' || f === 'm82' ? 'pavonado' : mad]);
    manoIzq = new THREE.Vector3(-0.025, 0.02, z0 - gL * 0.6);
    if (f === 'ak' || f === 'svd' || f === 'pkm') p.push([cil(0.011, 0.011, gL, 0, 0.088, z0 - gL / 2), 'pavonado']);
    if (f === 'm82') { p.push([cil(0.035, 0.03, 0.12, 0, 0.055, bocaZ - 0.05), 'pavonado']); bocaZ -= 0.11; }
    else if (f !== 'cerrojo') { p.push([cil(0.016, 0.016, 0.07, 0, 0.055, bocaZ - 0.02), 'pavonado']); bocaZ -= 0.05; }
    // Punto de mira delantero
    if (f !== 'cerrojo' && f !== 'm82') p.push([caja(0.01, 0.04, 0.01, 0, 0.095, bocaZ + 0.06), 'pavonado']);
    // Cargadores
    if (f === 'ak') {
      const mm = M.rpk ? 'pavonado' : (M.madera ? 'marron' : 'polimero');
      const n = M.rpk ? 4 : 3;
      for (let i = 0; i < n; i++) p.push([caja(0.03, 0.07, 0.07, 0, -0.03 - i * 0.06, -0.12 - i * 0.02 - i * i * 0.006, 0.15 + i * 0.15), mm]);
    } else if (f === 'ar' || f === 'bren') {
      p.push([caja(0.026, 0.17, 0.065, 0, -0.06, -0.12, 0.1), 'pavonado']);
    } else if (f === 'pkm') {
      p.push([caja(0.11, 0.12, 0.1, -0.03, -0.06, -0.12), 'verdeOliva']); // caja de cinta
    } else if (f === 'svd') {
      p.push([caja(0.03, 0.09, 0.06, 0, -0.03, -0.1), 'pavonado']);
    } else if (f === 'm82') {
      p.push([caja(0.04, 0.1, 0.1, 0, -0.04, -0.06), 'pavonado']);
    } else if (f === 'cerrojo') {
      p.push([caja(0.03, 0.06, 0.08, 0, -0.02, -0.08), 'pavonado']);
      p.push([cil(0.008, 0.008, 0.06, 0.04, 0.07, 0.02), 'acero']); // palanca del cerrojo
    }
    // Pistolete
    p.push([caja(0.03, 0.1, 0.04, 0, -0.04, 0.03, -0.25), 'polimero']);
    // Culata
    if (M.plegable) p.push([caja(0.01, 0.03, 0.2, -0.035, 0.03, 0.14), 'pavonado']);
    else if (f === 'ar') { p.push([cil(0.015, 0.015, 0.16, 0, 0.05, 0.14), 'pavonado'], [caja(0.04, 0.09, 0.12, 0, 0.03, 0.25), 'polimero']); }
    else if (f === 'bren') { p.push([caja(0.035, 0.03, 0.2, 0, 0.05, 0.16), 'polimero'], [caja(0.04, 0.1, 0.05, 0, 0.02, 0.27), 'polimero']); }
    else if (f === 'svd') { p.push([caja(0.035, 0.03, 0.26, 0, 0.07, 0.2), mad], [caja(0.035, 0.03, 0.2, 0, -0.03, 0.22), mad], [caja(0.04, 0.12, 0.04, 0, 0.02, 0.33), mad]); }
    else if (f === 'cerrojo' || f === 'm82') { p.push([caja(0.045, 0.1, 0.3, 0, 0.03, 0.2), f === 'm82' ? 'pavonado' : 'polimero'], [caja(0.045, 0.13, 0.04, 0, 0.01, 0.36), 'polimero']); }
    else p.push([caja(0.042, 0.06, 0.24, 0, 0.03, 0.2, 0.06), mad], [caja(0.044, 0.11, 0.04, 0, -0.005, 0.32), 'polimero']);
    rielY = f === 'ak' && !M.riel ? 0.1 : 0.09;
  } else if (f === 'pistola') {
    p.push([caja(0.03, 0.035, 0.18, 0, 0.06, -0.07), M.polimero ? 'polimero' : 'pavonado']);
    p.push([caja(0.028, 0.11, 0.045, 0, 0.0, 0.0, -0.2), M.polimero ? 'polimero' : 'marron']);
    p.push([caja(0.006, 0.012, 0.006, 0, 0.083, -0.15), 'acero']);
    bocaZ = -0.17; bocaY = 0.06; rielY = 0.08;
    manoIzq = new THREE.Vector3(-0.015, -0.01, 0.0);
  } else if (f === 'rpg' || f === 'nlaw' || f === 'rpg26') {
    const r = f === 'nlaw' ? 0.07 : f === 'rpg26' ? 0.04 : 0.035;
    p.push([cil(r, r, f === 'nlaw' ? 1.0 : 0.95, 0, 0.06, -0.12, 14), f === 'rpg' ? 'tubo' : 'verdeOliva']);
    if (f === 'rpg') {
      p.push([cil(0.045, 0.06, 0.2, 0, 0.06, 0.42, 12), 'tubo'], [cil(0.05, 0.05, 0.14, 0, 0.06, 0.02, 12), 'marron'], [cil(0.05, 0.05, 0.14, 0, 0.06, -0.24, 12), 'marron']);
      p.push([cil(0.02, 0.02, 0.18, 0, 0.06, -0.68), 'cabeza'], [cil(0.042, 0.042, 0.1, 0, 0.06, -0.8, 12), 'cabeza'], [cil(0.042, 0.0, 0.14, 0, 0.06, -0.92, 12), 'cabeza']);
    }
    if (f === 'nlaw') p.push([caja(0.05, 0.07, 0.12, -0.08, 0.12, -0.05), 'polimero']);
    p.push([caja(0.03, 0.1, 0.04, 0, -0.03, 0.0, -0.2), 'polimero'], [caja(0.03, 0.1, 0.04, 0, -0.03, -0.2, -0.2), 'polimero']);
    bocaZ = -0.7; bocaY = 0.06; rielY = 0.12;
    manoIzq = new THREE.Vector3(-0.02, 0.0, -0.2);
  }
  // Bípode (plegado bajo el cañón)
  if (acc.empunadura === 'bipode' && f !== 'pistola') {
    p.push([caja(0.008, 0.008, 0.2, -0.015, 0.03, bocaZ + 0.25), 'pavonado'], [caja(0.008, 0.008, 0.2, 0.015, 0.03, bocaZ + 0.25), 'pavonado']);
  }
  if (acc.empunadura === 'vertical') { p.push([caja(0.028, 0.08, 0.03, 0, 0.0, manoIzq.z), 'polimero']); manoIzq = new THREE.Vector3(-0.0, -0.03, manoIzq.z); }
  if (acc.empunadura === 'angulada') p.push([caja(0.026, 0.03, 0.07, 0, 0.012, manoIzq.z + 0.03, 0.5), 'polimero']);
  // Bocacha
  if (acc.boca === 'silenciador') { p.push([cil(0.022, 0.022, 0.17, 0, bocaY, bocaZ - 0.085, 14), 'pavonado']); bocaZ -= 0.17; }
  else if (acc.boca === 'compensador') { p.push([cil(0.019, 0.019, 0.06, 0, bocaY, bocaZ - 0.03, 8), 'acero']); bocaZ -= 0.06; }
  else if (acc.boca === 'apagallamas') { p.push([cil(0.017, 0.014, 0.05, 0, bocaY, bocaZ - 0.025, 6), 'pavonado']); bocaZ -= 0.05; }
  const G = grupo(p);
  // Miras
  let miraY = rielY + 0.035, miraZ = 0.0, punto = null;
  const tipoMira = ARMAS[id].tipo === 'lanzador' ? 'hierro' : acc.mira;
  if (tipoMira === 'hierro') {
    const alza = grupo([[caja(0.03, 0.02, 0.012, 0, rielY + 0.005, -0.02), 'pavonado']]);
    G.add(alza);
    miraY = rielY + 0.012; miraZ = 0.0;
    if (f === 'rpg' || f === 'nlaw' || f === 'rpg26') { miraY = 0.14; }
  } else if (tipoMira === 'colimador' || tipoMira === 'holo') {
    if (tipoMira === 'colimador') {
      G.add(grupo([[caja(0.03, 0.012, 0.07, 0, rielY + 0.004, -0.06), 'pavonado']]));
      const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.065, 16, 1, true).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }));
      tubo.position.set(0, rielY + 0.035, -0.06); G.add(tubo);
    } else {
      const marco = grupo([[caja(0.045, 0.012, 0.08, 0, rielY + 0.004, -0.06), 'pavonado'], [caja(0.006, 0.045, 0.07, -0.022, rielY + 0.033, -0.06), 'pavonado'], [caja(0.006, 0.045, 0.07, 0.022, rielY + 0.033, -0.06), 'pavonado'], [caja(0.05, 0.006, 0.07, 0, rielY + 0.058, -0.06), 'pavonado']]);
      G.add(marco);
    }
    miraY = rielY + 0.035;
    const tex = texReticula(tipoMira);
    punto = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.012), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: false, depthWrite: false }));
    punto.position.set(0, miraY, -0.11);
    punto.renderOrder = 10;
    G.add(punto);
  } else {
    // Óptica de aumento
    const largo = tipoMira === 'tele8' ? 0.34 : 0.22, r = tipoMira === 'tele8' ? 0.024 : 0.02;
    const y = rielY + 0.045;
    G.add(grupo([[cil(r, r, largo, 0, y, -0.06, 16), 'pavonado'], [cil(r * 1.35, r, 0.05, 0, y, -0.06 - largo / 2, 16), 'pavonado'], [cil(r * 1.2, r, 0.04, 0, y, -0.06 + largo / 2, 16), 'pavonado'],
      [caja(0.02, 0.03, 0.03, 0, rielY + 0.015, -0.1), 'pavonado'], [caja(0.02, 0.03, 0.03, 0, rielY + 0.015, 0.0), 'pavonado'], [cil(0.008, 0.008, 0.02, 0.0, y + r, -0.06, 8).rotateX(Math.PI / 2), 'pavonado']]));
    miraY = y; miraZ = -0.06 + largo / 2 + 0.07;
  }
  const boca = new THREE.Object3D(); boca.position.set(0, bocaY, bocaZ); G.add(boca);
  const mira = new THREE.Object3D(); mira.position.set(0, miraY, miraZ); G.add(mira);
  G.userData = { boca, mira, manoIzq, punto, tipoMira };
  G.traverse((o) => { o.userData.esArma = true; });
  return G;
}

const texCache = {};
function texReticula(tipo) {
  if (texCache[tipo]) return texCache[tipo];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = '#ff2a1a';
  g.shadowColor = '#ff2a1a'; g.shadowBlur = 4;
  if (tipo === 'holo') { g.lineWidth = 2.5; g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.arc(32, 32, 3.5, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache[tipo] = t;
  return t;
}

// Granada F-1 / RGD-5
export function crearModeloGranada() {
  return grupo([[new THREE.SphereGeometry(0.03, 10, 8).scale(1, 1.3, 1), 'verdeOliva'], [cil(0.008, 0.008, 0.03, 0, 0.04, 0, 6).rotateX(Math.PI / 2), 'acero']]);
}
