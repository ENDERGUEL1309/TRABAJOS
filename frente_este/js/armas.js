// Armas de infantería: datos, vista en primera persona (estilo cámara corporal) y proyectiles balísticos.
import * as THREE from 'three';
import { crearFusil, crearRPG, crearBrazos, crearCohete } from './modelos.js';
import { damp, clamp } from './util.js';

export const ARMAS = {
  ak74: {
    nombre: 'AK-74M', municion: '5,45×39', cadencia: 650, vel: 880, danoSold: 34, cargador: 30, cargadores: 6, recarga: 2.6,
    retroceso: 0.016, dispCadera: 0.03, dispMira: 0.0018, fov: 56, trazadora: 4, calibre: 1,
    dano: { pesado: 0, ligero: 0.5, ninguno: 5 },
  },
  ak12: {
    nombre: 'AK-12', municion: '5,45×39', cadencia: 700, vel: 900, danoSold: 33, cargador: 30, cargadores: 6, recarga: 2.5,
    retroceso: 0.015, dispCadera: 0.03, dispMira: 0.0016, fov: 56, trazadora: 4, calibre: 1,
    dano: { pesado: 0, ligero: 0.5, ninguno: 5 },
  },
  rpg7: {
    nombre: 'RPG-7', municion: 'PG-7VL', cohete: true, vel: 115, velMax: 295, cargador: 1, cargadores: 3, recarga: 4.2,
    retroceso: 0.05, dispCadera: 0.02, dispMira: 0.004, fov: 50, danoSold: 200, radio: 7,
    dano: { pesado: 600, ligero: 800, ninguno: 800 },
  },
};

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

