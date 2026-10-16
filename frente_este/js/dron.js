// Dron FPV kamikaze (7") con cabeza de RPG: física de cuadricóptero, modos ACRO y ANGLE (modo 2).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './util.js';

const G = 9.81;
const TW = 2.6;            // relación empuje/peso con carga
const VEL_ROT_MAX = 10.5;  // rad/s (~600 °/s) en ACRO
const ANG_MAX = 0.95;      // rad (~55°) en ANGLE
const UPTILT = 0.42;       // inclinación de la cámara (~24°)

function construirModelo() {
  const g = new THREE.Group();
  const carbono = new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.4, metalness: 0.3 });
  const motor = new THREE.MeshStandardMaterial({ color: '#7a2a20', roughness: 0.3, metalness: 0.8 });
  const ojiva = new THREE.MeshStandardMaterial({ color: '#59603f', roughness: 0.5, metalness: 0.4 });
  const cinta = new THREE.MeshStandardMaterial({ color: '#a9a49a', roughness: 0.9 });
  const brazos = [];
  for (const a of [Math.PI / 4, -Math.PI / 4]) brazos.push(new THREE.BoxGeometry(0.42, 0.012, 0.03).rotateY(a).toNonIndexed());
  brazos.push(new THREE.BoxGeometry(0.09, 0.03, 0.16).translate(0, 0.02, 0).toNonIndexed());
  g.add(new THREE.Mesh(mergeGeometries(brazos), carbono));
  const helices = [];
  const disco = new THREE.MeshBasicMaterial({ color: '#202020', transparent: true, opacity: 0.25, depthWrite: false });
  for (const [x, z] of [[0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), motor);
    m.position.set(x, 0.02, z); g.add(m);
    const h = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16).rotateX(-Math.PI / 2), disco);
    h.position.set(x, 0.04, z); g.add(h); helices.push(h);
  }
  // Ojiva PG-7 atada bajo el cuerpo, apuntando hacia delante
  const oj = mergeGeometries([
    new THREE.CylinderGeometry(0.042, 0.042, 0.12, 12).rotateX(Math.PI / 2).toNonIndexed(),
    new THREE.CylinderGeometry(0.0, 0.042, 0.13, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.125).toNonIndexed(),
    new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0, 0.12).toNonIndexed(),
  ]);
  const mo = new THREE.Mesh(oj, ojiva); mo.position.set(0, -0.035, -0.03); g.add(mo);
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.03), cinta); c.position.set(0, -0.01, 0); g.add(c);
  const bat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.11), new THREE.MeshStandardMaterial({ color: '#2a3550', roughness: 0.6 }));
  bat.position.set(0, 0.055, 0.01); g.add(bat);
  // Antena
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.08), carbono); ant.position.set(0, 0.06, 0.08); ant.rotation.x = 0.6; g.add(ant);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, helices };
}

export class Dron {
  constructor(juego, { id, duenoId, faccion }) {
    this.juego = juego;
    this.id = id;
    this.duenoId = duenoId;
    this.faccion = faccion;
    const { g, helices } = construirModelo();
    this.mesh = g;
    this.helices = helices;
    juego.scene.add(g);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.w = new THREE.Vector3();    // velocidad angular en ejes del cuerpo
    this.acel = 0;
    this.modo = 'ANGLE';
    this.vivo = true;
    this.bateria = 1;
    this.senal = 1;
    this.tSenal = 0;
    this.armado = false;
    this.tVuelo = 0;
    this.camara = new THREE.PerspectiveCamera(118, 1, 0.05, 3000);
    this.sonido = juego.audio.motor('dron');
  }

  lanzar(desde, yaw) {
    this.pos.copy(desde);
    this.vel.set(-Math.sin(yaw) * 2, 2.5, -Math.cos(yaw) * 2);
    this.q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.w.set(0, 0, 0);
    this.armado = false;
    this.tVuelo = 0;
  }

