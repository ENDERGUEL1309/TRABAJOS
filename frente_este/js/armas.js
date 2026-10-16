// Armas de infantería: vista en primera persona (estilo cámara corporal) con ranuras, accesorios
// y ópticas, granadas y proyectiles balísticos (balas, cohetes, obuses, granadas y bombas).
import * as THREE from 'three';
import { crearBrazos, crearCohete } from './modelos.js';
import { ARMAS, estadisticas, crearModeloArma, crearModeloGranada } from './arsenal.js';
import { damp, clamp } from './util.js';

export { ARMAS };
const _v = new THREE.Vector3();

// ---------- Vista en primera persona del jugador local ----------
export class ArmaLocal {
  constructor(juego, faccion, equipo) {
    this.juego = juego;
    this.faccion = faccion;
    this.grupo = new THREE.Group(); // hijo de la cámara
    const fm = new THREE.SpriteMaterial({ map: juego.texFogonazo, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ffcf90' });
    this.fogonazo = new THREE.Sprite(fm);
    this.fogonazo.visible = false;
    this.grupo.add(this.fogonazo);
    this.apuntado = 0;
    this.tCad = 0;
    this.recargando = 0;
    this.cambiando = 0;
    this.retro = 0; this.retroRot = 0;
    this.balanceo = new THREE.Vector2();
    this.fase = 0;
    this.sprint = 0;
    this.tFog = 0;
    this.gatilloAntes = false;
    this.equipar(equipo);
  }

  equipar(eq) {
    if (this.ranuras) for (const r of Object.values(this.ranuras)) this.grupo.remove(r.porta);
    this.equipo = eq;
    this.ranuras = {};
    const crear = (clave, id, acc) => {
      if (!id) return;
      const def = estadisticas(id, acc || undefined);
      const modelo = crearModeloArma(id, def.acc);
      const porta = new THREE.Group();
      porta.add(modelo, crearBrazos(this.faccion, modelo.userData.manoIzq));
      porta.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      porta.visible = false;
      this.grupo.add(porta);
      this.ranuras[clave] = { id, def, modelo, porta, cargador: def.cargador, reserva: def.cargador * (def.cargadores - 1) };
    };
    crear('primaria', eq.primaria, eq.accPrimaria);
    crear('secundaria', eq.secundaria, eq.accSecundaria);
    crear('especial', eq.especial, null);
    this.actual = null;
    this.setArma('primaria', true);
  }

  get ranura() { return this.ranuras[this.actual]; }
  get def() { return this.ranura.def; }
  get est() { return this.ranura; }
  get modelo() { return this.ranura.modelo; }
  get orden() { return ['primaria', 'secundaria', 'especial'].filter((k) => this.ranuras[k]); }

  setArma(a, inmediato = false) {
    if (!this.ranuras[a] || (a === this.actual && !inmediato)) return;
    if (this.ranura) this.ranura.porta.visible = false;
    this.actual = a;
    this.cambiando = inmediato ? 0 : 0.5;
    this.recargando = 0;
    this.ranura.porta.visible = true;
  }

  siguiente() {
    const o = this.orden;
    this.setArma(o[(o.indexOf(this.actual) + 1) % o.length]);
  }

  reponer() {
    for (const r of Object.values(this.ranuras)) { r.cargador = r.def.cargador; r.reserva = r.def.cargador * (r.def.cargadores - 1); }
  }

  // Munición extra (soporte): un cargador por ranura
  reabastecer() {
    let algo = false;
    for (const r of Object.values(this.ranuras)) {
      const max = r.def.cargador * (r.def.cargadores - 1);
      if (r.reserva < max) { r.reserva = Math.min(max, r.reserva + r.def.cargador); algo = true; }
    }
    return algo;
  }

  recargar() {
    const e = this.est, d = this.def;
    if (this.recargando > 0 || e.reserva <= 0 || e.cargador >= d.cargador) return;
    this.recargando = d.recarga;
    this.juego.audio.recarga();
  }

  // Devuelve un disparo {origen, dir, def, arma} si se dispara este fotograma
  update(dt, entrada, soldado, camara, moviendo, corriendo) {
    const d = this.def, e = this.est;
    this.tCad -= dt;
    this.cambiando = Math.max(0, this.cambiando - dt);
    if (this.recargando > 0) {
      this.recargando -= dt;
      if (this.recargando <= 0) { const n = Math.min(d.cargador - e.cargador, e.reserva); e.cargador += n; e.reserva -= n; }
    }
    const quiereApuntar = entrada.apuntar && !corriendo && this.recargando <= 0 && this.cambiando <= 0;
    this.apuntado = damp(this.apuntado, quiereApuntar ? 1 : 0, 12 * (d.velApuntar || 1) * (d.visor ? 0.8 : 1), dt);
    this.sprint = damp(this.sprint, corriendo ? 1 : 0, 8, dt);
    let disparo = null;
    const gatillo = entrada.disparar && !corriendo && this.recargando <= 0 && this.cambiando <= 0;
    const puede = d.auto ? gatillo : gatillo && !this.gatilloAntes;
    this.gatilloAntes = entrada.disparar;
    if (puede && this.tCad <= 0) {
      if (e.cargador > 0) {
        e.cargador--;
        this.tCad = d.cohete ? 0.8 : d.cerrojo || 60 / d.cadencia;
        disparo = this.generarDisparo(camara, moviendo, soldado);
        this.retro = d.cohete ? 0.25 : 0.03 + d.retroceso * 2;
        this.retroRot = d.cohete ? 0.12 : 0.03 + d.retroceso * 1.5;
        this.tFog = d.silenciador ? 0 : 0.04;
        if (e.cargador === 0 && e.reserva > 0 && !d.cohete) setTimeout(() => this.recargar(), 250);
        if (d.cohete && e.reserva > 0) setTimeout(() => this.recargar(), 400);
      } else {
        this.tCad = 0.3;
        this.juego.audio.clic(this.juego.audio.ctx?.currentTime || 0, 900, 0.3);
        this.recargar();
      }
    }
    this.animar(dt, moviendo, corriendo);
    return disparo;
  }

  generarDisparo(camara, moviendo, soldado) {
    const d = this.def;
    let disp = (this.apuntado > 0.7 ? d.dispMira : d.dispCadera) * (moviendo ? 1.6 : 1) * (soldado?.quiereAgachar ? 0.75 : 1);
    if (d.bipode && soldado?.quiereAgachar && this.apuntado > 0.7) disp *= 0.6;
    const origen = new THREE.Vector3(); this.modelo.userData.boca.getWorldPosition(origen);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camara.quaternion);
    const ojo = camara.getWorldPosition(new THREE.Vector3());
    // Convergencia en lo que hay realmente bajo la mira (soldados y vehículos incluidos)
    const objetivo = ojo.clone().addScaledVector(dir, 300);
    const h = this.juego.impactoSegmento(ojo, objetivo, { duenoId: this.juego.idLocal });
    if (h && h.t * 300 > 1.5) objetivo.copy(h.p);
    if (this.apuntado > 0.7 || this.juego.mundo.segmento(ojo, origen, 0.5)) origen.copy(ojo).addScaledVector(dir, 0.3);
    // Puesta a cero a la distancia del blanco: compensa la caída balística
    const dist = objetivo.distanceTo(origen);
    if (!d.cohete) { const t = dist / (d.vel * 0.97); objetivo.y += 0.5 * 9.8 * t * t; }
    else { const t = dist / ((d.vel + d.velMax) / 2); objetivo.y += 0.5 * 4.9 * t * t; }
    const real = objetivo.sub(origen).normalize();
    real.x += (Math.random() - 0.5) * 2 * disp; real.y += (Math.random() - 0.5) * 2 * disp; real.z += (Math.random() - 0.5) * 2 * disp;
    real.normalize();
    return { origen, dir: real, def: d, arma: d.id };
  }

  animar(dt, moviendo, corriendo) {
    const d = this.def;
    this.retro = damp(this.retro, 0, 14, dt);
    this.retroRot = damp(this.retroRot, 0, 10, dt);
    this.fase += dt * (moviendo ? (corriendo ? 11 : 7.5) : 1.2);
    const ampMov = moviendo ? (corriendo ? 1.6 : 1) : 0.15;
    const ap = this.apuntado;
    const mira = this.modelo.userData.mira.position;
    const pistola = d.tipo === 'pistola', lanzador = d.tipo === 'lanzador';
    const cadera = pistola ? new THREE.Vector3(0.11, -0.17, -0.38) : lanzador ? new THREE.Vector3(0.2, -0.14, -0.36) : new THREE.Vector3(0.15, -0.23, -0.46);
    const distOjo = d.visor ? -0.02 : pistola ? -0.34 : lanzador ? -0.12 : this.modelo.userData.tipoMira === 'hierro' ? -0.2 : -0.24;
    const ojo = new THREE.Vector3(-mira.x, -mira.y, distOjo - mira.z);
    const p = cadera.lerp(ojo, ap);
    const bob = 1 - ap * 0.85;
    p.x += Math.sin(this.fase) * 0.012 * ampMov * bob + this.balanceo.x * 0.02 * bob;
    p.y += -Math.abs(Math.cos(this.fase)) * 0.014 * ampMov * bob + this.balanceo.y * 0.02 * bob;
    p.z += this.retro;
    p.x -= this.sprint * 0.08; p.y -= this.sprint * 0.08;
    const bajar = Math.max(this.cambiando > 0 ? Math.sin((this.cambiando / 0.5) * Math.PI) : 0, this.recargando > 0 ? Math.min(1, Math.sin((this.recargando / d.recarga) * Math.PI) * 1.4) : 0);
    p.y -= bajar * 0.15;
    const porta = this.ranura.porta;
    porta.position.copy(p);
    porta.rotation.set(this.retroRot + bajar * 0.5 - this.sprint * 0.3, this.sprint * 0.9 + this.balanceo.x * 0.05 * bob, (this.recargando > 0 ? bajar * 0.6 : 0) + this.sprint * 0.3);
    // Con óptica de aumento a tope, el arma no se ve (se muestra el visor)
    porta.visible = !(d.visor && ap > 0.85);
    this.balanceo.multiplyScalar(Math.exp(-6 * dt));
    this.tFog -= dt;
    if (this.tFog > 0 && porta.visible) {
      const b = new THREE.Vector3(); this.modelo.userData.boca.getWorldPosition(b);
      this.grupo.worldToLocal(b);
      this.fogonazo.position.copy(b);
      this.fogonazo.material.rotation = Math.random() * 6.28;
      this.fogonazo.scale.setScalar((lanzador ? 0.6 : 0.18 + Math.random() * 0.1) * (d.fogonazo || 1));
      this.fogonazo.visible = true;
    } else this.fogonazo.visible = false;
  }

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
      pos: p.origen.clone(), vel: p.dir.clone().multiplyScalar(p.vel), tipo: p.tipo || 'bala', vida: p.tipo === 'cohete' ? 6 : p.tipo === 'granada' ? 3.5 : p.tipo === 'bomba' ? 30 : 4,
      duenoId: p.duenoId, faccion: p.faccion, danoSold: p.danoSold, dano: p.dano, radio: p.radio || 0, explota: !!p.explota,
      trazadora: !!p.trazadora, local: !!p.local, velMax: p.velMax || 0, recorrido: 0, cebo: !!p.cebo, chasq: false, arma: p.arma,
    };
    if (p.velInicial) b.vel.add(p.velInicial);
    if (b.tipo === 'cohete' || b.tipo === 'granada' || b.tipo === 'bomba') {
      b.mesh = b.tipo === 'granada' ? crearModeloGranada() : crearCohete();
      if (b.tipo === 'bomba') b.mesh.scale.setScalar(4);
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
      } else if (b.tipo === 'granada') {
        b.vel.y -= 9.8 * dt;
      } else {
        b.vel.y -= 9.8 * dt;
        b.vel.multiplyScalar(1 - (b.tipo === 'bala' ? 0.08 : 0.02) * dt);
      }
      b.pos.addScaledVector(b.vel, dt);
      if (b.mesh) { b.mesh.position.copy(b.pos); if (b.tipo !== 'granada') { b.mesh.lookAt(_v.copy(b.pos).add(b.vel)); b.mesh.rotateY(Math.PI); } else b.mesh.rotation.x += dt * 8; }
      if (b.trazadora) J.efectos.trazadoraProyectil(b.pos, b.vel, Math.min(12, b.vel.length() * 0.012));
      // Chasquido cuando una bala ajena pasa cerca de la cámara
      if (!b.chasq && b.tipo === 'bala' && b.duenoId !== J.idLocal) {
        const t = clamp(_v.subVectors(camPos, prev).dot(_v2.subVectors(b.pos, prev)) / Math.max(1e-6, _v2.lengthSq()), 0, 1);
        const cerca = prev.clone().addScaledVector(_v2, t);
        if (cerca.distanceTo(camPos) < 4) { b.chasq = true; J.audio.chasquido(cerca); J.alPasarBala?.(cerca); }
      }
      const imp = J.impactoSegmento(prev, b.pos, { duenoId: b.duenoId, proyectil: b });
      if (imp && b.tipo === 'granada') {
        // Rebote con pérdida de energía
        b.pos.copy(imp.p).addScaledVector(imp.n, 0.05);
        const vn = b.vel.dot(imp.n);
        b.vel.addScaledVector(imp.n, -1.4 * vn).multiplyScalar(0.45);
      } else if (imp) {
        J.alImpactar(b, imp);
        this.quitar(i);
        continue;
      }
      // Proximidad (cebo) del 23 mm contra drones y aeronaves
      if (b.cebo) {
        for (const d of J.drones.values()) {
          if (d.vivo && d.faccion !== b.faccion && d.pos.distanceTo(b.pos) < 2.5) { J.alImpactar(b, { p: b.pos.clone(), n: new THREE.Vector3(0, 1, 0), mat: 'aire', dron: d }); this.quitar(i); break; }
        }
        if (this.lista[i] === b) for (const v of J.vehiculos) {
          if (v.aereo && !v.destruido && v.enVuelo && v.conductor !== b.duenoId && v.pos.distanceTo(b.pos) < 5) { J.alImpactar(b, { p: b.pos.clone(), n: new THREE.Vector3(0, 1, 0), mat: 'blindaje', vehiculo: v }); this.quitar(i); break; }
        }
        if (!this.lista[i] || this.lista[i] !== b) continue;
      }
      if (b.vida <= 0 || b.pos.y < -200) {
        if (b.tipo === 'cohete' || b.tipo === 'granada') J.alImpactar(b, { p: b.pos.clone(), n: new THREE.Vector3(0, 1, 0), mat: 'aire' }); // autodestrucción del PG-7 a ~900 m
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
