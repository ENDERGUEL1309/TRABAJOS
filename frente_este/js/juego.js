// Núcleo del juego: bucle principal, jugador local (infantería / vehículo / dron), combate,
// sincronización de red (4 jugadores) e IA en partida local.
import * as THREE from 'three';
import { Mundo } from './mundo.js';
import { Soldado, FACCIONES } from './soldado.js';
import { ArmaLocal, Proyectiles, ARMAS } from './armas.js';
import { Vehiculo, ARMAS_VEH, crearRestos } from './vehiculos.js';
import { Dron } from './dron.js';
import { Efectos } from './efectos.js';
import { Audio } from './audio.js';
import { PostFX } from './postfx.js';
import { Entrada } from './entrada.js';
import { HUD } from './hud.js';
import { Red } from './red.js';
import { IABot } from './bots.js';
import * as TX from './texturas.js';
import { clamp, damp, segSphere, wrapAngle } from './util.js';

export const CALIDADES = {
  baja: { pr: 1.0, sombra: 1024, radioSombra: 45, pasoTerreno: 2.0, arboles: 0.55, celdaHierba: 16, densidadHierba: 0.45, radioHierba: 32, particulas: 1200, msaa: 0 },
  media: { pr: 1.5, sombra: 2048, radioSombra: 55, pasoTerreno: 1.6, arboles: 0.8, celdaHierba: 16, densidadHierba: 0.8, radioHierba: 48, particulas: 2000, msaa: 0 },
  alta: { pr: 2.0, sombra: 2048, radioSombra: 65, pasoTerreno: 1.25, arboles: 1.0, celdaHierba: 16, densidadHierba: 1.2, radioHierba: 64, particulas: 3000, msaa: 4 },
};

