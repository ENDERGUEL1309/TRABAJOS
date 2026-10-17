// Soldado: modelo humanoide procedural, animación de marcha/agachado/muerte y cajas de impacto.
import * as THREE from 'three';
import * as TX from './texturas.js';
import { material } from './modelos.js';
import { crearModeloArma, equipoPorDefecto } from './arsenal.js';
import { construirSoldado, construirBrazos } from './soldadoModelo.js';
import { damp, dampAngle } from './util.js';

export const FACCIONES = {
  UA: { nombre: 'Ucrania', corto: 'UA', cinta: '#e8c21c', casco: '#5c5f42', placa: '#4e5236', primaria: 'ak74', color: '#f2c94c' },
  RU: { nombre: 'Rusia', corto: 'RU', cinta: '#e8e8e8', casco: '#55593f', placa: '#4a4d3b', primaria: 'ak12', color: '#e05a47' },
};

const geoCache = {};
function geo(nombre, crear) { return geoCache[nombre] || (geoCache[nombre] = crear()); }

export class Soldado {
  constructor({ id, nombre, faccion, esLocal = false, esBot = false }) {
    this.id = id;
    this.nombre = nombre;
    this.faccion = faccion;
    this.esLocal = esLocal;
    this.esBot = esBot;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.agachado = 0;      // 0..1 suavizado
    this.quiereAgachar = false;
    this.vida = 100;
    this.vivo = true;
    this.arma = 'primaria';
    this.modelosArma = {};
    this.fase = 0;
    this.muerteT = 0;
    this.enVehiculo = null;
    this.enSuelo = true;
    this.kills = 0;
    this.muertes = 0;
    this.cajas = [
      { parte: 'cabeza', r: 0.15, c: new THREE.Vector3() },
      { parte: 'torso', r: 0.25, c: new THREE.Vector3() },
      { parte: 'torso', r: 0.23, c: new THREE.Vector3() },
      { parte: 'pierna', r: 0.13, c: new THREE.Vector3() },
      { parte: 'pierna', r: 0.13, c: new THREE.Vector3() },
      { parte: 'pierna', r: 0.11, c: new THREE.Vector3() },
      { parte: 'pierna', r: 0.11, c: new THREE.Vector3() },
      { parte: 'brazo', r: 0.075, c: new THREE.Vector3() },
      { parte: 'brazo', r: 0.075, c: new THREE.Vector3() },
    ];
    this.construir();
  }

