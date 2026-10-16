// Aeronaves: helicóptero de ataque Mi-24 y avión de ataque a tierra Su-25.
// Física arcade-realista, armas fijas (cañón, cohetes S-8, bombas FAB-250), daño y estrellamiento.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './texturas.js';
import { clamp, damp, segOBB, pushCircleAABB } from './util.js';

const G = 9.81;

export const ARMAS_AIRE = {
  yakb: { nombre: 'YakB-12,7', tipo: 'bala', cadencia: 1100, vel: 810, danoSold: 100, dano: { pesado: 2, ligero: 25, ninguno: 45 }, trazadora: 3, calibre: 2 },
  gsh30: { nombre: 'GSh-30-2', tipo: 'bala', cadencia: 900, vel: 870, danoSold: 150, dano: { pesado: 18, ligero: 90, ninguno: 150 }, trazadora: 2, calibre: 3.5, explota: true, radio: 4 },
  s8: { nombre: 'Cohete S-8', tipo: 'cohete', vel: 420, velMax: 600, danoSold: 200, dano: { pesado: 230, ligero: 600, ninguno: 700 }, radio: 8, explota: true, calibre: 3 },
  fab250: { nombre: 'Bomba FAB-250', tipo: 'bomba', vel: 1, danoSold: 320, dano: { pesado: 1200, ligero: 1200, ninguno: 1200 }, radio: 26, explota: true, calibre: 5 },
};

export const TIPOS_AIRE = {
  heli: {
    nombre: { UA: 'Mi-24V', RU: 'Mi-24P' }, vida: 750, blindaje: 'ligero', largo: 17, ancho: 3, alto: 4.2,
    medio: new THREE.Vector3(1.3, 1.5, 8.5), centro: new THREE.Vector3(0, 2.2, 1.5),
    cam3: { dist: 24, alto: 7 }, armas: { canon: 'yakb' }, cohetes: 40, canon: 700, bombas: 0,
    bocaCanon: new THREE.Vector3(0, 1.0, -8.6), bocaCohetes: new THREE.Vector3(2.6, 1.5, -1.5), cabina: new THREE.Vector3(0, 2.75, -5.2),
    reaparicion: 120,
  },
  avion: {
    nombre: { UA: 'Su-25', RU: 'Su-25SM3' }, vida: 650, blindaje: 'ligero', largo: 15.5, ancho: 14.4, alto: 4.8,
    medio: new THREE.Vector3(3.5, 1.3, 7.6), centro: new THREE.Vector3(0, 2.0, 0.3),
    cam3: { dist: 30, alto: 7 }, armas: { canon: 'gsh30' }, cohetes: 40, canon: 250, bombas: 4,
    bocaCanon: new THREE.Vector3(0.4, 1.6, -7.8), bocaCohetes: new THREE.Vector3(4.2, 1.2, -0.5), cabina: new THREE.Vector3(0, 2.75, -4.4),
    reaparicion: 150,
  },
};