// ---------- Vista en primera persona del jugador local ----------
export class ArmaLocal {
  constructor(juego, faccion, primaria) {
    this.juego = juego;
    this.grupo = new THREE.Group();          // hijo de la cámara
    this.fusil = crearFusil(primaria);
    this.rpg = crearRPG(true);
    this.brazos = crearBrazos(faccion);
    this.portaFusil = new THREE.Group(); this.portaFusil.add(this.fusil, this.brazos);
    this.portaRPG = new THREE.Group(); this.portaRPG.add(this.rpg);
    const brazosRPG = crearBrazos(faccion, new THREE.Vector3(0, 0.0, -0.2)); this.portaRPG.add(brazosRPG);
    this.grupo.add(this.portaFusil, this.portaRPG);
    this.grupo.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    this.defs = { fusil: ARMAS[primaria], rpg: ARMAS.rpg7 };
    this.estado = {
      fusil: { cargador: ARMAS[primaria].cargador, reserva: ARMAS[primaria].cargador * (ARMAS[primaria].cargadores - 1) },
      rpg: { cargador: 1, reserva: ARMAS.rpg7.cargadores - 1 },
    };
    this.actual = 'fusil';
    this.apuntado = 0;
    this.tCad = 0;
    this.recargando = 0;
    this.cambiando = 0;
    this.retro = 0; this.retroRot = 0;
    this.balanceo = new THREE.Vector2();
    this.fase = 0;
    this.disparos = 0;
    this.sprint = 0;
    // Fogonazo en primera persona
    const fm = new THREE.SpriteMaterial({ map: juego.texFogonazo, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ffcf90' });
    this.fogonazo = new THREE.Sprite(fm);
    this.fogonazo.scale.setScalar(0.25);
    this.fogonazo.visible = false;
    this.grupo.add(this.fogonazo);
    this.tFog = 0;
    this.setArma('fusil', true);
  }

  get def() { return this.defs[this.actual]; }
  get est() { return this.estado[this.actual]; }

  setArma(a, inmediato = false) {
    if (a === this.actual && !inmediato) return;
    this.actual = a;
    this.cambiando = inmediato ? 0 : 0.6;
    this.recargando = 0;
    this.portaFusil.visible = a === 'fusil';
    this.portaRPG.visible = a === 'rpg';
    this.rpg.userData.granada.visible = this.estado.rpg.cargador > 0;
  }

  reponer() {
    for (const k of ['fusil', 'rpg']) {
      const d = this.defs[k];
      this.estado[k].cargador = d.cargador;
      this.estado[k].reserva = d.cargador * (d.cargadores - 1);
    }
    this.rpg.userData.granada.visible = true;
  }

  recargar() {
    const e = this.est, d = this.def;
    if (this.recargando > 0 || e.reserva <= 0 || e.cargador >= d.cargador) return;
    this.recargando = d.recarga;
    this.juego.audio.recarga();
  }

  // Devuelve un disparo {origen, dir, def} si se dispara este fotograma
  update(dt, entrada, soldado, camara, moviendo, corriendo) {
    const d = this.def, e = this.est;
    this.tCad -= dt;
    this.cambiando = Math.max(0, this.cambiando - dt);
    if (this.recargando > 0) {
      this.recargando -= dt;
      if (this.recargando <= 0) {
        const n = Math.min(d.cargador - e.cargador, e.reserva);
        e.cargador += n; e.reserva -= n;
        if (this.actual === 'rpg') this.rpg.userData.granada.visible = true;
      }
    }
    const quiereApuntar = entrada.apuntar && !corriendo && this.recargando <= 0 && this.cambiando <= 0;
    this.apuntado = damp(this.apuntado, quiereApuntar ? 1 : 0, 12, dt);
    this.sprint = damp(this.sprint, corriendo ? 1 : 0, 8, dt);
    let disparo = null;
    if (entrada.disparar && !corriendo && this.recargando <= 0 && this.cambiando <= 0 && this.tCad <= 0) {
      if (e.cargador > 0) {
        e.cargador--;
        this.tCad = d.cohete ? 0.8 : 60 / d.cadencia;
        this.disparos++;
        disparo = this.generarDisparo(camara, moviendo);
        if (d.cohete) { this.rpg.userData.granada.visible = false; this.retro = 0.25; this.retroRot = 0.12; }
        else { this.retro = 0.05; this.retroRot = 0.05; }
        this.tFog = 0.04;
      } else {
        this.tCad = 0.3;
        this.juego.audio.clic(this.juego.audio.ctx?.currentTime || 0, 900, 0.3);
        this.recargar();
      }
    }
    if (!entrada.disparar && d.cohete) this.tCad = Math.min(this.tCad, 0);
    this.animar(dt, moviendo, corriendo, soldado);
    return disparo;
  }

  generarDisparo(camara, moviendo) {
    const d = this.def;
    const disp = (this.apuntado > 0.7 ? d.dispMira : d.dispCadera) * (moviendo ? 1.8 : 1);
    // Origen: boca del arma; dirección: centro de cámara (convergencia) con dispersión
    const boca = (this.actual === 'fusil' ? this.fusil : this.rpg).userData.boca;
    const origen = new THREE.Vector3(); boca.getWorldPosition(origen);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camara.quaternion);
    // Punto de convergencia a 100 m (o el primer obstáculo) para que el disparo vaya al centro
    const ojo = camara.getWorldPosition(new THREE.Vector3());
    const objetivo = ojo.clone().addScaledVector(dir, 100);
    const h = this.juego.mundo.segmento(ojo, objetivo, 2);
    if (h && h.t * 100 > 2) objetivo.copy(h.p);
    const real = objetivo.sub(origen).normalize();
    // Si el arma está metida en una pared, disparar desde el ojo
    if (this.juego.mundo.segmento(ojo, origen, 0.5)) origen.copy(ojo);
    real.x += (Math.random() - 0.5) * 2 * disp; real.y += (Math.random() - 0.5) * 2 * disp; real.z += (Math.random() - 0.5) * 2 * disp;
    real.normalize();
    return { origen, dir: real, def: d, arma: this.actual };
  }

  animar(dt, moviendo, corriendo, soldado) {
    const d = this.def;
    this.retro = damp(this.retro, 0, 14, dt);
    this.retroRot = damp(this.retroRot, 0, 10, dt);
    this.fase += dt * (moviendo ? (corriendo ? 11 : 7.5) : 1.2);
    const ampMov = moviendo ? (corriendo ? 1.6 : 1) : 0.15;
    const ap = this.apuntado;
    // Posición de cadera (cámara corporal: arma baja y a la derecha) vs. apuntando (mira centrada)
    const arma = this.actual === 'fusil' ? this.fusil : this.rpg;
    const mira = arma.userData.mira.position;
    const cadera = this.actual === 'fusil' ? new THREE.Vector3(0.15, -0.23, -0.46) : new THREE.Vector3(0.2, -0.14, -0.36);
    const ojo = new THREE.Vector3(-mira.x, -mira.y, this.actual === 'fusil' ? -0.26 : -0.14);
    const p = cadera.lerp(ojo, ap);
    const bob = 1 - ap * 0.85;
    p.x += Math.sin(this.fase) * 0.012 * ampMov * bob + this.balanceo.x * 0.02 * bob;
    p.y += -Math.abs(Math.cos(this.fase)) * 0.014 * ampMov * bob + this.balanceo.y * 0.02 * bob;
    p.z += this.retro;
    // Sprint: arma cruzada hacia abajo
    p.x -= this.sprint * 0.08; p.y -= this.sprint * 0.08;
    // Cambio / recarga: el arma baja
    const bajar = Math.max(this.cambiando > 0 ? Math.sin((this.cambiando / 0.6) * Math.PI) : 0, this.recargando > 0 ? Math.min(1, Math.sin((this.recargando / d.recarga) * Math.PI) * 1.4) : 0);
    p.y -= bajar * 0.15;
    const porta = this.actual === 'fusil' ? this.portaFusil : this.portaRPG;
    porta.position.copy(p);
    porta.rotation.set(this.retroRot + bajar * 0.5 - this.sprint * 0.3, this.sprint * 0.9 + this.balanceo.x * 0.05 * bob, (this.recargando > 0 ? bajar * 0.6 : 0) + this.sprint * 0.3);
    this.balanceo.multiplyScalar(Math.exp(-6 * dt));
    // Fogonazo
    this.tFog -= dt;
    if (this.tFog > 0) {
      const b = new THREE.Vector3(); arma.userData.boca.getWorldPosition(b);
      this.grupo.worldToLocal(b);
      this.fogonazo.position.copy(b);
      this.fogonazo.material.rotation = Math.random() * 6.28;
      this.fogonazo.scale.setScalar(this.actual === 'rpg' ? 0.6 : 0.18 + Math.random() * 0.1);
      this.fogonazo.visible = true;
    } else this.fogonazo.visible = false;
  }

  // Inercia del arma al girar la vista
  inercia(dx, dy) {
    this.balanceo.x = clamp(this.balanceo.x - dx * 0.002, -1, 1);
    this.balanceo.y = clamp(this.balanceo.y + dy * 0.002, -1, 1);
  }
}

// ---------- Proyectiles ----------
export class Proyectiles {
  constructor(juego) {
    this.juego = juego;
    this.lista = [];
    this.cohetes = [];
  }

