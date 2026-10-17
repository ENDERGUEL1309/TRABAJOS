// IA de soldados (solo en partida local): avance por cobertura, detección con línea de visión,
// tiempo de reacción, ráfagas con error de puntería decreciente, RPG contra blindados y fuego antidron.
import * as THREE from 'three';
import { CLASES, equipoPorDefecto, estadisticas } from './arsenal.js';
import { FACCIONES } from './soldado.js';
import { wrapAngle, dampAngle, damp, clamp } from './util.js';

const PUNTOS = [
  new THREE.Vector3(-150, 0, -40), new THREE.Vector3(-150, 0, 60), new THREE.Vector3(-70, 0, -50), new THREE.Vector3(-40, 0, 30),
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, -35), new THREE.Vector3(40, 0, 40), new THREE.Vector3(80, 0, 35),
  new THREE.Vector3(150, 0, -40), new THREE.Vector3(150, 0, 60), new THREE.Vector3(-95, 0, 70), new THREE.Vector3(60, 0, -60),
];

export class IABot {
  constructor(juego, s) {
    this.j = juego;
    this.s = s;
    this.equipar();
    this.objetivo = null;
    this.tPercep = Math.random() * 0.3;
    this.tReaccion = 0;
    this.tRafaga = 0;
    this.balasRafaga = 0;
    this.tCad = 0;
    this.tRecarga = 0;
    this.tAtasco = 0;
    this.destino = this.elegirDestino();
    this.ultimaPos = s.pos.clone();
    this.error = 0.05;
    this.tApuntando = 0;
  }

  // Clase y armas aleatorias en cada despliegue
  equipar() {
    const claves = Object.keys(CLASES);
    const clase = claves[Math.floor(Math.random() * claves.length)];
    const eq = equipoPorDefecto(clase, this.s.faccion);
    const C = CLASES[clase];
    eq.primaria = C.primarias[Math.floor(Math.random() * C.primarias.length)];
    eq.accPrimaria = undefined;
    this.s.setEquipo(eq);
    this.s.clase = clase;
    this.def = estadisticas(eq.primaria);
    this.defEsp = eq.especial ? estadisticas(eq.especial) : null;
    this.cargador = this.def.cargador;
    this.rpg = eq.especial ? 2 : 0;
    this.alcance = this.def.visor ? 380 : 220;
  }

  elegirDestino() {
    const lado = this.s.faccion === 'UA' ? -1 : 1;
    // Preferir puntos de su mitad o del centro, con algo de aleatoriedad
    const lista = this.j.mundo.puntosIA || PUNTOS;
    const cand = this.j.mundo.puntosIA ? lista : lista.filter((p) => p.x * lado > -90 || Math.random() < 0.35);
    const p = cand[Math.floor(Math.random() * cand.length)].clone();
    const disp = this.j.mundo.puntosIA ? 3 : 20;
    p.x += (Math.random() - 0.5) * disp; p.z += (Math.random() - 0.5) * disp;
    return p;
  }

  percibir() {
    const s = this.s, J = this.j;
    const ojo = s.ojos(new THREE.Vector3());
    let mejor = null, dMejor = this.alcance;
    for (const o of J.soldados.values()) {
      if (o === s || !o.vivo || o.faccion === s.faccion) continue;
      let pos = o.pos, alto = 1.2 - o.agachado * 0.45;
      if (o.enVehiculo) continue;
      const d = pos.distanceTo(s.pos);
      if (d > dMejor) continue;
      // Campo de visión frontal amplio; si está muy cerca lo oye
      const ang = Math.abs(wrapAngle(Math.atan2(-(pos.x - s.pos.x), -(pos.z - s.pos.z)) - s.yaw));
      if (ang > 1.6 && d > 15) continue;
      const blanco = new THREE.Vector3(pos.x, pos.y + alto, pos.z);
      if (!J.mundo.lineaVision(ojo, blanco)) continue;
      mejor = { tipo: 'soldado', ent: o, punto: blanco }; dMejor = d;
    }
    for (const v of J.vehiculos) {
      if (v.destruido || !v.conductor) continue;
      const cond = J.soldados.get(v.conductor);
      if (!cond || cond.faccion === s.faccion) continue;
      const d = v.pos.distanceTo(s.pos);
      if (d > 200) continue;
      const blanco = v.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      if (!J.mundo.lineaVision(ojo, blanco)) continue;
      if (!mejor || d < dMejor * 1.3) { mejor = { tipo: 'vehiculo', ent: v, punto: blanco }; dMejor = d; }
    }
    for (const dr of J.drones.values()) {
      if (!dr.vivo || dr.faccion === s.faccion) continue;
      const d = dr.pos.distanceTo(s.pos);
      if (d > 70) continue;
      if (!J.mundo.lineaVision(ojo, dr.pos)) continue;
      mejor = { tipo: 'dron', ent: dr, punto: dr.pos.clone() }; dMejor = d;
    }
    if (mejor && (!this.objetivo || this.objetivo.ent !== mejor.ent)) {
      this.tReaccion = 0.45 + Math.random() * 0.6 + dMejor / 400;
      this.error = 0.035 + dMejor / 3000;
      this.tApuntando = 0;
    }
    this.objetivo = mejor;
  }