function cil(r1, r2, l, x, y, z, seg = 14) { return new THREE.CylinderGeometry(r1, r2, l, seg).rotateX(Math.PI / 2).translate(x, y, z); }
function caja(w, h, d, x, y, z) { return new THREE.BoxGeometry(w, h, d).translate(x, y, z); }
function malla(geos, mat) {
  const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function materiales(faccion) {
  return {
    piel: new THREE.MeshStandardMaterial({ map: TX.texBlindaje(faccion === 'UA' ? '#5c6248' : '#646a5c', 'aire_' + faccion), roughness: 0.6, metalness: 0.4 }),
    oscuro: new THREE.MeshStandardMaterial({ color: '#2a2b2a', roughness: 0.6, metalness: 0.5 }),
    vidrio: new THREE.MeshStandardMaterial({ color: '#1d2a30', roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.55 }),
    pala: new THREE.MeshStandardMaterial({ color: '#1e1f1e', roughness: 0.7 }),
  };
}

function construirMi24(M) {
  const raiz = new THREE.Group();
  const P = [], O = [];
  P.push(new THREE.CylinderGeometry(1.0, 1.05, 9, 16).rotateX(Math.PI / 2).scale(0.85, 1, 1).translate(0, 2.1, -0.5));
  P.push(new THREE.CylinderGeometry(0.15, 0.9, 3.2, 16).rotateX(-Math.PI / 2).scale(0.85, 0.8, 1).translate(0, 1.8, -6.6));
  P.push(cil(0.32, 0.5, 8, 0, 2.5, 7.4, 12));                      // botalón de cola
  P.push(caja(0.18, 2.4, 1.6, 0.0, 3.6, 11.2));                      // deriva
  P.push(caja(3.2, 0.12, 0.9, 0, 2.5, 10.2));                        // estabilizador
  P.push(caja(6.2, 0.18, 1.5, 0, 1.75, -0.6));                       // alas cortas
  P.push(cil(0.42, 0.42, 3.2, -0.75, 3.1, -0.6), cil(0.42, 0.42, 3.2, 0.75, 3.1, -0.6)); // motores
  P.push(caja(1.4, 0.7, 2.4, 0, 3.25, 0.8));                         // carenado del rotor
  for (const x of [-2.6, -1.6, 1.6, 2.6]) O.push(cil(0.28, 0.28, 1.7, x, 1.35, -0.7, 10)); // contenedores de cohetes
  O.push(cil(0.12, 0.12, 0.25, 0, 3.95, -0.5, 8).rotateX(Math.PI / 2));
  O.push(new THREE.SphereGeometry(0.28, 10, 8).translate(0, 1.05, -7.6), cil(0.04, 0.04, 1.0, 0, 1.0, -8.1, 6)); // torreta de morro
  for (const [x, z] of [[-1.3, 0.8], [1.3, 0.8], [0, -5.6]]) O.push(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10).rotateZ(Math.PI / 2).translate(x, 0.32, z));
  raiz.add(malla(P, M.piel), malla(O, M.oscuro));
  // Cabinas en tándem
  const cab = [new THREE.SphereGeometry(0.75, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.9, 0.8, 1.3).translate(0, 2.35, -6.0),
    new THREE.SphereGeometry(0.75, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.9, 0.9, 1.3).translate(0, 2.7, -4.4)];
  raiz.add(malla(cab, M.vidrio));
  // Rotor principal (5 palas) y de cola
  const rotor = new THREE.Group(); rotor.position.set(0, 4.05, -0.5);
  const palas = [];
  for (let i = 0; i < 5; i++) palas.push(new THREE.BoxGeometry(0.45, 0.06, 8.6).translate(0, 0, 4.3).rotateY((i * Math.PI * 2) / 5));
  rotor.add(malla(palas, M.pala));
  const disco = new THREE.Mesh(new THREE.CircleGeometry(8.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#202020', transparent: true, opacity: 0.12, depthWrite: false }));
  rotor.add(disco);
  raiz.add(rotor);
  const rotorCola = new THREE.Group(); rotorCola.position.set(0.3, 3.6, 11.5);
  rotorCola.add(malla([new THREE.BoxGeometry(0.05, 3.8, 0.25), new THREE.BoxGeometry(0.05, 0.25, 3.8)], M.pala));
  raiz.add(rotorCola);
  return { raiz, rotor, rotorCola, disco };
}

function construirSu25(M) {
  const raiz = new THREE.Group();
  const P = [], O = [];
  P.push(new THREE.CylinderGeometry(0.85, 0.75, 10, 16).rotateX(Math.PI / 2).translate(0, 2.1, 0.5));
  P.push(new THREE.CylinderGeometry(0.06, 0.85, 3.2, 16).rotateX(-Math.PI / 2).translate(0, 2.0, -6.0));
  P.push(cil(0.6, 0.55, 6, -1.15, 1.95, 1.4), cil(0.6, 0.55, 6, 1.15, 1.95, 1.4)); // góndolas de motor
  // Alas trapezoidales
  const ala = new THREE.Shape();
  ala.moveTo(0, -1.6); ala.lineTo(7.2, -0.3); ala.lineTo(7.2, 0.9); ala.lineTo(0, 1.6); ala.lineTo(0, -1.6);
  for (const s of [1, -1]) {
    const g = new THREE.ExtrudeGeometry(ala, { depth: 0.16, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 1.95, 0.6);
    if (s < 0) g.scale(-1, 1, 1);
    P.push(g);
  }
  P.push(caja(0.18, 3.0, 2.4, 0, 3.6, 6.4));        // deriva
  P.push(caja(5.6, 0.12, 1.6, 0, 2.6, 6.6));        // estabilizadores
  for (const x of [-4.2, -3.0, 3.0, 4.2]) O.push(cil(0.27, 0.27, 2.0, x, 1.45, 0.3, 10)); // contenedores S-8
  for (const x of [-2.0, 2.0]) O.push(cil(0.2, 0.28, 2.2, x, 1.45, 0.6, 10));            // bombas
  O.push(cil(0.5, 0.5, 0.2, -1.15, 1.95, 4.45), cil(0.5, 0.5, 0.2, 1.15, 1.95, 4.45));
  for (const [x, z] of [[-1.8, 1.2], [1.8, 1.2], [0, -4.6]]) O.push(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10).rotateZ(Math.PI / 2).translate(x, 0.3, z), caja(0.1, 1.2, 0.1, x, 0.9, z));
  raiz.add(malla(P, M.piel), malla(O, M.oscuro));
  raiz.add(malla([new THREE.SphereGeometry(0.6, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.9, 0.8, 2.2).translate(0, 2.75, -4.0)], M.vidrio));
  return { raiz };
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Aeronave {
  constructor(juego, { id, tipo, faccion, x, z, yaw }) {
    this.juego = juego;
    this.id = id;
    this.tipo = tipo;
    this.aereo = true;
    this.def = TIPOS_AIRE[tipo];
    this.faccion = faccion;
    this.nombre = this.def.nombre[faccion];
    this.spawn = { x, z, yaw };
    this.M = materiales(faccion);
    Object.assign(this, tipo === 'heli' ? construirMi24(this.M) : construirSu25(this.M));
    this.raiz.traverse((o) => { o.userData.vehiculo = this; });
    juego.scene.add(this.raiz);
    // Plataforma de despegue
    const plat = new THREE.Mesh(new THREE.BoxGeometry(this.tipo === 'heli' ? 22 : 18, 0.3, this.tipo === 'heli' ? 22 : 24), new THREE.MeshStandardMaterial({ map: TX.texHormigon(), roughness: 0.95, color: '#9a978e' }));
    plat.position.set(x, juego.mundo.getHeight(x, z) + 0.02, z);
    plat.receiveShadow = true;
    juego.scene.add(plat);
    this.yPlataforma = plat.position.y + 0.15;
    this.reiniciar();
  }

  reiniciar() {
    const { x, z, yaw } = this.spawn;
    this.pos = new THREE.Vector3(x, this.yPlataforma, z);
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.w = new THREE.Vector3();
    this.enVuelo = false;
    this.gas = 0;
    this.giroRotor = 0;
    this.rpmRotor = 0;
    this.vida = this.def.vida;
    this.destruido = false;
    this.tDestruido = 0;
    this.conductor = null;
    this.local = false;
    this.tCad = 0; this.tCohete = 0;
    this.municion = { canon: this.def.canon, cohetes: this.def.cohetes, bombas: this.def.bombas };
    this.torYaw = 0;
    this.velActual = 0;
    this.raiz.visible = true;
    this.raiz.traverse((o) => { if (o.isMesh && o.userData.matOrig) o.material = o.userData.matOrig; });
    this.colocar();
  }

  get yaw() { return _e.setFromQuaternion(this.q, 'YXZ').y; }
  adelante(out) { return out.set(0, 0, -1).applyQuaternion(this.q); }
  puntoMundo(local) { return local.clone().applyQuaternion(this.q).add(this.pos); }
  rpm() { return this.tipo === 'heli' ? 0.4 + this.rpmRotor * 0.6 : 0.3 + this.gas * 0.7; }

  colocar() {
    this.raiz.position.copy(this.pos);
    this.raiz.quaternion.copy(this.q);
    this.raiz.updateMatrixWorld(true);
  }

  // Despegue del avión en el aire (arranque en vuelo) al subir; el helicóptero arranca rotores
  alSubir() {
    this.local = true;
    if (this.tipo === 'avion' && !this.enVuelo) {
      const yaw = this.spawn.yaw;
      this.pos.set(this.spawn.x + Math.sin(yaw) * 400, this.juego.mundo.getHeight(this.spawn.x, this.spawn.z) + 260, this.spawn.z);
      this.q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
      this.vel.set(0, 0, -1).applyQuaternion(this.q).multiplyScalar(85);
      this.gas = 0.5;
      this.enVuelo = true;
    }
  }

  alBajar() { this.local = false; }

  // ctrl: { dAcel, dSubir, dGuinada, dCabeceo, dAlabeo } o null (sin piloto)
  simular(dt, ctrl) {
    if (this.destruido) return null;
    const W = this.juego.mundo;
    const prev = this.pos.clone();
    if (this.tipo === 'heli') this.fisicaHeli(dt, ctrl); else this.fisicaAvion(dt, ctrl);
    this.velActual = this.vel.length();
    // Colisión con el terreno y los edificios
    const suelo = W.getHeight(this.pos.x, this.pos.z);
    const enPlataforma = Math.hypot(this.pos.x - this.spawn.x, this.pos.z - this.spawn.z) < 10;
    const base = Math.max(suelo, enPlataforma ? this.yPlataforma : -Infinity);
    let choque = false;
    const hit = this.velActual > 1 ? W.segmento(prev.clone().setY(prev.y + 1.5), this.pos.clone().setY(this.pos.y + 1.5), 2, true) : null;
    if (hit && hit.mat !== 'tierra') choque = this.velActual > 12;
    if (this.pos.y < base) {
      const inclinacion = 1 - new THREE.Vector3(0, 1, 0).applyQuaternion(this.q).y;
      if (this.tipo === 'avion' || this.vel.y < -7 || inclinacion > 0.25 || Math.hypot(this.vel.x, this.vel.z) > 18) choque = true;
      this.pos.y = base;
      this.vel.y = Math.max(0, this.vel.y);
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      this.enVuelo = false;
    } else if (this.pos.y > base + 0.4) this.enVuelo = true;
    if (Math.abs(this.pos.x) > 1180 || Math.abs(this.pos.z) > 1180) {
      // Límite del mapa: girar de vuelta
      this.pos.x = clamp(this.pos.x, -1180, 1180); this.pos.z = clamp(this.pos.z, -1180, 1180);
      this.vel.x *= -0.5; this.vel.z *= -0.5;
    }
    this.animar(dt);
    this.colocar();
    if (choque) {
      if (!ctrl) this.juego.aplicarDanoVehiculo(this, 99999, null);
      return { choque: true };
    }
    // Polvo del rotor cerca del suelo
    if (this.tipo === 'heli' && this.rpmRotor > 0.5 && this.pos.y - suelo < 15) {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * 6.28;
        this.juego.efectos.polvoVehiculo(new THREE.Vector3(this.pos.x + Math.cos(a) * 8, suelo, this.pos.z + Math.sin(a) * 8), 0.5 * (1 - (this.pos.y - suelo) / 15));
      }
    }
    if (this.vida < this.def.vida * 0.4) this.juego.efectos.escape(this.pos.clone().add(new THREE.Vector3(0, 3, 0)), 0.8);
    return null;
  }

  fisicaHeli(dt, c) {
    const conPiloto = !!c;
    this.rpmRotor = damp(this.rpmRotor, conPiloto || this.enVuelo ? 1 : 0, 1.8, dt);
    _e.setFromQuaternion(this.q, 'YXZ');
    const pitchObj = conPiloto ? -c.dCabeceo * 0.42 : 0, rollObj = conPiloto ? -c.dAlabeo * 0.5 : 0;
    _e.x = damp(_e.x, pitchObj, 2.5, dt);
    _e.z = damp(_e.z, rollObj, 2.5, dt);
    _e.y += (conPiloto ? -c.dGuinada * 1.0 : 0) * dt + (rollObj * 0.6) * dt;
    this.q.setFromEuler(_e);
    if (!this.enVuelo && (!conPiloto || c.dSubir <= 0.05 || this.rpmRotor < 0.8)) { this.vel.set(0, 0, 0); return; }
    const arriba = _v.set(0, 1, 0).applyQuaternion(this.q);
    const vyObj = conPiloto ? c.dSubir * 11 : -6; // sin piloto: autorrotación
    const ax = arriba.x * G * 1.7 - this.vel.x * 0.09;
    const az = arriba.z * G * 1.7 - this.vel.z * 0.09;
    const ay = (vyObj - this.vel.y) * 2.2 * this.rpmRotor;
    this.vel.x += ax * dt; this.vel.y += ay * dt; this.vel.z += az * dt;
    this.pos.addScaledVector(this.vel, dt);
  }

  fisicaAvion(dt, c) {
    if (!this.enVuelo && !c) { this.vel.set(0, 0, 0); return; }
    if (c) this.gas = clamp(c.dAcel, 0, 1);
    const obj = new THREE.Vector3(c ? -c.dCabeceo * 1.1 : -0.15, c ? -c.dGuinada * 0.35 : 0, c ? -c.dAlabeo * 2.4 : 0);
    this.w.lerp(obj, 1 - Math.exp(-dt / 0.12));
    const ang = this.w.length() * dt;
    if (ang > 0) this.q.multiply(_q.setFromAxisAngle(_v.copy(this.w).normalize(), ang)).normalize();
    const fwd = this.adelante(new THREE.Vector3());
    let v = this.vel.length();
    // Velocidad máxima ~160 m/s (575 km/h); con gas al 50 % unos 115 m/s
    v += (this.gas * 9 - 0.00035 * v * v - G * fwd.y) * dt;
    v = Math.max(0, v);
    const alinear = clamp((v - 22) / 45, 0, 1) * 2.8;
    this.vel.lerp(fwd.multiplyScalar(v), 1 - Math.exp(-alinear * dt)).setLength(v);
    const sustentacion = clamp((v - 32) / 35, 0, 1);
    this.vel.y -= G * (1 - sustentacion) * dt;
    this.pos.addScaledVector(this.vel, dt);
  }

  animar(dt) {
    if (this.rotor) {
      this.giroRotor += dt * this.rpmRotor * 28;
      this.rotor.rotation.y = this.giroRotor;
      this.rotorCola.rotation.x = this.giroRotor * 1.6;
      this.disco.material.opacity = 0.05 + this.rpmRotor * 0.15;
      this.rotor.children[0].visible = this.rpmRotor < 0.85; // a alta velocidad solo se ve el disco
    }
  }

  aplicarRed(s, dt) {
    const k = 1 - Math.exp(-12 * dt);
    this.pos.lerp(_v.set(s.p[0], s.p[1], s.p[2]), k);
    this.q.slerp(_q.set(s.q[0], s.q[1], s.q[2], s.q[3]), k);
    this.vel.set(s.v[0], s.v[1], s.v[2]);
    this.gas = s.g; this.enVuelo = !!s.f;
    this.rpmRotor = damp(this.rpmRotor, 1, 1, dt);
    this.velActual = this.vel.length();
    this.animar(dt);
    this.colocar();
  }

  estadoRed() {
    const r = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
    return { id: this.id, p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], q: [r3(this.q.x), r3(this.q.y), r3(this.q.z), r3(this.q.w)], v: [r(this.vel.x), r(this.vel.y), r(this.vel.z)], g: r(this.gas), f: this.enVuelo ? 1 : 0 };
  }

  impacto(a, b) {
    if (!this.raiz.visible) return null;
    const h = segOBB(a, b, this.raiz.matrixWorld, this.def.medio, this.def.centro);
    if (!h) return null;
    return { t: h.t, n: new THREE.Vector3(h.nx, h.ny, h.nz).transformDirection(this.raiz.matrixWorld) };
  }

  empujarSoldado(p, r) {
    if (!this.raiz.visible || this.enVuelo) return false;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (dx * dx + dz * dz > 120) return false;
    const yaw = this.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const q = { x: dx * c - dz * s, z: dx * s + dz * c };
    const m = this.def.medio;
    if (!pushCircleAABB(q, r, { min: { x: -1.2, z: -m.z }, max: { x: 1.2, z: m.z } })) return false;
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
    this.enLlamas = this.enVuelo;
    const quemado = new THREE.MeshStandardMaterial({ color: '#1c1916', roughness: 0.95, metalness: 0.3 });
    this.raiz.traverse((o) => { if (o.isMesh) { if (!o.userData.matOrig) o.userData.matOrig = o.material; o.material = quemado; } });
    const J = this.juego;
    J.efectos.explosion(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), 2);
    J.audio.explosion(this.pos, 3);
    if (this.sonido) this.sonido.set(this.pos, 0, 0);
  }

  actualizarDestruido(dt) {
    this.tDestruido += dt;
    const W = this.juego.mundo;
    if (this.enLlamas) {
      // Cae en barrena hasta el suelo
      this.vel.y -= G * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.q.multiply(_q.setFromAxisAngle(_v.set(0, 1, 0.3).normalize(), dt * 2)).normalize();
      this.juego.efectos.estela(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), true);
      const h = W.getHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= h) {
        this.pos.y = h; this.vel.set(0, 0, 0); this.enLlamas = false;
        this.juego.efectos.explosion(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), 2.2);
        this.juego.audio.explosion(this.pos, 3);
        this.juego.mundo.crater(this.pos.x, this.pos.z, 4, 1.2);
        this.foco = this.juego.efectos.addFoco(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 1.2);
      }
      this.colocar();
    }
    if (this.tDestruido > this.def.reaparicion) {
      const F = this.juego.efectos.focos;
      const i = F.findIndex((f) => f.p.distanceTo(this.pos) < 3);
      if (i >= 0) F.splice(i, 1);
      this.reiniciar();
      return true;
    }
    return false;
  }
}