  // p: {origen, dir, vel, duenoId, faccion, danoSold, dano:{...}, tipo:'bala'|'cohete'|'obus', radio, explota, trazadora, calibre, local}
  disparar(p) {
    const b = {
      pos: p.origen.clone(), vel: p.dir.clone().multiplyScalar(p.vel), tipo: p.tipo || 'bala', vida: p.tipo === 'cohete' ? 6 : 4,
      duenoId: p.duenoId, faccion: p.faccion, danoSold: p.danoSold, dano: p.dano, radio: p.radio || 0, explota: !!p.explota,
      trazadora: !!p.trazadora, local: !!p.local, velMax: p.velMax || 0, recorrido: 0, cebo: !!p.cebo, chasq: false, arma: p.arma,
    };
    if (b.tipo === 'cohete') {
      b.mesh = crearCohete();
      b.mesh.position.copy(b.pos);
      this.juego.scene.add(b.mesh);
    }
    this.lista.push(b);
    return b;
  }

  update(dt) {
    const J = this.juego;
    const prev = new THREE.Vector3();
    const camPos = J.camaraActiva.getWorldPosition(new THREE.Vector3());
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const b = this.lista[i];
      b.vida -= dt;
      prev.copy(b.pos);
      // Integración: gravedad, arrastre; el cohete acelera tras 11 m (motor de crucero)
      if (b.tipo === 'cohete') {
        b.recorrido += b.vel.length() * dt;
        if (b.recorrido > 11 && b.vel.length() < b.velMax) b.vel.multiplyScalar(1 + dt * 3);
        b.vel.y -= 9.8 * dt * 0.5;
        J.efectos.estela(b.pos, b.recorrido > 11);
      } else {
        b.vel.y -= 9.8 * dt;
        b.vel.multiplyScalar(1 - (b.tipo === 'bala' ? 0.08 : 0.02) * dt);
      }
      b.pos.addScaledVector(b.vel, dt);
      if (b.mesh) { b.mesh.position.copy(b.pos); b.mesh.lookAt(_v.copy(b.pos).add(b.vel)); b.mesh.rotateY(Math.PI); }
      if (b.trazadora) J.efectos.trazadoraProyectil(b.pos, b.vel, Math.min(12, b.vel.length() * 0.012));
      // Chasquido cuando una bala ajena pasa cerca de la cámara
      if (!b.chasq && b.tipo !== 'cohete' && b.duenoId !== J.idLocal) {
        const t = clamp(_v.subVectors(camPos, prev).dot(_v2.subVectors(b.pos, prev)) / Math.max(1e-6, _v2.lengthSq()), 0, 1);
        const cerca = prev.clone().addScaledVector(_v2, t);
        if (cerca.distanceTo(camPos) < 4) { b.chasq = true; J.audio.chasquido(cerca); J.alPasarBala?.(cerca); }
      }
      const imp = J.impactoSegmento(prev, b.pos, { duenoId: b.duenoId, proyectil: b });
      if (imp) {
        J.alImpactar(b, imp);
        this.quitar(i);
        continue;
      }
      // Proximidad (cebo) del 23 mm contra drones
      if (b.cebo) {
        for (const d of J.drones.values()) {
          if (d.vivo && d.faccion !== b.faccion && d.pos.distanceTo(b.pos) < 2.5) { J.alImpactar(b, { p: b.pos.clone(), n: new THREE.Vector3(0, 1, 0), mat: 'aire', dron: d }); this.quitar(i); break; }
        }
        if (!this.lista[i] || this.lista[i] !== b) continue;
      }
      if (b.vida <= 0 || b.pos.y < -200) {
        if (b.tipo === 'cohete') J.alImpactar(b, { p: b.pos.clone(), n: new THREE.Vector3(0, 1, 0), mat: 'aire' }); // autodestrucción del PG-7 a ~900 m
        this.quitar(i);
      }
    }
  }

  quitar(i) {
    const b = this.lista[i];
    if (b.mesh) this.juego.scene.remove(b.mesh);
    this.lista.splice(i, 1);
  }
}
const _v2 = new THREE.Vector3();
