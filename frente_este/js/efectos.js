// Efectos: partículas (humo, polvo, fuego, chispas, tierra), trazadoras, fogonazos y luces de explosión.
import * as THREE from 'three';
import * as TX from './texturas.js';

class SistemaParticulas {
  constructor(scene, max, aditivo, tex) {
    this.max = max;
    this.n = 0;
    this.p = new Float32Array(max * 3);    // posición
    this.v = new Float32Array(max * 3);    // velocidad
    this.vida = new Float32Array(max);
    this.dur = new Float32Array(max);
    this.t0 = new Float32Array(max);       // tamaño inicial
    this.t1 = new Float32Array(max);       // tamaño final
    this.col = new Float32Array(max * 3);
    this.alfa = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.arrastre = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aOff = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // xyz + tamaño
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // rgb + alfa
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOff', this.aOff);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aRot', this.aRot);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: tex }, uNiebla: { value: 0.0019 }, uColNiebla: { value: new THREE.Color() }, uLuz: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `
        attribute vec4 aOff; attribute vec4 aCol; attribute float aRot;
        varying vec2 vUv; varying vec4 vCol; varying float vNiebla;
        uniform float uNiebla;
        void main(){
          vUv = uv; vCol = aCol;
          vec4 mv = viewMatrix * vec4(aOff.xyz, 1.0);
          float c = cos(aRot), s = sin(aRot);
          vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aOff.w;
          mv.xy += q;
          float d = -mv.z;
          vNiebla = 1.0 - exp(-uNiebla * uNiebla * d * d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 uColNiebla; uniform vec3 uLuz;
        varying vec2 vUv; varying vec4 vCol; varying float vNiebla;
        void main(){
          vec4 t = texture2D(map, vUv);
          vec3 c = vCol.rgb * t.rgb ${aditivo ? '' : '* uLuz'};
          ${aditivo ? 'c *= (1.0 - vNiebla); float a = t.a * vCol.a;' : 'c = mix(c, uColNiebla, vNiebla); float a = t.a * vCol.a;'}
          gl_FragColor = vec4(c, a);
        }`,
    });
    if (aditivo) mat.toneMapped = false;
    this.mat = mat;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = aditivo ? 6 : 5;
    scene.add(this.mesh);
  }

  emitir(x, y, z, vx, vy, vz, dur, t0, t1, r, g, b, a, grav = 0, arrastre = 0.5) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.vida[i] = 0; this.dur[i] = dur; this.t0[i] = t0; this.t1[i] = t1;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.alfa[i] = a; this.rot[i] = Math.random() * 6.28; this.grav[i] = grav; this.arrastre[i] = arrastre;
  }

  update(dt, viento) {
    const off = this.aOff.array, col = this.aCol.array, rot = this.aRot.array;
    let i = 0;
    while (i < this.n) {
      this.vida[i] += dt;
      if (this.vida[i] >= this.dur[i]) {
        // Mover la última partícula a este hueco
        const j = --this.n;
        if (i !== j) {
          for (const arr of [this.p, this.v, this.col]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
          for (const arr of [this.vida, this.dur, this.t0, this.t1, this.alfa, this.rot, this.grav, this.arrastre]) arr[i] = arr[j];
        }
        continue;
      }
      const k = Math.exp(-this.arrastre[i] * dt);
      this.v[i * 3] = this.v[i * 3] * k + viento.x * dt * 0.3;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt;
      this.v[i * 3 + 2] = this.v[i * 3 + 2] * k + viento.z * dt * 0.3;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const t = this.vida[i] / this.dur[i];
      off[i * 4] = this.p[i * 3]; off[i * 4 + 1] = this.p[i * 3 + 1]; off[i * 4 + 2] = this.p[i * 3 + 2];
      off[i * 4 + 3] = this.t0[i] + (this.t1[i] - this.t0[i]) * Math.sqrt(t);
      col[i * 4] = this.col[i * 3]; col[i * 4 + 1] = this.col[i * 3 + 1]; col[i * 4 + 2] = this.col[i * 3 + 2];
      col[i * 4 + 3] = this.alfa[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
      rot[i] = this.rot[i] + t * 0.6;
      i++;
    }
    this.geo.instanceCount = this.n;
    this.aOff.needsUpdate = this.aCol.needsUpdate = this.aRot.needsUpdate = true;
  }
}

export class Efectos {
  constructor(scene, calidad) {
    this.scene = scene;
    this.calidad = calidad;
    this.humo = new SistemaParticulas(scene, calidad.particulas, false, TX.texHumo());
    this.fuego = new SistemaParticulas(scene, Math.floor(calidad.particulas / 2), true, TX.texHumo());
    this.viento = new THREE.Vector3(1.2, 0, 0.5);
    // Trazadoras como segmentos de línea
    this.maxTraz = 200;
    this.traz = [];
    const g = new THREE.BufferGeometry();
    this.trazPos = new Float32Array(this.maxTraz * 6);
    this.trazCol = new Float32Array(this.maxTraz * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.trazPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.trazCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.trazGeo = g;
    const lm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.trazMesh = new THREE.LineSegments(g, lm);
    this.trazMesh.frustumCulled = false;
    scene.add(this.trazMesh);
    // Luces de destello reutilizables (número fijo para no recompilar shaders)
    this.luces = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight('#ffb070', 0, 30, 2);
      l.userData.t = 0;
      scene.add(l);
      this.luces.push(l);
    }
    this.luzIdx = 0;
    // Fogonazo de boca en el mundo (para otros jugadores)
    this.fogonazos = [];
    const fm = new THREE.SpriteMaterial({ map: TX.texFogonazo(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ffd9a0' });
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(fm);
      s.visible = false;
      s.userData.t = 0;
      scene.add(s);
      this.fogonazos.push(s);
    }
    this.fogIdx = 0;
    this.focos = [];
    this.tiempo = 0;
  }

  destello(pos, intensidad = 40, dur = 0.08, color = '#ffb070', dist = 25) {
    const l = this.luces[this.luzIdx++ % this.luces.length];
    l.position.copy(pos);
    l.color.set(color);
    l.distance = dist;
    l.userData.i0 = intensidad;
    l.userData.dur = dur;
    l.userData.t = dur;
    l.intensity = intensidad;
  }

  fogonazo(pos, escala = 0.6) {
    const s = this.fogonazos[this.fogIdx++ % this.fogonazos.length];
    s.position.copy(pos);
    s.scale.setScalar(escala * (0.7 + Math.random() * 0.6));
    s.material.rotation = Math.random() * 6.28;
    s.visible = true;
    s.userData.t = 0.05;
  }

  trazadora(a, b, intensidad = 1) {
    if (this.traz.length >= this.maxTraz) this.traz.shift();
    this.traz.push({ a: a.clone(), b: b.clone(), t: 0.04, i: intensidad });
  }

  // Línea de trazadora que acompaña a un proyectil (se renueva cada fotograma)
  trazadoraProyectil(p, v, largo = 6) {
    const dir = v.clone().normalize();
    this.trazadora(p.clone().addScaledVector(dir, -largo), p, 1);
  }

  // Impacto de bala según material
  impacto(p, n, mat) {
    const H = this.humo;
    if (mat === 'tierra') {
      for (let i = 0; i < 6; i++) H.emitir(p.x, p.y + 0.05, p.z, n.x * 1.5 + (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2.5, n.z * 1.5 + (Math.random() - 0.5) * 1.5, 0.9 + Math.random() * 0.6, 0.15, 0.9, 0.42, 0.36, 0.28, 0.55, 3, 1.5);
      for (let i = 0; i < 5; i++) H.emitir(p.x, p.y, p.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 4, (Math.random() - 0.5) * 3, 0.6, 0.06, 0.05, 0.2, 0.16, 0.12, 1, 14, 0.1);
    } else if (mat === 'metal' || mat === 'blindaje') {
      for (let i = 0; i < 8; i++) this.fuego.emitir(p.x, p.y, p.z, n.x * 4 + (Math.random() - 0.5) * 8, n.y * 4 + Math.random() * 5, n.z * 4 + (Math.random() - 0.5) * 8, 0.15 + Math.random() * 0.2, 0.05, 0.02, 1, 0.75, 0.4, 1, 12, 0.2);
      H.emitir(p.x, p.y, p.z, n.x, n.y + 0.5, n.z, 0.6, 0.1, 0.5, 0.5, 0.5, 0.5, 0.3, 0, 1);
    } else {
      const c = mat === 'madera' ? [0.45, 0.36, 0.26] : mat === 'hormigon' ? [0.6, 0.59, 0.56] : [0.62, 0.48, 0.4];
      for (let i = 0; i < 5; i++) H.emitir(p.x, p.y, p.z, n.x * 2 + (Math.random() - 0.5), n.y * 2 + Math.random(), n.z * 2 + (Math.random() - 0.5), 1 + Math.random() * 0.5, 0.1, 0.8, c[0], c[1], c[2], 0.6, 0.3, 1.8);
      for (let i = 0; i < 4; i++) H.emitir(p.x, p.y, p.z, n.x * 3 + (Math.random() - 0.5) * 3, n.y * 3 + Math.random() * 2, n.z * 3 + (Math.random() - 0.5) * 3, 0.5, 0.04, 0.04, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 1, 12, 0.1);
    }
  }

  sangre(p, dir) {
    for (let i = 0; i < 6; i++) this.humo.emitir(p.x, p.y, p.z, dir.x * 2 + (Math.random() - 0.5) * 1.5, dir.y * 2 + Math.random(), dir.z * 2 + (Math.random() - 0.5) * 1.5, 0.35 + Math.random() * 0.3, 0.05, 0.35, 0.28, 0.02, 0.02, 0.8, 6, 2);
  }

  explosion(p, tam = 1) {
    this.destello(p.clone().add(new THREE.Vector3(0, 1, 0)), 900 * tam, 0.25, '#ffa860', 60 * tam);
    const F = this.fuego, H = this.humo;
    for (let i = 0; i < 18 * tam; i++) {
      const a = Math.random() * 6.28, s = Math.random() * 6 * tam;
      F.emitir(p.x, p.y + 0.5, p.z, Math.cos(a) * s, 2 + Math.random() * 6 * tam, Math.sin(a) * s, 0.25 + Math.random() * 0.3, 1.5 * tam, 4 * tam, 1, 0.55, 0.22, 1, -2, 2);
    }
    for (let i = 0; i < 26 * tam; i++) {
      const a = Math.random() * 6.28, s = Math.random() * 4 * tam;
      const g = 0.18 + Math.random() * 0.12;
      H.emitir(p.x, p.y + 0.5, p.z, Math.cos(a) * s, 1 + Math.random() * 5 * tam, Math.sin(a) * s, 4 + Math.random() * 5, 1.5 * tam, 7 * tam, g * 1.1, g, g * 0.9, 0.85, -0.2, 0.9);
    }
    // Tierra proyectada
    for (let i = 0; i < 40 * tam; i++) {
      const a = Math.random() * 6.28, s = 2 + Math.random() * 7 * tam;
      H.emitir(p.x, p.y + 0.3, p.z, Math.cos(a) * s, 6 + Math.random() * 12 * tam, Math.sin(a) * s, 1.2 + Math.random(), 0.12 + Math.random() * 0.2, 0.15, 0.22, 0.18, 0.13, 1, 14, 0.3);
    }
    // Columna de polvo lenta
    for (let i = 0; i < 8; i++) H.emitir(p.x + (Math.random() - 0.5) * 3 * tam, p.y + 0.5, p.z + (Math.random() - 0.5) * 3 * tam, 0, 1 + Math.random() * 2, 0, 8 + Math.random() * 4, 3 * tam, 10 * tam, 0.45, 0.4, 0.33, 0.5, -0.05, 0.6);
  }

  fogonazoCanon(p, dir, tam = 1) {
    this.destello(p, 400 * tam, 0.12, '#ffc080', 40);
    for (let i = 0; i < 10; i++) this.fuego.emitir(p.x, p.y, p.z, dir.x * (10 + Math.random() * 20) + (Math.random() - 0.5) * 3, dir.y * 15 + (Math.random() - 0.5) * 3, dir.z * (10 + Math.random() * 20) + (Math.random() - 0.5) * 3, 0.12, 0.8 * tam, 2.5 * tam, 1, 0.6, 0.3, 1, 0, 6);
    for (let i = 0; i < 16; i++) this.humo.emitir(p.x, p.y, p.z, dir.x * (4 + Math.random() * 12) + (Math.random() - 0.5) * 4, dir.y * 6 + Math.random() * 2, dir.z * (4 + Math.random() * 12) + (Math.random() - 0.5) * 4, 2.5 + Math.random() * 2, 0.8 * tam, 4 * tam, 0.6, 0.58, 0.55, 0.55, 0, 1.6);
  }

  rebufo(p, dir) {
    for (let i = 0; i < 20; i++) this.humo.emitir(p.x, p.y, p.z, -dir.x * (6 + Math.random() * 10) + (Math.random() - 0.5) * 3, -dir.y * 6 + Math.random() * 2, -dir.z * (6 + Math.random() * 10) + (Math.random() - 0.5) * 3, 2 + Math.random() * 2, 0.4, 3, 0.7, 0.68, 0.64, 0.6, 0, 1.4);
    this.destello(p, 120, 0.1);
  }

  estela(p, conFuego = true) {
    this.humo.emitir(p.x, p.y, p.z, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, 1.8 + Math.random(), 0.25, 1.4, 0.72, 0.7, 0.68, 0.55, -0.1, 1);
    if (conFuego) this.fuego.emitir(p.x, p.y, p.z, 0, 0, 0, 0.05, 0.35, 0.1, 1, 0.7, 0.35, 1, 0, 0);
  }

  polvoVehiculo(p, intensidad) {
    if (Math.random() > intensidad) return;
    this.humo.emitir(p.x + (Math.random() - 0.5), p.y + 0.3, p.z + (Math.random() - 0.5), (Math.random() - 0.5), 0.6 + Math.random(), (Math.random() - 0.5), 2 + Math.random() * 2, 0.6, 3.5, 0.52, 0.47, 0.38, 0.35, -0.05, 0.8);
  }

  escape(p, intensidad) {
    if (Math.random() > intensidad) return;
    this.humo.emitir(p.x, p.y, p.z, (Math.random() - 0.5) * 0.5, 0.8, (Math.random() - 0.5) * 0.5, 1.5, 0.3, 1.6, 0.15, 0.15, 0.15, 0.35, -0.2, 0.8);
  }

  // Columnas de humo persistentes (incendios)
  addFoco(p, tam = 1) { this.focos.push({ p: p.clone(), tam, acc: 0 }); }

  update(dt, camara, colorNiebla, densidad) {
    this.tiempo += dt;
    for (const f of this.focos) {
      const d = camara.position.distanceTo(f.p);
      if (d > 1400) continue;
      f.acc += dt * (d < 300 ? 6 : 2.5) * f.tam;
      while (f.acc > 1) {
        f.acc -= 1;
        const g = 0.12 + Math.random() * 0.08;
        this.humo.emitir(f.p.x + (Math.random() - 0.5) * 2, f.p.y, f.p.z + (Math.random() - 0.5) * 2, 0, 2.5 + Math.random() * 1.5, 0, 14 + Math.random() * 8, 2 * f.tam, 14 * f.tam, g, g * 0.95, g * 0.9, 0.7, -0.08, 0.15);
        if (d < 400 && Math.random() < 0.6) this.fuego.emitir(f.p.x + (Math.random() - 0.5) * 2, f.p.y - 0.5, f.p.z + (Math.random() - 0.5) * 2, 0, 1.5, 0, 0.6, 1.2, 0.3, 1, 0.45, 0.15, 0.9, -1, 0.5);
      }
    }
    this.humo.mat.uniforms.uColNiebla.value.copy(colorNiebla);
    this.humo.mat.uniforms.uNiebla.value = densidad;
    this.fuego.mat.uniforms.uNiebla.value = densidad;
    this.humo.update(dt, this.viento);
    this.fuego.update(dt, this.viento);
    for (const l of this.luces) {
      if (l.userData.t > 0) {
        l.userData.t -= dt;
        l.intensity = Math.max(0, l.userData.i0 * (l.userData.t / l.userData.dur));
      } else l.intensity = 0;
    }
    for (const s of this.fogonazos) if (s.visible && (s.userData.t -= dt) <= 0) s.visible = false;
    // Trazadoras
    let k = 0;
    for (let i = this.traz.length - 1; i >= 0; i--) {
      const t = this.traz[i];
      t.t -= dt;
      if (t.t <= 0) { this.traz.splice(i, 1); continue; }
      const c = t.i * 3;
      this.trazPos.set([t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z], k * 6);
      this.trazCol.set([c * 0.4, c * 0.15, c * 0.05, c, c * 0.55, c * 0.25], k * 6);
      k++;
    }
    this.trazGeo.setDrawRange(0, k * 2);
    this.trazGeo.attributes.position.needsUpdate = true;
    this.trazGeo.attributes.color.needsUpdate = true;
  }
}
