// Armas modeladas a partir de las siluetas de fotos de referencia (js/perfiles.js):
// cada pieza se extruye con su grosor real, bordes biselados y normales suavizadas, con materiales PBR.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { PERFILES } from './perfiles.js';
import * as TX from './texturas.js';

const cacheMat = {};
export function materialArma(tipo) {
  if (cacheMat[tipo]) return cacheMat[tipo];
  const metal = TX.texMetalArma(), poli = TX.texPolimero();
  let m;
  switch (tipo) {
    case 'madera': {
      const v = TX.texVetaMadera();
      m = new THREE.MeshStandardMaterial({ map: v.map, normalMap: v.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.62, metalness: 0, envMapIntensity: 0.5 });
      break;
    }
    case 'acero': m = new THREE.MeshStandardMaterial({ color: '#2b2c2f', map: metal.map, roughnessMap: metal.roughnessMap, metalness: 0.85, roughness: 0.5 }); break;
    case 'cromo': m = new THREE.MeshStandardMaterial({ color: '#c8c8c2', metalness: 1, roughness: 0.22, roughnessMap: metal.roughnessMap }); break;
    case 'aluminio': m = new THREE.MeshStandardMaterial({ color: '#242528', map: metal.map, roughnessMap: metal.roughnessMap, metalness: 0.6, roughness: 0.6 }); break;
    case 'polimero': m = new THREE.MeshStandardMaterial({ color: '#1e1e1f', normalMap: poli.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.85, metalness: 0.02 }); break;
    case 'polimeroOliva': m = new THREE.MeshStandardMaterial({ color: '#4c5036', normalMap: poli.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.82, metalness: 0.02 }); break;
    case 'polimeroTierra': m = new THREE.MeshStandardMaterial({ color: '#8a7656', normalMap: poli.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.85, metalness: 0.02 }); break;
    default: m = new THREE.MeshStandardMaterial({ color: '#333', roughness: 0.6 });
  }
  cacheMat[tipo] = m;
  return m;
}

const cacheGeo = {};
function geometriaPieza(nombre, pz, escala) {
  const clave = nombre + '/' + pz.nombre + '/' + escala;
  if (cacheGeo[clave]) return cacheGeo[clave];
  const aVec = (arr) => { const v = []; for (let i = 0; i < arr.length; i += 2) v.push(new THREE.Vector2(arr[i] * escala, arr[i + 1] * escala)); return v; };
  const shapes = pz.contornos.map((c) => {
    const s = new THREE.Shape(aVec(c.ext));
    for (const h of c.huecos) s.holes.push(new THREE.Path(aVec(h)));
    return s;
  });
  const ancho = pz.ancho * escala;
  const bisel = Math.min(0.0035, ancho * 0.24);
  const fondo = Math.max(0.0005, ancho - 2 * bisel);
  let g = new THREE.ExtrudeGeometry(shapes, { depth: fondo, bevelEnabled: true, bevelThickness: bisel, bevelSize: bisel * 0.8, bevelOffset: -bisel * 0.8, bevelSegments: 3, curveSegments: 2 });
  g.translate(0, 0, -fondo / 2);
  g.rotateY(Math.PI / 2); // x del perfil -> -z (hacia la boca), grosor -> x
  g = toCreasedNormals(g, Math.PI / 5);
  cacheGeo[clave] = g;
  return g;
}

// Devuelve { grupo, anclas } con anclas en coordenadas del modelo (Vector3)
export function crearDesdePerfil(nombre, { escala = 1, materiales = {} } = {}) {
  const P = PERFILES[nombre];
  const G = new THREE.Group();
  for (const pz of P.piezas) {
    const mesh = new THREE.Mesh(geometriaPieza(nombre, pz, escala), materialArma(materiales[pz.nombre] || materiales[pz.mat] || pz.mat));
    mesh.castShadow = true;
    mesh.name = pz.nombre;
    G.add(mesh);
  }
  const a = (p) => new THREE.Vector3(0, p[1] * escala, -p[0] * escala);
  const A = P.anclas;
  return { grupo: G, anclas: { boca: a(A.boca), riel: a(A.riel), alza: a(A.alza), manoIzq: a(A.manoIzq) } };
}

// Qué perfil usa cada arma del arsenal y con qué materiales
export const ARMAS_CON_PERFIL = {
  ak74: { perfil: 'ak' },
  ak12: { perfil: 'ak', materiales: { madera: 'polimero' } },
  m4a1: { perfil: 'm4' },
  bren2: { perfil: 'm4', materiales: { culata: 'polimeroOliva', inferior: 'polimeroOliva', guardamanos: 'polimeroOliva' } },
  glock: { perfil: 'glock' },
  pm: { perfil: 'glock', escala: 0.87, materiales: { armazon: 'acero' } },
};