  update(dt) {
    const s = this.s, J = this.j;
    if (!s.vivo) return;
    this.tPercep -= dt;
    if (this.tPercep <= 0) { this.tPercep = 0.3; this.percibir(); }
    let mx = 0, mz = 0, correr = false;
    s.quiereAgachar = false;
    if (this.tRecarga > 0) {
      this.tRecarga -= dt;
      if (this.tRecarga <= 0) { this.cargador = this.def.cargador; if (s.arma === 'especial') s.setArma('primaria'); }
    }
    const obj = this.objetivo;
    if (obj) {
      // Actualizar punto de mira con la posición actual
      if (obj.tipo === 'soldado') obj.punto.set(obj.ent.pos.x, obj.ent.pos.y + 1.25 - obj.ent.agachado * 0.45, obj.ent.pos.z);
      else if (obj.tipo === 'vehiculo') obj.punto.copy(obj.ent.pos).y += 1.2;
      else obj.punto.copy(obj.ent.pos);
      const dx = obj.punto.x - s.pos.x, dz = obj.punto.z - s.pos.z;
      const ojo = s.ojos(new THREE.Vector3());
      const dh = Math.hypot(dx, dz);
      const yawObj = Math.atan2(-dx, -dz);
      const pitchObj = Math.atan2(obj.punto.y - ojo.y, dh) + (obj.tipo === 'vehiculo' && this.rpg > 0 ? dh * dh * 0.0000035 * 9.8 : 0);
      s.yaw = dampAngle(s.yaw, yawObj, 6, dt);
      s.pitch = damp(s.pitch, pitchObj, 6, dt);
      s.quiereAgachar = dh > 25 && obj.tipo !== 'dron';
      this.tApuntando += dt;
      this.tReaccion -= dt;
      if (obj.tipo === 'vehiculo' && this.rpg > 0 && s.arma !== 'especial' && this.tRecarga <= 0) s.setArma('especial');
      if (obj.tipo !== 'vehiculo' && s.arma === 'especial') s.setArma('primaria');
      if (this.tReaccion <= 0 && this.tRecarga <= 0 && Math.abs(wrapAngle(yawObj - s.yaw)) < 0.12) this.disparar(dt, obj);
      // Movimiento lateral leve si está de pie
      if (!s.quiereAgachar) { const lat = Math.sin(J.tiempo * 0.9 + s.id.length) * 0.5; mx = Math.cos(s.yaw) * lat; mz = -Math.sin(s.yaw) * lat; }
    } else {
      if (s.arma === 'especial') s.setArma('primaria');
      const dx = this.destino.x - s.pos.x, dz = this.destino.z - s.pos.z, d = Math.hypot(dx, dz);
      if (d < 4) this.destino = this.elegirDestino();
      else {
        mx = dx / d; mz = dz / d;
        correr = d > 40;
        s.yaw = dampAngle(s.yaw, Math.atan2(-dx, -dz), 4, dt);
        s.pitch = damp(s.pitch, 0, 3, dt);
      }
      // Atasco: elegir otro destino
      this.tAtasco += dt;
      if (this.tAtasco > 2) {
        if (s.pos.distanceTo(this.ultimaPos) < 1.5) this.destino = this.elegirDestino();
        this.ultimaPos.copy(s.pos); this.tAtasco = 0;
      }
    }
    J.moverSoldado(s, mx, mz, correr ? 5.2 : obj ? 1.2 : 3.0, dt, false);
  }

  disparar(dt, obj) {
    const s = this.s, J = this.j;
    this.tCad -= dt;
    if (this.tCad > 0) return;
    if (s.arma === 'especial') {
      if (obj.ent.pos.distanceTo(s.pos) > 160 || this.tApuntando < 1.2) return;
      this.rpg--;
      J.dispararSoldado(s, this.defEsp, this.error * 0.6, 'especial');
      this.tRecarga = 4.5;
      this.tCad = 1;
      return;
    }
    if (this.balasRafaga <= 0) {
      this.tRafaga -= dt;
      if (this.tRafaga > 0) return;
      this.balasRafaga = this.def.auto ? 3 + Math.floor(Math.random() * 5) : 1;
    }
    this.balasRafaga--;
    if (this.balasRafaga <= 0) this.tRafaga = this.def.auto ? 0.4 + Math.random() * 0.8 : Math.max(0.6, 60 / this.def.cadencia);
    this.tCad = 60 / this.def.cadencia;
    // El error se reduce cuanto más tiempo lleva apuntando
    const err = this.error * clamp(1.6 - this.tApuntando * 0.35, 0.35, 1.6);
    J.dispararSoldado(s, this.def, err * (this.def.visor ? 0.35 : 1), 'primaria');
    this.cargador--;
    if (this.cargador <= 0) { this.tRecarga = this.def.recarga; }
  }
}