const TASA_RED = 1 / 15;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Juego {
  constructor(opc) {
    this.opc = opc;
    this.ajustes = opc.ajustes;
    this.calidad = CALIDADES[opc.calidad] || CALIDADES.media;
    this.soldados = new Map();
    this.vehiculos = [];
    this.drones = new Map();
    this.bots = [];
    this.puntos = { UA: 0, RU: 0 };
    this.tiempo = 0;
    this.estadosRemotos = new Map();
    this.estado = 'infanteria';
    this.vista = { yaw: 0, pitch: 0 };
    this.sacudida = 0;
    this.primeraPersona = true;
    this.zoomIdx = 0;
    this.tRed = 0;
    this.idLocal = 'yo';
    this.dronesRest = 3;
    this.tReponer = 0;
    this.texFogonazo = TX.texFogonazo();
  }

  async iniciar(progreso) {
    const paso = async (txt) => { progreso?.(txt); await new Promise((r) => setTimeout(r, 16)); };
    await paso('Preparando el renderizador…');
    const lienzo = document.getElementById('lienzo');
    const r = new THREE.WebGLRenderer({ canvas: lienzo, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(devicePixelRatio, this.calidad.pr));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera(this.ajustes.fov, innerWidth / innerHeight, 0.03, 5000);
    this.scene.add(this.camara);
    this.camaraActiva = this.camara;

    await paso('Generando el terreno y las trincheras…');
    this.mundo = new Mundo(this.scene, r, this.calidad);
    await paso('Cargando efectos y sonido…');
    this.efectos = new Efectos(this.scene, this.calidad);
    for (const f of this.mundo.fuegos) this.efectos.addFoco(f, 0.8);
    for (const [x, z, t] of [[-700, 300, 2.5], [900, -500, 3], [450, 850, 2], [-300, -900, 2.5]]) this.efectos.addFoco(new THREE.Vector3(x, this.mundo.getHeight(x, z), z), t);
    this.audio = this.opc.audio || new Audio();
    this.postfx = new PostFX(r, this.scene, this.camara, this.calidad);
    this.entrada = new Entrada(lienzo, document.getElementById('tactil'), this.ajustes);
    this.proyectiles = new Proyectiles(this);

    await paso('Desplegando vehículos…');
    let n = 0;
    for (const fac of ['UA', 'RU']) {
      const B = this.mundo.bases[fac];
      for (const v of B.vehiculos) this.vehiculos.push(new Vehiculo(this, { id: 'v' + n++, tipo: v.tipo, faccion: fac, x: v.x, z: v.z, yaw: B.yaw }));
    }
    crearRestos(this, 'tanque', 'RU', 35, 140, 0.8);
    crearRestos(this, 'mtlb', 'RU', 105, -25, 2.2);
    crearRestos(this, 'tanque', 'UA', -75, 125, -1.2);
    crearRestos(this, 'tecnica', 'UA', -125, -105, 0.3);

    // Red o partida local
    let faccion = this.opc.faccion === 'RU' ? 'RU' : 'UA';
    if (this.opc.modo === 'red') {
      await paso('Conectando con el servidor…');
      this.red = new Red();
      const bienvenida = await this.red.conectar(this.opc.url, this.opc.nombre, this.opc.faccion === 'auto' ? null : this.opc.faccion);
      this.idLocal = bienvenida.id;
      faccion = bienvenida.faccion;
      this.configurarRed(bienvenida);
    } else if (this.opc.faccion === 'auto') faccion = Math.random() < 0.5 ? 'UA' : 'RU';

    await paso('Equipando al soldado…');
    this.local = new Soldado({ id: this.idLocal, nombre: this.opc.nombre, faccion, esLocal: true });
    this.soldados.set(this.local.id, this.local);
    this.scene.add(this.local.raiz);
    this.arma = new ArmaLocal(this, faccion, FACCIONES[faccion].primaria);
    this.camara.add(this.arma.grupo);
    document.getElementById('bcId').textContent = `CÁM. CORPORAL · ${this.opc.nombre.toUpperCase()} · ${FACCIONES[faccion].nombre.toUpperCase()}`;
    if (!this.red) this.crearBots(faccion);
    this.hud = new HUD(this);
    this.reaparecer();

    await paso('Compilando sombreadores…');
    this.alRedimensionar();
    addEventListener('resize', () => this.alRedimensionar());
    try { r.compile(this.scene, this.camara); } catch (e) { console.warn(e); }
    this.reloj = new THREE.Clock();
    this.hud.mensaje(this.red ? 'Beta multijugador · 2 contra 2' : 'Partida local con IA · 2 contra 2', 4);
    r.setAnimationLoop(() => this.bucle());
  }

  crearBots(faccionLocal) {
    const otra = faccionLocal === 'UA' ? 'RU' : 'UA';
    const nombres = { UA: ['Taras', 'Bohdan', 'Oleh'], RU: ['Ivan', 'Dmitri', 'Sergei'] };
    const lista = [[faccionLocal, nombres[faccionLocal][0]], [otra, nombres[otra][0]], [otra, nombres[otra][1]]];
    lista.forEach(([fac, nom], i) => {
      const s = new Soldado({ id: 'b' + i, nombre: nom, faccion: fac, esBot: true });
      this.soldados.set(s.id, s);
      this.scene.add(s.raiz);
      if (fac === faccionLocal) s.ponerEtiqueta(FACCIONES[fac].color);
      const B = this.mundo.bases[fac];
      s.revivir(B.spawns[(i + 2) % B.spawns.length], B.yaw);
      s.tReaparecer = 0;
      this.bots.push(new IABot(this, s));
    });
  }

  alRedimensionar() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio, this.calidad.pr);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    for (const c of [this.camara, ...[...this.drones.values()].map((d) => d.camara)]) { c.aspect = w / h; c.updateProjectionMatrix(); }
    this.postfx.resize(w, h, pr);
  }

  // ---------------------------------------------------------------- bucle
  bucle() {
    const dt = Math.min(0.05, this.reloj.getDelta());
    this.tiempo += dt;
    const e = this.entrada.leer(dt);
    if (e.flancos.has('marcador')) { this.verTabla = !this.verTabla; e.flancos.delete('marcador'); }
    this.hud.tabla(this.verTabla || this.entrada.teclas.has('Tab'));

    if (this.estado === 'infanteria') this.actualizarInfanteria(dt, e);
    else if (this.estado === 'vehiculo') this.actualizarVehiculoLocal(dt, e);
    else if (this.estado === 'dron') this.actualizarDronLocal(dt, e);
    else if (this.estado === 'muerto') this.actualizarMuerto(dt, e);
    this.entrada.limpiarFlancos();

    // Bots y soldados remotos
    for (const b of this.bots) b.update(dt);
    for (const s of this.soldados.values()) {
      if (s.esBot) this.gestionarBot(s, dt);
      else if (!s.esLocal) this.aplicarRemoto(s, dt);
      s.animar(dt);
      if (s.vivo) s.actualizarCajas();
      if (s.protegido > 0) s.protegido -= dt;
    }
    // Vehículos
    for (const v of this.vehiculos) {
      if (v.destruido) {
        if (v.actualizarDestruido(dt)) { if (v === this.vehLocal) this.bajar(true); }
        continue;
      }
      if (v === this.vehLocal) continue; // ya simulado
      const remoto = v.conductor && v.conductor !== this.idLocal ? this.estadosRemotos.get(v.conductor) : null;
      if (remoto && remoto.v && remoto.v.id === v.id) v.aplicarRed(remoto.v, dt);
      else v.simular(dt, null);
      this.sonidoVehiculo(v, !!v.conductor);
    }
    // Drones remotos
    for (const d of this.drones.values()) {
      if (d === this.dronLocal) continue;
      const st = this.estadosRemotos.get(d.duenoId);
      if (st && st.d && st.d.id === d.id) d.aplicarRed(st.d, dt);
      else if (this.red) { this.quitarDron(d); continue; }
      d.actualizarVisual(dt, false);
    }
    this.proyectiles.update(dt);
    this.efectos.update(dt, this.camaraActiva, this.mundo.scene.fog.color, this.mundo.scene.fog.density);
    this.mundo.update(dt, this.posFoco());
    this.audio.setOyente(this.camaraActiva.getWorldPosition(_v), this.camaraActiva.getWorldQuaternion(new THREE.Quaternion()));
    this.hud.actualizar(dt);
    if (this.red && (this.tRed -= dt) <= 0) { this.tRed = TASA_RED; this.enviarEstado(); }
    this.postfx.dano = damp(this.postfx.dano, this.local.vivo ? clamp((60 - this.local.vida) / 60, 0, 1) * 0.7 : 0.6, 3, dt);
    this.postfx.dibujar(dt);
  }

  posFoco() {
    if (this.estado === 'dron' && this.dronLocal) return this.dronLocal.pos;
    if (this.estado === 'vehiculo' && this.vehLocal) return this.vehLocal.pos;
    return this.local.pos;
  }

  rumbo() {
    const q = this.camaraActiva.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    return ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
  }

  // ---------------------------------------------------------------- infantería
  actualizarInfanteria(dt, e) {
    const s = this.local, A = this.arma, W = this.mundo;
    const sens = 0.0022 * (this.camara.fov / this.ajustes.fov);
    this.vista.yaw -= e.vistaX * sens;
    this.vista.pitch = clamp(this.vista.pitch - e.vistaY * sens, -1.45, 1.45);
    A.inercia(e.vistaX, e.vistaY);
    // Acciones
    if (e.flancos.has('agachar')) s.quiereAgachar = !s.quiereAgachar;
    if (e.flancos.has('cambiarArma')) A.setArma(A.actual === 'fusil' ? 'rpg' : 'fusil');
    if (e.flancos.has('arma1')) A.setArma('fusil');
    if (e.flancos.has('arma2')) A.setArma('rpg');
    if (e.flancos.has('recargar')) A.recargar();
    s.setArma(A.actual);
    const corriendo = e.correr && e.movY > 0.3 && !s.quiereAgachar && A.apuntado < 0.3;
    if (corriendo) s.quiereAgachar = false;
    if (e.flancos.has('saltar') && s.enSuelo) { s.vel.y = 4.3; s.enSuelo = false; s.quiereAgachar = false; }
    // Movimiento en el plano según la vista
    const fy = this.vista.yaw;
    const wx = Math.cos(fy) * e.movX - Math.sin(fy) * e.movY, wz = -Math.sin(fy) * e.movX - Math.cos(fy) * e.movY;
    const vmax = corriendo ? 5.8 : s.quiereAgachar ? 1.7 : A.apuntado > 0.5 ? 2.0 : 3.3;
    this.moverSoldado(s, wx, wz, vmax, dt, true);
    s.yaw = this.vista.yaw; s.pitch = this.vista.pitch;
    const moviendo = Math.hypot(s.vel.x, s.vel.z) > 0.6;
    // Pasos
    const fasePaso = Math.floor(s.fase / Math.PI);
    if (moviendo && s.enSuelo && fasePaso !== this.ultimoPaso) { this.audio.paso(corriendo ? 1.3 : s.quiereAgachar ? 0.4 : 0.8); }
    this.ultimoPaso = fasePaso;
    // Disparo
    const d = A.update(dt, e, s, this.camara, moviendo, corriendo);
    if (d) this.disparoLocal(d);
    // Interacción con vehículos
    const cerca = this.vehiculoCercano();
    this.entrada.setEtiqueta('interactuar', cerca ? 'SUBIR' : 'SUBIR', !!cerca);
    this.hud.el.aviso.textContent = cerca ? `${this.entrada.tactil ? 'SUBIR' : '[F]'} · ${cerca.nombre}${cerca.faccion !== s.faccion ? ' (capturar)' : ''}` : '';
    if (cerca && e.flancos.has('interactuar')) this.intentarSubir(cerca);
    if (e.flancos.has('dron')) this.lanzarDron();
    // Reabastecimiento en la base propia
    const B = this.mundo.bases[s.faccion];
    if (Math.abs(s.pos.x - B.x) < 30 && Math.abs(s.pos.z) < 60 && (this.tReponer -= dt) <= 0) {
      this.tReponer = 8;
      const e2 = A.estado;
      if (e2.fusil.reserva < A.defs.fusil.cargador * 3 || e2.rpg.reserva < 1 || this.dronesRest < 3) { A.reponer(); this.dronesRest = 3; this.hud.mensaje('Munición y drones repuestos', 2); }
    }
    this.camaraInfanteria(dt, moviendo, corriendo);
  }

  camaraInfanteria(dt, moviendo, corriendo) {
    const s = this.local, A = this.arma, c = this.camara;
    const ap = A.apuntado;
    const alturaPecho = 1.42 - s.agachado * 0.5, alturaOjo = 1.62 - s.agachado * 0.5;
    const v = Math.hypot(s.vel.x, s.vel.z);
    const amp = moviendo ? (corriendo ? 1.8 : 1) : 0;
    const bob = (1 - ap * 0.8);
    c.position.set(s.pos.x, s.pos.y + alturaPecho + (alturaOjo - alturaPecho) * ap, s.pos.z);
    c.position.y += Math.abs(Math.sin(s.fase)) * 0.045 * amp * bob - 0.02 * amp;
    const lado = Math.cos(s.fase) * 0.025 * amp * bob;
    c.position.x += Math.cos(this.vista.yaw) * lado; c.position.z -= Math.sin(this.vista.yaw) * lado;
    // Rotación con balanceo de cámara corporal y sacudida
    const sac = this.sacudida;
    this.sacudida = Math.max(0, this.sacudida - dt * 2.5);
    const roll = Math.sin(s.fase) * 0.018 * amp * bob + (Math.random() - 0.5) * sac * 0.05;
    c.rotation.set(this.vista.pitch + Math.sin(s.fase * 2) * 0.006 * amp * bob + (Math.random() - 0.5) * sac * 0.06, this.vista.yaw + (Math.random() - 0.5) * sac * 0.06, roll, 'YXZ');
    const fovObj = this.ajustes.fov - (this.ajustes.fov - A.def.fov) * ap + (corriendo ? 4 : 0);
    if (Math.abs(c.fov - fovObj) > 0.05) { c.fov = damp(c.fov, fovObj, 12, dt); c.updateProjectionMatrix(); }
    this.postfx.setPerfil(ap > 0.6 ? 'apuntando' : 'bodycam');
    void v;
  }

  moverSoldado(s, wx, wz, vmax, dt) {
    const W = this.mundo;
    const l = Math.hypot(wx, wz);
    if (l > 1) { wx /= l; wz /= l; }
    const k = Math.min(1, (s.enSuelo ? 12 : 1.5) * dt);
    s.vel.x += (wx * vmax - s.vel.x) * k;
    s.vel.z += (wz * vmax - s.vel.z) * k;
    let nx = s.pos.x + s.vel.x * dt, nz = s.pos.z + s.vel.z * dt;
    // Pendientes fuertes (paredes de trinchera) frenan
    const dist = Math.hypot(nx - s.pos.x, nz - s.pos.z);
    if (s.enSuelo && dist > 1e-4) {
      const pend = (W.getHeight(nx, nz) - W.getHeight(s.pos.x, s.pos.z)) / dist;
      if (pend > 0.9) {
        const f = clamp(1 - (pend - 0.9) * 0.45, 0.35, 1);
        nx = s.pos.x + (nx - s.pos.x) * f; nz = s.pos.z + (nz - s.pos.z) * f;
      }
    }
    const p = { x: nx, z: nz };
    W.resolverCirculo(p, 0.32, s.pos.y, 1.75 - s.agachado * 0.6);
    for (const v of this.vehiculos) v.empujarSoldado(p, 0.4);
    s.pos.x = p.x; s.pos.z = p.z;
    s.vel.y -= 9.8 * dt;
    s.pos.y += s.vel.y * dt;
    const suelo = W.sueloEn(s.pos.x, s.pos.z, s.pos.y);
    if (s.pos.y <= suelo) { s.pos.y = suelo; s.vel.y = 0; s.enSuelo = true; }
    else if (s.enSuelo && s.vel.y <= 0 && s.pos.y - suelo < 0.5) { s.pos.y = suelo; s.vel.y = 0; }
    else s.enSuelo = false;
  }

  vehiculoCercano() {
    let mejor = null, dm = Infinity;
    for (const v of this.vehiculos) {
      if (v.destruido || v.conductor) continue;
      const d = v.pos.distanceTo(this.local.pos) - v.def.largo * 0.5;
      if (d < 2.2 && d < dm) { dm = d; mejor = v; }
    }
    return mejor;
  }

  disparoLocal(d) {
    const s = this.local;
    const def = d.def, clave = d.arma === 'rpg' ? 'rpg7' : FACCIONES[s.faccion].primaria;
    this.lanzarProyectil(clave, d.origen, d.dir, s.id, s.faccion, true);
    this.audio.disparo(d.origen, def.cohete ? 3 : 1, true);
    this.efectos.destello(d.origen, def.cohete ? 200 : 30, 0.05, '#ffb070', 12);
    if (def.cohete) { this.efectos.rebufo(d.origen, d.dir); this.sacudida = Math.max(this.sacudida, 0.5); }
    // Retroceso de la vista
    const r = def.retroceso * (this.arma.apuntado > 0.6 ? 0.7 : 1) * (s.quiereAgachar ? 0.75 : 1);
    this.vista.pitch += r * (0.7 + Math.random() * 0.4);
    this.vista.yaw += (Math.random() - 0.5) * r * 0.8;
    if (this.red) this.red.evento({ k: 'disp', c: clave, o: v3(d.origen), d: v3(d.dir, 1000) });
  }

  // Crea un proyectil a partir de la clave del arma (infantería o vehículo)
  lanzarProyectil(clave, origen, dir, duenoId, faccion, autoritativo) {
    let p;
    if (ARMAS[clave]) {
      const a = ARMAS[clave];
      this.contDisp = (this.contDisp || 0) + 1;
      p = a.cohete
        ? { tipo: 'cohete', vel: a.vel, velMax: a.velMax, danoSold: a.danoSold, dano: a.dano, radio: a.radio, explota: true, arma: a.nombre }
        : { tipo: 'bala', vel: a.vel, danoSold: a.danoSold, dano: a.dano, trazadora: this.contDisp % a.trazadora === 0, arma: a.nombre, calibre: 1 };
    } else {
      const [k, sub] = clave.split(':');
      const a = ARMAS_VEH[k];
      if (k === 'canon125') {
        const t = a.tipos[Number(sub) || 0];
        p = { tipo: 'obus', vel: t.vel, danoSold: t.danoSold, dano: t.dano, radio: t.radio, explota: t.explota, trazadora: true, arma: '125 mm ' + t.nombre };
      } else {
        this.contDisp = (this.contDisp || 0) + 1;
        p = { tipo: 'bala', vel: a.vel, danoSold: a.danoSold, dano: a.dano, trazadora: this.contDisp % a.trazadora === 0, cebo: a.cebo, arma: k === 'zu23' ? 'ZU-23-2' : k === 'kpvt' ? 'KPVT 14,5' : 'PKT' };
      }
    }
    Object.assign(p, { origen, dir, duenoId, faccion, local: autoritativo });
    return this.proyectiles.disparar(p);
  }

  // Disparo de un bot o soldado simulado localmente
  dispararSoldado(s, def, error, arma) {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
    dir.x += (Math.random() - 0.5) * 2 * error; dir.y += (Math.random() - 0.5) * 2 * error; dir.z += (Math.random() - 0.5) * 2 * error;
    dir.normalize();
    const origen = s.ojos(new THREE.Vector3()).add(new THREE.Vector3(Math.cos(s.yaw) * 0.15, -0.15, -Math.sin(s.yaw) * 0.15)).addScaledVector(dir, 0.7);
    const clave = arma === 'rpg' ? 'rpg7' : FACCIONES[s.faccion].primaria;
    this.lanzarProyectil(clave, origen, dir, s.id, s.faccion, true);
    this.efectoDisparoRemoto(s, origen, dir, clave);
  }

  efectoDisparoRemoto(s, origen, dir, clave) {
    const cohete = clave === 'rpg7';
    this.efectos.fogonazo(origen, cohete ? 1.2 : 0.5);
    this.efectos.destello(origen, cohete ? 150 : 25, 0.05, '#ffb070', 10);
    if (cohete) this.efectos.rebufo(origen, dir);
    const cal = cohete ? 3 : clave.startsWith('canon') ? 4 : clave === 'zu23' ? 2.2 : clave === 'kpvt' ? 2 : 1;
    this.audio.disparo(origen, cal, false);
    if (s && s.faccion !== this.local?.faccion && origen.distanceTo(this.local.pos) < 250) this.hud?.avistar(s.id);
  }

  // ---------------------------------------------------------------- vehículos
  intentarSubir(v) {
    if (this.red) { this.pendienteSubir = v; this.red.enviar({ t: 'subir', vid: v.id }); }
    else this.subir(v);
  }

  subir(v) {
    const s = this.local;
    this.vehLocal = v;
    v.conductor = s.id;
    v.local = true;
    s.enVehiculo = v.id;
    s.raiz.visible = false;
    this.arma.grupo.visible = false;
    v.apYaw = v.yaw + v.torYaw;
    v.apPitch = 0;
    this.estado = 'vehiculo';
    this.primeraPersona = false;
    this.zoomIdx = 0;
    this.entrada.setModo(v.def.oruga ? 'oruga' : 'ruedas');
    this.entrada.setEtiqueta('interactuar', 'BAJAR', true);
    this.hud.setModo('vehiculo');
    this.hud.el.aviso.textContent = '';
    this.hud.mensaje(`${v.nombre} · ${v.def.oruga ? 'Orugas: palanca izq./der.' : 'Acelerador izq. · dirección der.'}`, 3);
  }

  bajar(forzado = false) {
    const v = this.vehLocal, s = this.local;
    if (!v) return;
    // Buscar un hueco libre a los lados
    const lados = [[-1, 0], [1, 0], [0, 1], [0, -1]];
    const c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    for (const [lx, lz] of lados) {
      const dx = lx * (v.def.ancho / 2 + 1.0), dz = lz * (v.def.largo / 2 + 1.0);
      const p = { x: v.pos.x + dx * c + dz * sn, z: v.pos.z - dx * sn + dz * c };
      const q = { ...p };
      this.mundo.resolverCirculo(q, 0.35, this.mundo.getHeight(p.x, p.z), 1.7);
      if (Math.hypot(q.x - p.x, q.z - p.z) < 0.05 || lx === 0 && lz === -1) { s.pos.set(q.x, this.mundo.getHeight(q.x, q.z), q.z); break; }
    }
    v.conductor = null;
    v.local = false;
    v.canon.visible = true;
    s.enVehiculo = null;
    s.raiz.visible = false;
    this.arma.grupo.visible = true;
    this.vehLocal = null;
    if (this.red) this.red.enviar({ t: 'bajar', vid: v.id });
    if (s.vivo) {
      this.estado = 'infanteria';
      this.vista.yaw = v.yaw + v.torYaw; this.vista.pitch = 0;
      this.entrada.setModo('infanteria');
      this.hud.setModo('infanteria');
      this.camara.fov = this.ajustes.fov; this.camara.updateProjectionMatrix();
    }
    void forzado;
  }

  actualizarVehiculoLocal(dt, e) {
    const v = this.vehLocal, c = this.camara;
    if (!v || v.destruido) { this.bajar(true); return; }
    const zooms = v.def.zoom;
    const fovBase = this.primeraPersona ? zooms[Math.min(this.zoomIdx, 1)] : this.ajustes.fov;
    const sens = 0.0022 * (c.fov / this.ajustes.fov) * (this.primeraPersona ? 0.8 : 1);
    v.apYaw -= e.vistaX * sens;
    v.apPitch = clamp(v.apPitch - e.vistaY * sens, -0.3, v.def.torreta.elevMax + 0.1);
    if (e.flancos.has('camara')) { this.primeraPersona = !this.primeraPersona; this.zoomIdx = 0; }
    if (e.apuntar && !this.apuntarAntes && !this.entrada.tactil) e.flancos.add('zoom'); // clic derecho = zoom
    this.apuntarAntes = e.apuntar;
    if (e.flancos.has('zoom')) { this.primeraPersona = true; this.zoomIdx = (this.zoomIdx + 1) % (v.tipo === 'tanque' ? 3 : 2); }
    if (e.flancos.has('municion') && v.tipo === 'tanque') {
      v.municion = (v.municion + 1) % 2;
      v.tRecarga = ARMAS_VEH.canon125.recarga;
      this.hud.mensaje('Cargando ' + ARMAS_VEH.canon125.tipos[v.municion].nombre, 2);
    }
    if (e.flancos.has('interactuar')) { this.bajar(); return; }
    v.simular(dt, e);
    this.local.pos.copy(v.pos);
    this.sonidoVehiculo(v, true);
    // Polvo y humo de escape
    const vel = Math.abs(v.velActual || 0);
    if (vel > 1) {
      const atras = _v.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(v.def.largo / 2);
      this.efectos.polvoVehiculo(_v2.copy(v.pos).add(atras), Math.min(1, vel / 8) * 0.6);
    }
    this.efectos.escape(_v2.copy(v.pos).add(_v.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(v.def.largo / 2)).setY(v.pos.y + 1.6), 0.15 + Math.abs(e.orugaI + e.orugaD + e.acel) * 0.2);
    // Atropellos
    if (vel > 3) {
      for (const s of this.soldados.values()) {
        if (!s.vivo || s.enVehiculo || s === this.local) continue;
        const p = { x: s.pos.x, z: s.pos.z };
        if (v.empujarSoldado(p, 0.2)) this.danoSoldado(s, 200, this.local.id, v.nombre, _v.set(0, 0, 0));
      }
    }
    // Armas
    v.tRecarga = Math.max(0, v.tRecarga - dt);
    v.tCad -= dt; v.tCadCoax -= dt;
    this.armasVehiculo(v, e);
    // Cámara
    let termico = false;
    if (v.tipo !== 'tecnica') v.canon.visible = !this.primeraPersona; // el visor no ve su propio cañón
    if (this.primeraPersona) {
      v.camaraVisor(c);
      termico = this.zoomIdx === 2;
      const fov = this.zoomIdx === 0 ? zooms[0] : zooms[1];
      if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
      this.postfx.setPerfil(termico ? 'termico' : 'visor');
    } else {
      const dir = _v.set(0, 0, -1).applyEuler(new THREE.Euler(v.apPitch * 0.7 - 0.12, v.apYaw, 0, 'YXZ'));
      const foco = _v2.copy(v.pos).add(new THREE.Vector3(0, v.def.cam3.alto, 0));
      let dist = v.def.cam3.dist;
      const hit = this.mundo.segmento(foco, foco.clone().addScaledVector(dir, -dist), 1);
      if (hit) dist = Math.max(2, hit.t * dist - 0.5);
      c.position.copy(foco).addScaledVector(dir, -dist);
      c.position.y = Math.max(c.position.y, this.mundo.getHeight(c.position.x, c.position.z) + 0.6);
      c.lookAt(foco.clone().addScaledVector(dir, 30));
      if (c.fov !== this.ajustes.fov) { c.fov = this.ajustes.fov; c.updateProjectionMatrix(); }
      this.postfx.setPerfil('vehiculo3');
    }
    const sac = this.sacudida; this.sacudida = Math.max(0, sac - dt * 2);
    if (sac > 0) { c.rotation.x += (Math.random() - 0.5) * sac * 0.03; c.rotation.y += (Math.random() - 0.5) * sac * 0.03; }
    c.updateMatrixWorld();
    // HUD: punto real del arma y punto deseado
    const A = ARMAS_VEH[v.def.arma];
    let municion, carga;
    if (v.tipo === 'tanque') {
      municion = `${A.tipos[v.municion].nombre} · ${v.tRecarga > 0 ? 'CARGANDO' : 'LISTO'}  |  PKT ${v.coax}`;
      carga = 1 - v.tRecarga / A.recarga;
    } else {
      municion = `${v.def.arma === 'zu23' ? 'ZU-23-2 · 23 mm' : 'KPVT · 14,5 mm'} · ${v.tRecarga > 0 ? 'RECARGANDO' : v.cargador}`;
      carga = v.tRecarga > 0 ? 1 - v.tRecarga / A.recarga : 1;
    }
    const proyectar = (p) => {
      const q = p.clone().project(c);
      if (q.z > 1) return null;
      return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight];
    };
    const boca = v.boca.getWorldPosition(new THREE.Vector3());
    const dArma = v.dirArma(new THREE.Vector3());
    const h = this.mundo.segmento(boca, boca.clone().addScaledVector(dArma, 1500), 4);
    const pArma = h ? h.p : boca.clone().addScaledVector(dArma, 1500);
    const deseo = c.position.clone().add(new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(v.apPitch, v.apYaw, 0, 'YXZ')).multiplyScalar(500));
    this.hud.vehiculo(v, {
      primera: this.primeraPersona, termico, municion, carga,
      mira: this.primeraPersona ? null : proyectar(pArma),
      deseo: proyectar(deseo),
    });
  }

  armasVehiculo(v, e) {
    const A = ARMAS_VEH[v.def.arma];
    const yo = this.local;
    const dir = v.dirArma(new THREE.Vector3());
    if (v.def.arma === 'canon125') {
      if (e.disparar && v.tRecarga <= 0) {
        const boca = v.boca.getWorldPosition(new THREE.Vector3());
        const clave = 'canon125:' + v.municion;
        this.lanzarProyectil(clave, boca, dir.clone(), yo.id, yo.faccion, true);
        v.tRecarga = A.recarga;
        v.retroceso = 1;
        this.efectos.fogonazoCanon(boca, dir, 1.4);
        this.audio.disparo(boca, 4, false);
        this.sacudida = 0.8;
        this.levantarPolvo(v.pos, 8);
        if (this.red) this.red.evento({ k: 'disp', c: clave, o: v3(boca), d: v3(dir, 1000) });
      }
      if (e.ametralladora && v.tCadCoax <= 0 && v.coax > 0) this.rafagaVeh(v, 'pkt', v.bocaCoax, dir, 0.003);
    } else if (e.disparar && v.tRecarga <= 0 && v.tCad <= 0) {
      const bocas = v.boca2 ? [v.boca, v.boca2] : [v.boca];
      v.ultBoca = ((v.ultBoca || 0) + 1) % bocas.length;
      this.rafagaVeh(v, v.def.arma, bocas[v.ultBoca], dir, 0.004);
      v.cargador--;
      if (v.cargador <= 0) { v.tRecarga = A.recarga; v.cargador = A.cargador; }
    }
  }

  rafagaVeh(v, clave, bocaObj, dir, disp) {
    const A = ARMAS_VEH[clave];
    const boca = bocaObj.getWorldPosition(new THREE.Vector3());
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * disp * 2; d.y += (Math.random() - 0.5) * disp * 2; d.z += (Math.random() - 0.5) * disp * 2;
    d.normalize();
    this.lanzarProyectil(clave, boca, d, this.local.id, this.local.faccion, true);
    if (clave === 'pkt') { v.tCadCoax = 60 / A.cadencia; v.coax--; } else v.tCad = 60 / A.cadencia;
    this.efectos.fogonazo(boca, clave === 'pkt' ? 0.4 : 0.8);
    this.efectos.destello(boca, 60, 0.04, '#ffb070', 15);
    this.audio.disparo(boca, A.calibre, false);
    this.sacudida = Math.max(this.sacudida, clave === 'pkt' ? 0.05 : 0.15);
    if (this.red) this.red.evento({ k: 'disp', c: clave, o: v3(boca), d: v3(d, 1000) });
  }

  levantarPolvo(p, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      this.efectos.humo.emitir(p.x + Math.cos(a) * 3, this.mundo.getHeight(p.x, p.z) + 0.3, p.z + Math.sin(a) * 3, Math.cos(a) * 4, 0.5, Math.sin(a) * 4, 3, 1, 4, 0.5, 0.45, 0.37, 0.4, 0, 1);
    }
  }

  sonidoVehiculo(v, encendido) {
    if (!encendido) { if (v.sonido) { v.sonido.set(v.pos, 0, 0); } return; }
    if (!v.sonido) v.sonido = this.audio.motor(v.tipo === 'tanque' ? 'diesel' : v.tipo === 'mtlb' ? 'ligero' : 'camion');
    if (!v.sonido) return;
    const rpm = Math.min(1, Math.abs(v.velActual || 0) / v.def.vmax + (v.def.oruga ? Math.abs(v.vI - v.vD) / v.def.vmax * 0.5 : 0));
    v.sonido.set(v.pos, rpm, v === this.vehLocal ? 0.55 : 0.9);
  }

  // ---------------------------------------------------------------- dron
  lanzarDron() {
    if (this.dronesRest <= 0) { this.hud.mensaje('Sin drones FPV — vuelve a la base', 2); return; }
    if (this.dronLocal) return;
    this.dronesRest--;
    const s = this.local;
    const id = s.id + '_d' + Math.floor(Math.random() * 1e6);
    const d = new Dron(this, { id, duenoId: s.id, faccion: s.faccion });
    d.camara.aspect = innerWidth / innerHeight; d.camara.updateProjectionMatrix();
    const p = s.pos.clone().add(new THREE.Vector3(-Math.sin(this.vista.yaw) * 1.2, 1.3, -Math.cos(this.vista.yaw) * 1.2));
    d.lanzar(p, this.vista.yaw);
    d.modo = this.ajustes.modoDron || 'ANGLE';
    this.drones.set(id, d);
    this.dronLocal = d;
    s.quiereAgachar = true;
    s.vel.set(0, 0, 0);
    s.raiz.visible = true; // el operador queda visible desde el dron
    this.estado = 'dron';
    this.entrada.setModo('dron');
    // Gas al punto de vuelo estacionario para el lanzamiento a mano
    this.entrada.acelDron = 0.5; this.entrada.joys.dronI.y = 0; this.entrada.joys.dronI.pintar();
    this.entrada.setEtiqueta('modoVuelo', d.modo, true);
    this.camaraActiva = d.camara;
    this.postfx.setCamara(d.camara);
    this.postfx.setPerfil('dron');
    this.arma.grupo.visible = false;
    this.hud.setModo('dron');
    this.hud.mensaje(`Dron FPV lanzado · quedan ${this.dronesRest}`, 2);
  }

  actualizarDronLocal(dt, e) {
    const d = this.dronLocal, s = this.local;
    if (!d) { this.volverDeDron(); return; }
    if (e.flancos.has('modoVuelo')) { d.modo = d.modo === 'ANGLE' ? 'ACRO' : 'ANGLE'; this.ajustes.modoDron = d.modo; this.entrada.setEtiqueta('modoVuelo', d.modo, true); }
    // El operador permanece agachado e inmóvil
    this.moverSoldado(s, 0, 0, 0, dt);
    const r = d.simular(dt, e, s.pos);
    d.actualizarVisual(dt, true);
    this.postfx.senal = d.senal;
    this.hud.dron(d, s.pos);
    if (r?.detonar || e.flancos.has('detonar')) {
      const punto = r?.punto || d.pos.clone();
      this.detonarDron(d, punto, r?.objetivo);
      return;
    }
    if (d.senal < 0.05) { this.hud.mensaje('SEÑAL PERDIDA', 2); this.quitarDron(d, true); this.volverDeDron(); return; }
    if (e.flancos.has('salirDron')) { this.hud.mensaje('Dron abandonado', 1.5); this.quitarDron(d, true); this.volverDeDron(); }
  }

  detonarDron(d, punto, objetivo) {
    this.explosion(punto, {
      radio: 7, danoSold: 220, dano: { pesado: 650, ligero: 800, ninguno: 800 }, duenoId: d.duenoId, faccion: d.faccion,
      directo: objetivo?.vehiculo || null, tam: 1.1, arma: 'Dron FPV', dron: d.id,
    });
    this.quitarDron(d, false);
    if (d === this.dronLocal) { this.postfx.senal = 0; this.volverDeDron(0.6); }
  }

  quitarDron(d, avisar = true) {
    d.destruir();
    this.drones.delete(d.id);
    if (avisar && this.red && d.duenoId === this.idLocal) this.red.evento({ k: 'dronD', id: d.id });
  }

  volverDeDron(estatica = 0) {
    this.dronLocal = null;
    this.camaraActiva = this.camara;
    this.postfx.setCamara(this.camara);
    this.postfx.senal = 1;
    if (estatica) this.postfx.destello = 0;
    if (!this.local.vivo) return;
    this.local.raiz.visible = false;
    this.estado = 'infanteria';
    this.arma.grupo.visible = true;
    this.entrada.setModo('infanteria');
    this.hud.setModo('infanteria');
  }

  // ---------------------------------------------------------------- muerte y reaparición
  actualizarMuerto(dt, e) {
    this.tMuerto -= dt;
    const s = this.local, c = this.camara;
    const t = Math.min(1, (6 - this.tMuerto) / 3);
    c.position.set(s.pos.x + 1.5, s.pos.y + 1.0 + t * 4, s.pos.z + 3 + t * 3);
    c.lookAt(s.pos.x, s.pos.y + 0.3, s.pos.z);
    this.postfx.setPerfil('bodycam');
    this.hud.muerte(this.textoMuerte, this.tMuerto);
    if (this.tMuerto <= 0) this.reaparecer();
    void e;
  }

  reaparecer() {
    const s = this.local, B = this.mundo.bases[s.faccion];
    const p = B.spawns[Math.floor(Math.random() * B.spawns.length)].clone();
    s.revivir(p, B.yaw);
    s.raiz.visible = false;
    s.protegido = 3;
    s.quiereAgachar = false;
    this.vista.yaw = B.yaw; this.vista.pitch = 0;
    this.arma.reponer();
    this.arma.setArma('fusil');
    this.arma.grupo.visible = true;
    this.dronesRest = 3;
    this.estado = 'infanteria';
    this.camaraActiva = this.camara;
    this.postfx.setCamara(this.camara);
    this.camara.fov = this.ajustes.fov; this.camara.updateProjectionMatrix();
    this.entrada.setModo('infanteria');
    this.hud.setModo('infanteria');
    if (this.red) this.red.evento({ k: 'reap' });
  }

  gestionarBot(s, dt) {
    if (s.vivo) return;
    s.tReaparecer = (s.tReaparecer || 0) + dt;
    if (s.tReaparecer > 8) {
      const B = this.mundo.bases[s.faccion];
      s.revivir(B.spawns[Math.floor(Math.random() * B.spawns.length)], B.yaw);
      s.protegido = 3;
      s.tReaparecer = 0;
      const ia = this.bots.find((b) => b.s === s);
      if (ia) { ia.rpg = 2; ia.cargador = ia.def.cargador; ia.objetivo = null; ia.destino = ia.elegirDestino(); s.setArma('fusil'); }
    }
  }

  // ---------------------------------------------------------------- combate
  impactoSegmento(a, b, opc = {}) {
    let mejor = this.mundo.segmento(a, b, 1.0, opc.proyectil?.tipo === 'obus');
    const ab = _v.subVectors(b, a);
    const len2 = ab.lengthSq();
    const radioExtra = opc.radioSoldado || 0;
    for (const s of this.soldados.values()) {
      if (!s.vivo || s.id === opc.duenoId || s.enVehiculo) continue;
      // Descarte rápido
      const t0 = clamp(_v2.subVectors(s.pos, a).dot(ab) / len2, 0, 1);
      const cx = a.x + ab.x * t0 - s.pos.x, cy = a.y + ab.y * t0 - (s.pos.y + 1), cz = a.z + ab.z * t0 - s.pos.z;
      if (cx * cx + cy * cy + cz * cz > 4) continue;
      for (const caja of s.cajas) {
        const t = segSphere(a, b, caja.c, caja.r + radioExtra);
        if (t >= 0 && (!mejor || t < mejor.t)) mejor = { t, soldado: s, parte: caja.parte, mat: 'carne', n: ab.clone().normalize().negate() };
      }
    }
    for (const v of this.vehiculos) {
      if (opc.duenoId && v.conductor === opc.duenoId) continue;
      const h = v.impacto(a, b);
      if (h && (!mejor || h.t < mejor.t)) mejor = { t: h.t, vehiculo: v, n: h.n, mat: 'blindaje' };
    }
    for (const d of this.drones.values()) {
      if (!d.vivo || d === opc.ignorarDron || d.duenoId === opc.duenoId) continue;
      const t = segSphere(a, b, d.pos, 0.4);
      if (t >= 0 && (!mejor || t < mejor.t)) mejor = { t, dron: d, mat: 'metal', n: ab.clone().normalize().negate() };
    }
    if (mejor && !mejor.p) mejor.p = a.clone().addScaledVector(ab, mejor.t);
    return mejor;
  }

  alImpactar(b, imp) {
    const mat = imp.mat === 'carne' ? null : imp.mat;
    if (b.tipo === 'bala') {
      if (imp.soldado) this.efectos.sangre(imp.p, imp.n.clone().negate());
      else if (mat && mat !== 'aire') this.efectos.impacto(imp.p, imp.n, mat);
      if (mat && mat !== 'aire') this.audio.impacto(imp.p, mat);
      if (!b.local) return;
      if (imp.soldado) {
        const mult = imp.parte === 'cabeza' ? 3.5 : imp.parte === 'pierna' ? 0.65 : 1;
        this.danoSoldado(imp.soldado, b.danoSold * mult, b.duenoId, b.arma, imp.n);
      } else if (imp.vehiculo) this.danoVehiculo(imp.vehiculo, b.dano[imp.vehiculo.def.blindaje] || 0, b.duenoId);
      else if (imp.dron) this.derribarDron(imp.dron, b.duenoId);
      return;
    }
    if (b.explota) {
      if (!b.local) return; // la explosión autoritativa llega por red
      this.explosion(imp.p.clone().addScaledVector(imp.n, 0.3), { radio: b.radio, danoSold: b.danoSold, dano: b.dano, duenoId: b.duenoId, faccion: b.faccion, directo: imp.vehiculo || null, tam: b.tipo === 'obus' ? 1.6 : 1, arma: b.arma });
      if (imp.soldado) this.danoSoldado(imp.soldado, 300, b.duenoId, b.arma, imp.n);
      if (imp.dron) this.derribarDron(imp.dron, b.duenoId);
      return;
    }
    // Penetrador cinético (APFSDS)
    this.efectos.impacto(imp.p, imp.n, 'metal');
    this.efectos.impacto(imp.p, imp.n, mat === 'blindaje' ? 'metal' : 'tierra');
    this.efectos.destello(imp.p, 300, 0.1, '#ffd0a0', 20);
    this.audio.impacto(imp.p, 'metal');
    this.audio.explosion(imp.p, 0.4);
    if (!b.local) return;
    if (imp.vehiculo) this.danoVehiculo(imp.vehiculo, b.dano[imp.vehiculo.def.blindaje], b.duenoId);
    else if (imp.soldado) this.danoSoldado(imp.soldado, b.danoSold, b.duenoId, b.arma, imp.n);
    else if (mat === 'tierra') this.explosion(imp.p, { radio: 2, danoSold: 60, dano: {}, duenoId: b.duenoId, faccion: b.faccion, tam: 0.4, arma: b.arma });
  }

  // Explosión: efectos para todos; daño solo en el cliente autoritativo (opc.remota = false)
  explosion(p, o, remota = false) {
    const tam = o.tam || 1;
    this.efectos.explosion(p, tam);
    this.audio.explosion(p, tam);
    const h = this.mundo.getHeight(p.x, p.z);
    if (p.y - h < 1.2) this.mundo.crater(p.x, p.z, 1.2 + tam * 1.4, 0.35 + tam * 0.35);
    const cam = this.camaraActiva.getWorldPosition(_v);
    const d = cam.distanceTo(p);
    if (d < 50) {
      const k = 1 - d / 50;
      this.sacudida = Math.max(this.sacudida, k * 1.5 * tam);
      this.postfx.destello = Math.max(this.postfx.destello, k * k * 0.6);
      if (d < 14 && this.estado !== 'dron') { this.audio.pitido(2.5); this.postfx.desenfoque = 1.2; }
    }
    if (o.dron) { const dr = this.drones.get(o.dron); if (dr) { dr.destruir(); this.drones.delete(o.dron); } }
    if (remota) return;
    if (this.red) this.red.evento({ k: 'exp', p: v3(p), tam, dron: o.dron || null });
    const R = o.radio || 5;
    for (const s of this.soldados.values()) {
      if (!s.vivo || s.enVehiculo) continue;
      const centro = _v2.set(s.pos.x, s.pos.y + 1, s.pos.z);
      const dist = centro.distanceTo(p);
      if (dist > R) continue;
      let dano = o.danoSold * Math.pow(1 - dist / R, 1.3);
      if (!this.mundo.lineaVision(p.clone().add(new THREE.Vector3(0, 0.3, 0)), centro)) dano *= 0.35;
      this.danoSoldado(s, dano, o.duenoId, o.arma, centro.clone().sub(p).normalize());
    }
    for (const v of this.vehiculos) {
      if (v.destruido) continue;
      if (v === o.directo) { this.danoVehiculo(v, o.dano[v.def.blindaje] || 0, o.duenoId); continue; }
      const dist = v.pos.distanceTo(p) - v.def.largo * 0.3;
      if (dist < R * 0.5) this.danoVehiculo(v, (o.dano[v.def.blindaje] || 0) * 0.35 * (1 - dist / (R * 0.5)), o.duenoId);
    }
    for (const dr of [...this.drones.values()]) if (dr.vivo && dr.pos.distanceTo(p) < R) this.derribarDron(dr, o.duenoId);
  }

  danoSoldado(s, dano, atacanteId, arma, dir) {
    if (!s.vivo || dano <= 0) return;
    const atacante = this.soldados.get(atacanteId);
    if (atacante && atacante !== s && atacante.faccion === s.faccion) return; // sin fuego amigo
    if (atacanteId === this.idLocal && s !== this.local) this.hud.impacto(s.vida - dano <= 0);
    if (s.esLocal || s.esBot) this.aplicarDano(s, dano, atacanteId, arma, dir);
    else if (this.red) this.red.evento({ k: 'golpe', obj: s.id, d: Math.round(dano), a: arma, dir: v3(dir, 100) });
  }

  aplicarDano(s, dano, atacanteId, arma, dir) {
    if (!s.vivo || s.protegido > 0) return;
    s.vida -= dano;
    if (s === this.local) {
      this.sacudida = Math.max(this.sacudida, 0.3);
      if (dir && dir.lengthSq() > 0) {
        const angMundo = Math.atan2(-dir.x, -dir.z); // hacia el atacante
        this.hud.dano(wrapAngle(this.vista.yaw - angMundo + Math.PI));
      }
    }
    if (s.vida <= 0) this.morir(s, atacanteId, arma);
  }

  morir(s, asesinoId, arma, remoto = false) {
    if (!s.vivo) return;
    s.matar();
    const asesino = this.soldados.get(asesinoId);
    if (asesino && asesino !== s) { asesino.kills++; this.puntos[asesino.faccion]++; }
    else this.puntos[s.faccion === 'UA' ? 'RU' : 'UA']++;
    const colA = asesino ? FACCIONES[asesino.faccion].color : '#ccc', colV = FACCIONES[s.faccion].color;
    this.hud.baja(asesino ? asesino.nombre : '—', arma || '', s.nombre, colA, colV);
    if (s === this.local) {
      s.raiz.visible = true;
      if (this.dronLocal) { this.quitarDron(this.dronLocal); this.dronLocal = null; this.camaraActiva = this.camara; this.postfx.setCamara(this.camara); }
      if (this.vehLocal) this.bajar(true);
      this.estado = 'muerto';
      this.tMuerto = 6;
      this.arma.grupo.visible = false;
      this.entrada.setModo('menu');
      this.hud.setModo('muerto');
      this.textoMuerte = asesino && asesino !== s ? `Abatido por <b>${asesino.nombre}</b> · ${arma || ''}` : 'Has caído';
      if (this.red && !remoto) this.red.evento({ k: 'muerte', a: asesinoId, w: arma });
    }
    // Fin de ronda
    for (const f of ['UA', 'RU']) if (this.puntos[f] >= 25) {
      this.hud.mensaje(`Victoria de ${FACCIONES[f].nombre} · nueva ronda`, 6);
      this.puntos = { UA: 0, RU: 0 };
    }
  }

  danoVehiculo(v, cant, atacanteId) {
    if (cant <= 0 || v.destruido) return;
    if (atacanteId === this.idLocal) this.hud.impacto(v.vida - cant <= 0);
    if (this.red) this.red.evento({ k: 'vdano', v: v.id, c: Math.round(cant) });
    this.aplicarDanoVehiculo(v, cant, atacanteId);
  }

  aplicarDanoVehiculo(v, cant, atacanteId) {
    const conductor = v.conductor ? this.soldados.get(v.conductor) : null;
    if (v === this.vehLocal) { this.sacudida = Math.max(this.sacudida, Math.min(1.5, cant / 200)); this.postfx.destello = Math.min(0.5, cant / 1500); }
    if (v.danar(cant) && conductor) {
      if (conductor === this.local) { this.bajar(true); this.morir(conductor, atacanteId, 'destrucción de ' + v.nombre); }
      else if (conductor.esBot) this.morir(conductor, atacanteId, v.nombre);
    }
  }

  derribarDron(d, atacanteId) {
    if (!d.vivo) return;
    this.efectos.impacto(d.pos, new THREE.Vector3(0, 1, 0), 'metal');
    const pos = d.pos.clone();
    const atacante = this.soldados.get(atacanteId);
    if (atacanteId === this.idLocal) { this.hud.impacto(true); this.hud.mensaje('Dron enemigo derribado', 1.5); }
    // Algunos detonan al ser alcanzados
    if (Math.random() < 0.4) this.explosion(pos, { radio: 5, danoSold: 150, dano: { pesado: 200, ligero: 400, ninguno: 400 }, duenoId: d.duenoId, faccion: d.faccion, tam: 0.8, arma: 'Dron FPV', dron: d.id });
    else this.quitarDron(d, true);
    if (d === this.dronLocal) { this.hud.mensaje('DRON DERRIBADO', 2); this.volverDeDron(0.6); }
    else if (this.red && d.duenoId !== this.idLocal) this.red.evento({ k: 'dronD', id: d.id });
    void atacante;
  }

  // ---------------------------------------------------------------- red
  configurarRed(bienv) {
    const R = this.red;
    for (const j of bienv.jugadores) this.crearRemoto(j.id, j.nombre, j.faccion);
    this.ocupantesIniciales = bienv.ocupantes || {};
    R.on('entra', (m) => { this.crearRemoto(m.id, m.nombre, m.faccion); this.hud?.mensaje(`${m.nombre} se ha unido (${m.faccion})`, 3); });
    R.on('sale', (m) => this.quitarRemoto(m.id));
    R.on('est', (m) => {
      if (!this.soldados.has(m.id)) this.crearRemoto(m.id, m.s.n || 'Jugador', m.s.f || 'RU');
      this.estadosRemotos.set(m.id, m.s);
    });
    R.on('ev', (m) => this.eventoRemoto(m.id, m.e));
    R.on('ocup', (m) => {
      const v = this.vehiculos.find((x) => x.id === m.vid);
      if (!v) return;
      if (m.id !== this.idLocal) v.conductor = m.id;
      if (m.id === null && v !== this.vehLocal) v.conductor = null;
    });
    R.on('subirOk', (m) => { const v = this.vehiculos.find((x) => x.id === m.vid); if (v && this.estado === 'infanteria' && this.local.vivo) this.subir(v); else this.red.enviar({ t: 'bajar', vid: m.vid }); });
    R.on('subirNo', () => this.hud.mensaje('Vehículo ocupado', 1.5));
    R.on('desconexion', () => this.hud?.mensaje('Conexión perdida con el servidor', 10));
    setTimeout(() => {
      for (const [vid, id] of Object.entries(this.ocupantesIniciales)) { const v = this.vehiculos.find((x) => x.id === vid); if (v) v.conductor = id; }
    }, 0);
  }

  crearRemoto(id, nombre, faccion) {
    if (this.soldados.has(id)) return this.soldados.get(id);
    const s = new Soldado({ id, nombre, faccion });
    this.soldados.set(id, s);
    this.scene.add(s.raiz);
    if (this.local && faccion === this.local.faccion) s.ponerEtiqueta(FACCIONES[faccion].color);
    else if (!this.local) s._etiquetaPendiente = true;
    s.raiz.visible = false;
    return s;
  }

  quitarRemoto(id) {
    const s = this.soldados.get(id);
    if (!s) return;
    this.scene.remove(s.raiz);
    this.soldados.delete(id);
    this.estadosRemotos.delete(id);
    for (const v of this.vehiculos) if (v.conductor === id) v.conductor = null;
    for (const d of [...this.drones.values()]) if (d.duenoId === id) this.quitarDron(d, false);
    this.hud.mensaje(`${s.nombre} ha salido`, 3);
  }

  aplicarRemoto(s, dt) {
    const st = this.estadosRemotos.get(s.id);
    if (!st) return;
    if (s._etiquetaPendiente && this.local) { if (s.faccion === this.local.faccion) s.ponerEtiqueta(FACCIONES[s.faccion].color); s._etiquetaPendiente = false; }
    if (st.vi && !s.vivo) { s.revivir(new THREE.Vector3(...st.p), st.y); }
    if (!s.vivo) return;
    const objetivo = _v.set(st.p[0], st.p[1], st.p[2]);
    const k = 1 - Math.exp(-14 * dt);
    const antes = s.pos.clone();
    if (s.pos.distanceTo(objetivo) > 8) s.pos.copy(objetivo); else s.pos.lerp(objetivo, k);
    s.vel.subVectors(s.pos, antes).divideScalar(Math.max(dt, 1e-3));
    s.yaw = s.yaw + wrapAngle(st.y - s.yaw) * k;
    s.pitch += (st.pi - s.pitch) * k;
    s.quiereAgachar = !!st.ag;
    s.vida = st.hp;
    if (s.arma !== (st.ar ? 'rpg' : 'fusil')) s.setArma(st.ar ? 'rpg' : 'fusil');
    s.enVehiculo = st.vh || null;
    s.raiz.visible = !s.enVehiculo;
    if (st.d && !this.drones.has(st.d.id)) {
      const d = new Dron(this, { id: st.d.id, duenoId: s.id, faccion: s.faccion });
      d.pos.set(...st.d.p);
      this.drones.set(d.id, d);
    }
  }

  enviarEstado() {
    const s = this.local;
    const r = (x) => Math.round(x * 100) / 100;
    const st = { n: s.nombre, f: s.faccion, p: [r(s.pos.x), r(s.pos.y), r(s.pos.z)], y: r(s.yaw), pi: r(s.pitch), ag: s.quiereAgachar ? 1 : 0, vi: s.vivo ? 1 : 0, ar: s.arma === 'rpg' ? 1 : 0, hp: Math.round(s.vida), vh: this.vehLocal?.id || null };
    if (this.vehLocal) st.v = this.vehLocal.estadoRed();
    if (this.dronLocal) st.d = this.dronLocal.estadoRed();
    this.red.estado(st);
  }

  eventoRemoto(id, e) {
    const s = this.soldados.get(id);
    switch (e.k) {
      case 'disp': {
        const o = new THREE.Vector3(...e.o), d = new THREE.Vector3(...e.d).normalize();
        this.lanzarProyectil(e.c, o, d, id, s?.faccion, false);
        this.efectoDisparoRemoto(s, o, d, e.c.split(':')[0]);
        if (e.c.startsWith('canon')) this.efectos.fogonazoCanon(o, d, 1.4);
        break;
      }
      case 'golpe':
        if (e.obj === this.idLocal) this.aplicarDano(this.local, e.d, id, e.a, new THREE.Vector3(...(e.dir || [0, 0, 0])));
        break;
      case 'muerte':
        if (s) this.morir(s, e.a, e.w, true);
        break;
      case 'vdano': {
        const v = this.vehiculos.find((x) => x.id === e.v);
        if (v) this.aplicarDanoVehiculo(v, e.c, id);
        break;
      }
      case 'exp':
        this.explosion(new THREE.Vector3(...e.p), { tam: e.tam, dron: e.dron }, true);
        break;
      case 'dronD': {
        const d = this.drones.get(e.id);
        if (d) { this.efectos.impacto(d.pos, new THREE.Vector3(0, 1, 0), 'metal'); this.quitarDron(d, false); if (d === this.dronLocal) this.volverDeDron(0.6); }
        break;
      }
      case 'arbol': {
        const a = this.mundo.arboles[e.i];
        if (a) this.mundo.derribarArbol(a, e.dx, e.dz);
        break;
      }
      case 'reap':
        if (s) { s.vivo = false; }
        break;
    }
  }

  alDerribarArbol(a) {
    if (this.red && this.vehLocal) this.red.evento({ k: 'arbol', i: this.mundo.arboles.indexOf(a), dx: -Math.sin(this.vehLocal.yaw), dz: -Math.cos(this.vehLocal.yaw) });
  }

  alPasarBala() {
    this.sacudida = Math.max(this.sacudida, 0.12);
  }
}

function v3(v, escala = 100) {
  const r = (x) => Math.round(x * escala) / escala;
  return [r(v.x), r(v.y), r(v.z)];
}