  simular(dt, e, operador) {
    if (!this.vivo) return;
    this.tVuelo += dt;
    if (this.tVuelo > 1.2) this.armado = true;
    // Curva de gas: mitad del recorrido ~ vuelo estacionario
    const t = e.dAcel;
    const empuje = (t <= 0.5 ? t / 0.5 : 1 + ((t - 0.5) / 0.5) * (TW - 1)) * G;
    this.acel = t;
    // Velocidades angulares objetivo (cuerpo): x = cabeceo, y = guiñada, z = alabeo
    const curva = (s) => s * (0.25 + 0.75 * s * s);
    const obj = new THREE.Vector3();
    if (this.modo === 'ACRO') {
      obj.set(-curva(e.dCabeceo) * VEL_ROT_MAX, -curva(e.dGuinada) * VEL_ROT_MAX * 0.6, -curva(e.dAlabeo) * VEL_ROT_MAX);
    } else {
      // ANGLE: autonivelado hacia inclinación objetivo
      const eu = new THREE.Euler().setFromQuaternion(this.q, 'YXZ');
      const objPitch = -e.dCabeceo * ANG_MAX, objRoll = -e.dAlabeo * ANG_MAX;
      const qObj = new THREE.Quaternion().setFromEuler(new THREE.Euler(objPitch, eu.y, objRoll, 'YXZ'));
      const qErr = this.q.clone().invert().multiply(qObj);
      if (qErr.w < 0) { qErr.x *= -1; qErr.y *= -1; qErr.z *= -1; qErr.w *= -1; }
      obj.set(qErr.x * 2 * 9, 0, qErr.z * 2 * 9);
      obj.y = -e.dGuinada * 3.5;
      // La guiñada se expresa en ejes del mundo: convertir a ejes del cuerpo
      const wy = new THREE.Vector3(0, obj.y, 0).applyQuaternion(this.q.clone().invert());
      obj.x += wy.x; obj.z += wy.z; obj.y = wy.y + qErr.y * 2 * 9 * 0;
    }
    // Respuesta de motores (primer orden)
    this.w.lerp(obj, 1 - Math.exp(-dt / 0.045));
    const ang = this.w.length() * dt;
    if (ang > 0) {
      const dq = new THREE.Quaternion().setFromAxisAngle(this.w.clone().normalize(), ang);
      this.q.multiply(dq).normalize();
    }
    // Fuerzas
    const arriba = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    const a = arriba.multiplyScalar(empuje);
    a.y -= G;
    const v = this.vel.length();
    a.addScaledVector(this.vel, -0.18 - 0.012 * v);
    // Viento
    a.x += 0.3 * Math.sin(this.tVuelo * 0.7); a.z += 0.2 * Math.cos(this.tVuelo * 0.5);
    const prev = this.pos.clone();
    this.vel.addScaledVector(a, dt);
    this.pos.addScaledVector(this.vel, dt);
    // Batería (≈ 5 min, más rápido con mucho gas)
    this.bateria -= dt * (0.0022 + t * t * 0.003);
    // Señal de vídeo según distancia y obstáculos respecto al operador
    this.tSenal -= dt;
    if (this.tSenal <= 0 && operador) {
      this.tSenal = 0.3;
      const d = this.pos.distanceTo(operador);
      let s = 1 - clamp((d - 700) / 900, 0, 1);
      const ojo = operador.clone(); ojo.y += 1.6;
      if (d > 80 && !this.juego.mundo.lineaVision(ojo, this.pos)) s *= 0.55;
      if (this.pos.y - this.juego.mundo.getHeight(this.pos.x, this.pos.z) < 3 && d > 200) s *= 0.8;
      this.senalObj = s;
    }
    this.senal += ((this.senalObj ?? 1) - this.senal) * Math.min(1, dt * 3);
    // Colisión
    const imp = this.juego.impactoSegmento(prev, this.pos, { ignorarDron: this, radioSoldado: 0.4 });
    if (imp) {
      const vImp = this.vel.length();
      if (this.armado && (vImp > 4 || imp.vehiculo || imp.soldado)) return { detonar: true, punto: imp.p, objetivo: imp };
      // Golpe suave: rebote y frenado
      this.pos.copy(imp.p).addScaledVector(imp.n, 0.15);
      const vn = this.vel.dot(imp.n);
      if (vn < 0) this.vel.addScaledVector(imp.n, -vn * 1.3);
      this.vel.multiplyScalar(0.5);
    }
    if (this.bateria <= 0) return { detonar: true, punto: this.pos.clone(), sinBateria: true };
    return null;
  }

  actualizarVisual(dt, local) {
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.q);
    this.mesh.visible = !local; // el piloto no ve su propio dron
    for (const h of this.helices) h.rotation.y += dt * 80;
    if (local) {
      // Cámara FPV con inclinación hacia arriba
      this.camara.position.copy(this.pos).add(new THREE.Vector3(0, 0.03, -0.08).applyQuaternion(this.q));
      this.camara.quaternion.copy(this.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), UPTILT));
    }
    if (this.sonido) this.sonido.set(this.pos, this.acel, local ? 0.12 : 0.55);
  }

  aplicarRed(s, dt) {
    const k = 1 - Math.exp(-15 * dt);
    this.pos.lerp(new THREE.Vector3(s.p[0], s.p[1], s.p[2]), k);
    this.q.slerp(new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]), k);
    this.acel = s.g ?? 0.5;
  }

  estadoRed() {
    const r = (x) => Math.round(x * 1000) / 1000;
    return { id: this.id, p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], q: [r(this.q.x), r(this.q.y), r(this.q.z), r(this.q.w)], g: r(this.acel) };
  }

  velocidadKmh() { return this.vel.length() * 3.6; }

  destruir() {
    this.vivo = false;
    this.juego.scene.remove(this.mesh);
    if (this.sonido) { this.sonido.parar(); this.sonido = null; }
  }
}
