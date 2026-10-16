// Soldado: modelo humanoide procedural, animación de marcha/agachado/muerte y cajas de impacto.
import * as THREE from 'three';
import * as TX from './texturas.js';
import { crearFusil, crearRPG, material } from './modelos.js';
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
    this.arma = 'fusil';
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
    ];
    this.construir();
  }

  construir() {
    const F = FACCIONES[this.faccion];
    const camo = new THREE.MeshStandardMaterial({ map: TX.texCamo(this.faccion), roughness: 0.95 });
    const placa = new THREE.MeshStandardMaterial({ color: F.placa, roughness: 0.9 });
    const casco = new THREE.MeshStandardMaterial({ map: TX.texCamo(this.faccion), color: '#cfcfcf', roughness: 0.85 });
    const bota = new THREE.MeshStandardMaterial({ color: '#2c241c', roughness: 0.8 });
    const cinta = new THREE.MeshStandardMaterial({ color: F.cinta, roughness: 0.6 });
    const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    const raiz = new THREE.Group();
    const cadera = new THREE.Group(); cadera.position.y = 0.95; raiz.add(cadera);
    const pelvis = sh(new THREE.Mesh(geo('pelvis', () => new THREE.CapsuleGeometry(0.13, 0.12, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.85)), camo)); cadera.add(pelvis);
    const torso = new THREE.Group(); cadera.add(torso);
    const pecho = sh(new THREE.Mesh(geo('pecho', () => new THREE.CapsuleGeometry(0.16, 0.26, 4, 12).scale(1.18, 1, 0.75).translate(0, 0.3, 0)), camo)); torso.add(pecho);
    const chaleco = sh(new THREE.Mesh(geo('chaleco', () => new THREE.CapsuleGeometry(0.17, 0.12, 3, 10).scale(1.15, 1, 0.92).translate(0, 0.36, 0)), placa)); torso.add(chaleco);
    for (const lado of [-1, 1]) {
      const hombro = sh(new THREE.Mesh(geo('hombro', () => new THREE.SphereGeometry(0.075, 10, 8)), camo));
      hombro.position.set(lado * 0.2, 0.5, 0); torso.add(hombro);
    }
    const cuelloM = sh(new THREE.Mesh(geo('cuelloM', () => new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8)), camo));
    cuelloM.position.y = 0.58; torso.add(cuelloM);
    // Portacargadores frontales
    for (let i = -1; i <= 1; i++) {
      const b = sh(new THREE.Mesh(geo('bolsa', () => new THREE.BoxGeometry(0.09, 0.13, 0.06)), placa));
      b.position.set(i * 0.11, 0.28, -0.17); torso.add(b);
    }
    const mochila = sh(new THREE.Mesh(geo('mochila', () => new THREE.BoxGeometry(0.3, 0.32, 0.12)), placa));
    mochila.position.set(0, 0.36, 0.2); torso.add(mochila);
    // Cabeza y casco
    const cuello = new THREE.Group(); cuello.position.y = 0.6; torso.add(cuello);
    const cabeza = sh(new THREE.Mesh(geo('cabeza', () => new THREE.SphereGeometry(0.105, 12, 10).scale(0.9, 1.1, 1)), material('piel')));
    cabeza.position.y = 0.08; cuello.add(cabeza);
    const pasamontanas = sh(new THREE.Mesh(geo('pasam', () => new THREE.SphereGeometry(0.108, 12, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55).scale(0.92, 1.1, 1.02)), camo));
    pasamontanas.position.y = 0.08; cuello.add(pasamontanas);
    const cas = sh(new THREE.Mesh(geo('casco', () => new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), casco));
    cas.position.y = 0.12; cuello.add(cas);
    // Piernas
    const pierna = (lado) => {
      const muslo = new THREE.Group(); muslo.position.set(lado * 0.1, -0.06, 0); cadera.add(muslo);
      const m = sh(new THREE.Mesh(geo('muslo', () => new THREE.CapsuleGeometry(0.085, 0.3, 3, 8).translate(0, -0.2, 0)), camo)); muslo.add(m);
      const rod = new THREE.Group(); rod.position.y = -0.42; muslo.add(rod);
      const e = sh(new THREE.Mesh(geo('espinilla', () => new THREE.CapsuleGeometry(0.07, 0.3, 3, 8).translate(0, -0.2, 0)), camo)); rod.add(e);
      const b = sh(new THREE.Mesh(geo('bota', () => new THREE.BoxGeometry(0.11, 0.1, 0.27).translate(0, -0.43, -0.05)), bota)); rod.add(b);
      return { muslo, rod };
    };
    this.pI = pierna(-1); this.pD = pierna(1);
    // Arma y brazos (giran con el cabeceo)
    const pivArma = new THREE.Group(); pivArma.position.set(0.05, 0.42, -0.05); torso.add(pivArma);
    const fusil = crearFusil(FACCIONES[this.faccion].primaria); fusil.position.set(0.08, -0.04, -0.18); pivArma.add(fusil);
    const rpg = crearRPG(true); rpg.position.set(0.14, 0.12, -0.05); rpg.visible = false; pivArma.add(rpg);
    const brazo = (lado, pos, rot) => {
      const g = new THREE.Group(); g.position.set(lado * 0.2, 0.15, 0.0); pivArma.add(g);
      const a = sh(new THREE.Mesh(geo('brazo', () => new THREE.CapsuleGeometry(0.055, 0.42, 3, 8)), camo));
      a.position.copy(pos); a.rotation.set(...rot); g.add(a);
      return a;
    };
    brazo(1, new THREE.Vector3(-0.02, -0.08, -0.14), [1.2, 0, 0.25]);
    const bi = brazo(-1, new THREE.Vector3(0.12, -0.04, -0.3), [1.35, 0, -0.85]);
    const banda = new THREE.Mesh(geo('banda', () => new THREE.CylinderGeometry(0.06, 0.06, 0.06, 8)), cinta);
    banda.position.y = 0.12; bi.add(banda);
    raiz.traverse((o) => { if (o.isMesh) o.userData.soldado = this; });

    Object.assign(this, { raiz, cadera, torso, cuello, pivArma, fusil, rpg });
    // Marcadores de cajas de impacto
    this.marcas = [cabeza, pecho, pelvis, this.pI.muslo.children[0], this.pD.muslo.children[0], this.pI.rod.children[0], this.pD.rod.children[0]];
    this.offsets = [new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.38, 0), new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.2, 0)];
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

  setArma(a) {
    this.arma = a;
    this.fusil.visible = a === 'fusil';
    this.rpg.visible = a === 'rpg';
  }

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