  construir() {
    const F = FACCIONES[this.faccion];
    const P = construirSoldado(this.faccion, F.cinta);
    Object.assign(this, { raiz: P.raiz, cadera: P.cadera, torso: P.torso, cuello: P.cuello, pivArma: P.pivArma, pI: P.pI, pD: P.pD, matSoldado: P.materiales, matCinta: P.cinta });
    this.raiz.traverse((o) => { if (o.isMesh) o.userData.soldado = this; });
    this.marcasFijas = [P.cabeza, P.pecho, P.pelvis, P.pI.m, P.pD.m, P.pI.e, P.pD.e];
    this.offsets = [new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.2, 0),
      new THREE.Vector3(0, -0.14, 0), new THREE.Vector3(0, -0.14, 0)];
    this.setEquipo(equipoPorDefecto('asalto', this.faccion));
  }

  // Etiqueta con el nombre (solo aliados)
  ponerEtiqueta(color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const g = c.getContext('2d');
    g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(this.nombre, 129, 33);
    g.fillStyle = color; g.fillText(this.nombre, 128, 32);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, sizeAttenuation: false }));
    s.scale.set(0.12, 0.022, 1);
    s.position.y = 2.1;
    s.renderOrder = 20;
    this.raiz.add(s);
    this.etiqueta = s;
  }

  // Modelos de tercera persona del equipo (principal, pistola, lanzador)
  setEquipo(eq) {
    this.equipo = eq;
    for (const m of Object.values(this.modelosArma)) this.pivArma.remove(m);
    this.modelosArma = {};
    const poner = (clave, id, acc, pos) => {
      if (!id) return;
      const m = crearModeloArma(id, acc || undefined);
      m.position.copy(pos);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.soldado = this; } });
      m.visible = false;
      this.pivArma.add(m);
      this.modelosArma[clave] = m;
    };
    poner('primaria', eq.primaria, eq.accPrimaria, new THREE.Vector3(0.08, -0.04, -0.18));
    poner('secundaria', eq.secundaria, eq.accSecundaria, new THREE.Vector3(0.02, 0.02, -0.34));
    poner('especial', eq.especial, null, new THREE.Vector3(0.14, 0.12, -0.05));
    this.arma = null;
    this.setArma('primaria');
  }

  setArma(a) {
    if (!this.modelosArma[a]) a = 'primaria';
    const cambio = a !== this.arma || !this.brazos;
    this.arma = a;
    for (const [k, m] of Object.entries(this.modelosArma)) m.visible = k === a;
    if (cambio) this.colocarBrazos();
  }

  // Brazos que agarran el arma actual (empuñadura y guardamanos)
  colocarBrazos() {
    if (this.brazos) this.pivArma.remove(this.brazos);
    const m = this.modelosArma[this.arma];
    let manoD, manoI;
    if (this.arma === 'secundaria') { manoD = new THREE.Vector3(0.02, -0.02, -0.33); manoI = new THREE.Vector3(0.0, -0.03, -0.32); }
    else if (this.arma === 'especial') { manoD = new THREE.Vector3(0.14, 0.08, -0.06); manoI = new THREE.Vector3(0.12, 0.08, -0.26); }
    else {
      manoD = m.position.clone().add(new THREE.Vector3(0, -0.045, 0.035));
      manoI = m.position.clone().add(m.userData.manoIzq).add(new THREE.Vector3(0.0, -0.02, 0));
    }
    this.brazos = construirBrazos(this.matSoldado, this.matCinta, manoD, manoI);
    this.brazos.traverse((o) => { if (o.isMesh) o.userData.soldado = this; });
    this.pivArma.add(this.brazos);
    this.marcas = [...this.marcasFijas, this.brazos.userData.brazoD, this.brazos.userData.brazoI];
  }

  idArma() { return this.equipo[this.arma] || this.equipo.primaria; }

  matar() {
    this.vivo = false;
    this.vida = 0;
    this.muerteT = 0;
    this.muertes++;
  }

  revivir(p, yaw) {
    this.vivo = true;
    this.vida = 100;
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.raiz.rotation.set(0, yaw, 0);
    this.raiz.visible = true;
    this.muerteT = 0;
    this.enVehiculo = null;
  }

  // Animación procedural; velocidad horizontal tomada de vel.
  animar(dt) {
    const r = this.raiz;
    if (!this.vivo) {
      this.muerteT += dt;
      const t = Math.min(1, this.muerteT / 0.7);
      r.position.copy(this.pos);
      r.rotation.set(-t * t * 1.5, this.yaw, t * 0.2);
      r.position.y = this.pos.y + Math.sin(t * Math.PI) * 0.1;
      this.cadera.position.y = damp(this.cadera.position.y, 0.35, 6, dt);
      if (this.muerteT > 12) r.visible = false;
      return;
    }
    this.agachado = damp(this.agachado, this.quiereAgachar ? 1 : 0, 10, dt);
    const v = Math.hypot(this.vel.x, this.vel.z);
    this.fase += dt * (2 + v * 1.9);
    const amp = Math.min(1, v / 3) * (v > 4.5 ? 0.75 : 0.5);
    const s = Math.sin(this.fase);
    const ag = this.agachado;
    r.position.copy(this.pos);
    r.rotation.set(0, this.yaw, 0);
    this.cadera.position.y = 0.95 - ag * 0.36 + Math.abs(Math.cos(this.fase)) * 0.03 * amp;
    this.torso.rotation.x = -ag * 0.35 - (v > 4.5 ? 0.18 : 0.05) * Math.min(1, v / 3);
    this.pI.muslo.rotation.x = s * amp - ag * 1.25;
    this.pD.muslo.rotation.x = -s * amp - ag * 1.25;
    this.pI.rod.rotation.x = Math.max(0, -s) * amp * 1.3 + ag * 1.9;
    this.pD.rod.rotation.x = Math.max(0, s) * amp * 1.3 + ag * 1.9;
    // Si va de lado, inclinación lateral del tronco
    const loc = new THREE.Vector3(this.vel.x, 0, this.vel.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.yaw);
    this.torso.rotation.z = dampAngle(this.torso.rotation.z, -loc.x * 0.03, 6, dt);
    this.pivArma.rotation.x = this.pitch - this.torso.rotation.x;
    this.cuello.rotation.x = this.pitch * 0.5;
  }

  actualizarCajas() {
    this.raiz.updateMatrixWorld(true);
    for (let i = 0; i < this.cajas.length; i++) {
      this.cajas[i].c.copy(this.offsets[i]).applyMatrix4(this.marcas[i].matrixWorld);
    }
  }

  // Posición aproximada de los ojos (para línea de visión de bots)
  ojos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.62 - this.agachado * 0.5, this.pos.z);
  }
}
