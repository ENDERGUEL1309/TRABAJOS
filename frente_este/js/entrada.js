// Entrada unificada: teclado + ratón (pointer lock), controles táctiles por modo y mando (Gamepad API).
import { clamp } from './util.js';

class Joystick {
  constructor(padre, id, { ejeX = true, ejeY = true, centrarX = true, centrarY = true, etiqueta = '', modos }) {
    Object.assign(this, { ejeX, ejeY, centrarX, centrarY });
    this.x = 0; this.y = 0; this.puntero = null;
    const el = document.createElement('div');
    el.className = 'joy' + (!ejeX ? ' vertical' : '') + (!ejeY ? ' horizontal' : '');
    el.id = id;
    el.dataset.modos = modos;
    el.innerHTML = `<div class="joy-base"></div><div class="joy-pomo"></div>${etiqueta ? `<span class="joy-etq">${etiqueta}</span>` : ''}`;
    padre.appendChild(el);
    this.el = el;
    this.pomo = el.querySelector('.joy-pomo');
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.puntero = e.pointerId; el.setPointerCapture(e.pointerId); this.mover(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.puntero) { e.preventDefault(); this.mover(e); } });
    const fin = (e) => {
      if (e.pointerId !== this.puntero) return;
      this.puntero = null;
      if (this.centrarX) this.x = 0;
      if (this.centrarY) this.y = 0;
      this.pintar();
    };
    el.addEventListener('pointerup', fin);
    el.addEventListener('pointercancel', fin);
    this.pintar();
  }
  mover(e) {
    const r = this.el.getBoundingClientRect();
    const rx = (r.width / 2) * 0.8, ry = (r.height / 2) * 0.8;
    let x = (e.clientX - (r.left + r.width / 2)) / rx, y = -(e.clientY - (r.top + r.height / 2)) / ry;
    if (this.ejeX && this.ejeY) { const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } }
    this.x = this.ejeX ? clamp(x, -1, 1) : 0;
    this.y = this.ejeY ? clamp(y, -1, 1) : 0;
    this.pintar();
  }
  pintar() {
    const r = this.el.getBoundingClientRect();
    const rx = (r.width / 2) * 0.8, ry = (r.height / 2) * 0.8;
    this.pomo.style.transform = `translate(calc(-50% + ${this.x * rx}px), calc(-50% + ${-this.y * ry}px))`;
  }
  reset() { this.x = 0; this.y = 0; this.puntero = null; this.pintar(); }
}

const BOTONES = [
  // id, etiqueta, modos, tipo (mantener|pulsar)
  ['apuntar', 'MIRA', 'infanteria', 'mantener'],
  ['disparar', 'FUEGO', 'infanteria,oruga,ruedas,heli,avion', 'mantener'],
  ['recargar', 'RECARGA', 'infanteria', 'pulsar'],
  ['saltar', 'SALTO', 'infanteria', 'pulsar'],
  ['agachar', 'AGACHAR', 'infanteria', 'pulsar'],
  ['cambiarArma', 'ARMA', 'infanteria', 'pulsar'],
  ['interactuar', 'SUBIR', 'infanteria,oruga,ruedas,heli,avion', 'pulsar'],
  ['granada', 'GRANADA', 'infanteria', 'pulsar'],
  ['mapa', 'MAPA', 'infanteria,oruga,ruedas,heli,avion', 'pulsar'],
  ['cohetes', 'COHETES', 'heli,avion', 'mantener'],
  ['bomba', 'BOMBA', 'avion', 'pulsar'],
  ['dron', 'DRON FPV', 'infanteria', 'pulsar'],
  ['camara', '1ª / 3ª', 'oruga,ruedas,heli,avion', 'pulsar'],
  ['zoom', 'ZOOM', 'oruga,ruedas', 'pulsar'],
  ['municion', 'MUNICIÓN', 'oruga', 'pulsar'],
  ['detonar', 'DETONAR', 'dron', 'pulsar'],
  ['modoVuelo', 'ESTABLE', 'dron', 'pulsar'],
  ['salirDron', 'VOLVER', 'dron', 'pulsar'],
  ['ametralladora', 'AMETR.', 'oruga', 'mantener'],
];

export class Entrada {
  constructor(lienzo, contenedor, ajustes) {
    this.lienzo = lienzo;
    this.ajustes = ajustes;
    this.modo = 'menu';
    this.teclas = new Set();
    this.raton = { izq: false, der: false, dx: 0, dy: 0 };
    this.mantenidos = {};
    this.flancos = new Set();
    this.vista = { dx: 0, dy: 0 };
    this.acelDron = 0;
    this.tactil = ajustes.tactil;
    this.cont = contenedor;

    // --- Teclado ---
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (!this.teclas.has(e.code)) this.flancosTecla(e.code);
      this.teclas.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.teclas.delete(e.code));
    addEventListener('blur', () => { this.teclas.clear(); this.raton.izq = this.raton.der = false; });

    // --- Ratón ---
    lienzo.addEventListener('mousedown', (e) => {
      if (this.tactil || this.modo === 'menu') return;
      if (document.pointerLockElement !== lienzo) { lienzo.requestPointerLock?.(); return; }
      if (e.button === 0) this.raton.izq = true;
      if (e.button === 2) this.raton.der = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.raton.izq = false; if (e.button === 2) this.raton.der = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === lienzo) { this.raton.dx += e.movementX; this.raton.dy += e.movementY; }
    });
    lienzo.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Controles táctiles ---
    this.construirTactil();
  }

  construirTactil() {
    const c = this.cont;
    c.innerHTML = '';
    // Zona de mirada (toda la pantalla, por debajo de los controles)
    const zona = document.createElement('div');
    zona.id = 'zonaVista';
    c.appendChild(zona);
    const punteros = new Map();
    zona.addEventListener('pointerdown', (e) => { e.preventDefault(); zona.setPointerCapture(e.pointerId); punteros.set(e.pointerId, [e.clientX, e.clientY]); });
    zona.addEventListener('pointermove', (e) => {
      const p = punteros.get(e.pointerId);
      if (!p) return;
      this.vista.dx += e.clientX - p[0]; this.vista.dy += e.clientY - p[1];
      p[0] = e.clientX; p[1] = e.clientY;
    });
    const fin = (e) => punteros.delete(e.pointerId);
    zona.addEventListener('pointerup', fin); zona.addEventListener('pointercancel', fin);

    this.joys = {
      mov: new Joystick(c, 'joyMov', { modos: 'infanteria' }),
      orugaI: new Joystick(c, 'palancaI', { ejeX: false, modos: 'oruga', etiqueta: 'ORUGA IZQ' }),
      orugaD: new Joystick(c, 'palancaD', { ejeX: false, modos: 'oruga', etiqueta: 'ORUGA DER' }),
      acel: new Joystick(c, 'joyAcel', { ejeX: false, modos: 'ruedas', etiqueta: 'ACELERAR / FRENAR' }),
      dir: new Joystick(c, 'joyDir', { ejeY: false, modos: 'ruedas', etiqueta: 'DIRECCIÓN' }),
      dronI: new Joystick(c, 'joyDronI', { centrarY: false, modos: 'dron,heli,avion', etiqueta: 'SUBIR/BAJAR · GIRO' }),
      dronD: new Joystick(c, 'joyDronD', { modos: 'dron,heli,avion', etiqueta: 'CABECEO · ALABEO' }),
    };
    // Acelerador del dron empieza abajo
    this.joys.dronI.y = -1; this.joys.dronI.pintar();

    this.botones = {};
    for (const [id, etq, modos, tipo] of BOTONES) {
      const b = document.createElement('div');
      b.className = 'btn';
      b.id = 'btn-' + id;
      b.dataset.modos = modos;
      b.textContent = etq;
      c.appendChild(b);
      this.botones[id] = b;
      let ultimo = null;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('activo');
        this.mantenidos[id] = true;
        if (tipo === 'pulsar') this.flancos.add(id);
        ultimo = [e.clientX, e.clientY];
      });
      // Arrastrar sobre FUEGO también gira la vista (como en los shooters móviles)
      b.addEventListener('pointermove', (e) => {
        if (!ultimo || id !== 'disparar') return;
        this.vista.dx += e.clientX - ultimo[0]; this.vista.dy += e.clientY - ultimo[1];
        ultimo = [e.clientX, e.clientY];
      });
      const fin = () => { b.classList.remove('activo'); this.mantenidos[id] = false; ultimo = null; };
      b.addEventListener('pointerup', fin); b.addEventListener('pointercancel', fin);
    }
    this.setModo(this.modo);
  }

  flancosTecla(code) {
    const m = {
      KeyR: 'recargar', Space: 'saltar', KeyC: 'agachar', KeyX: 'agachar', Digit1: 'arma1', Digit2: 'arma2', Digit3: 'arma3', KeyF: 'interactuar', KeyE: 'granada', KeyM: 'mapa',
      KeyG: 'dron', KeyV: 'camara', KeyN: 'zoom', KeyT: 'municion', Backspace: 'detonar', KeyB: 'modoVuelo',
      Escape: 'salirDron', Tab: 'marcador', KeyH: 'ayuda', KeyQ: 'cambiarArma',
    };
    if (m[code]) this.flancos.add(m[code]);
    if (this.modo === 'dron' && code === 'KeyF') this.flancos.add('detonar');
    if (this.modo === 'avion' && code === 'KeyB') { this.flancos.delete('modoVuelo'); this.flancos.add('bomba'); }
  }

  setModo(modo) {
    this.modo = modo;
    this.cont.dataset.modo = modo;
    this.cont.style.display = this.tactil && modo !== 'menu' ? 'block' : 'none';
    for (const el of this.cont.querySelectorAll('[data-modos]')) el.style.display = el.dataset.modos.split(',').includes(modo) ? '' : 'none';
    for (const j of Object.values(this.joys)) { if (j !== this.joys.dronI) j.reset(); }
    this.mantenidos = {};
    const etq = this.joys.dronI.el.querySelector('.joy-etq');
    if (modo === 'heli') { this.joys.dronI.centrarY = true; this.joys.dronI.reset(); etq.textContent = 'SUBIR/BAJAR · GIRO'; }
    if (modo === 'avion') { this.joys.dronI.centrarY = false; this.joys.dronI.x = 0; this.joys.dronI.y = 0; this.joys.dronI.pintar(); this.acelDron = 0.5; etq.textContent = 'GAS · TIMÓN'; }
  }

  // ESTABLE: el stick izquierdo vuelve al centro y controla la velocidad de subida (mantiene altura).
  // ANGLE/ACRO: gas manual que no vuelve al centro, empezando en vuelo estacionario.
  configurarDron(modo) {
    const j = this.joys.dronI;
    j.centrarY = modo === 'ESTABLE';
    j.x = 0; j.y = 0; j.pintar();
    this.acelDron = 0.5;
    j.el.querySelector('.joy-etq').textContent = modo === 'ESTABLE' ? 'SUBIR/BAJAR · GIRO' : 'GAS · GUIÑADA';
  }

  setEtiqueta(id, texto, visible = true) {
    const b = this.botones[id];
    if (!b) return;
    if (b.textContent !== texto) b.textContent = texto;
    b.classList.toggle('oculto', !visible);
  }

  // Lee y consume la entrada del fotograma.
  leer(dt) {
    const T = this.teclas, k = (c) => (T.has(c) ? 1 : 0);
    const J = this.joys, M = this.mantenidos;
    const s = this.ajustes;
    const e = {
      movX: clamp(J.mov.x + k('KeyD') - k('KeyA'), -1, 1),
      movY: clamp(J.mov.y + k('KeyW') - k('KeyS'), -1, 1),
      vistaX: this.vista.dx * s.sensTactil + this.raton.dx * s.sensRaton,
      vistaY: this.vista.dy * s.sensTactil + this.raton.dy * s.sensRaton,
      apuntar: !!M.apuntar || this.raton.der,
      disparar: !!M.disparar || this.raton.izq,
      ametralladora: !!M.ametralladora || T.has('Space'),
      correr: T.has('ShiftLeft') || T.has('ShiftRight') || J.mov.y > 0.92,
      flancos: this.flancos,
      // Orugas: palancas táctiles o Q/A (izq) E/D (der); W/S/A/D mezclan ambas
      orugaI: 0, orugaD: 0, acel: 0, dir: 0,
      dAcel: 0, dGuinada: 0, dCabeceo: 0, dAlabeo: 0,
    };
    if (this.modo === 'oruga') {
      const w = k('KeyW') - k('KeyS'), a = k('KeyD') - k('KeyA');
      e.orugaI = clamp(J.orugaI.y + w + a + k('KeyQ') - k('KeyZ'), -1, 1);
      e.orugaD = clamp(J.orugaD.y + w - a + k('KeyE') - k('KeyC'), -1, 1);
      e.flancos.delete('agachar');
    } else if (this.modo === 'ruedas') {
      e.acel = clamp(J.acel.y + k('KeyW') - k('KeyS'), -1, 1);
      e.dir = clamp(J.dir.x + k('KeyD') - k('KeyA'), -1, 1);
    } else if (this.modo === 'dron' || this.modo === 'heli' || this.modo === 'avion') {
      // Modo 2: izquierda gas (o subir/bajar) y guiñada, derecha cabeceo/alabeo
      this.acelDron = clamp(this.acelDron + (k('KeyW') - k('KeyS')) * dt * 0.9, 0, 1);
      if (this.tactil && !J.dronI.centrarY) this.acelDron = (J.dronI.y + 1) / 2;
      e.dAcel = this.acelDron;
      e.dSubir = clamp(J.dronI.y + k('KeyW') - k('KeyS'), -1, 1);
      e.cohetes = !!M.cohetes || T.has('KeyR') || (this.raton.der && this.modo !== 'dron');
      e.dGuinada = clamp(J.dronI.x + k('KeyD') - k('KeyA'), -1, 1);
      e.dCabeceo = clamp(J.dronD.y + k('ArrowUp') + k('KeyI') - k('ArrowDown') - k('KeyK'), -1, 1);
      e.dAlabeo = clamp(J.dronD.x + k('ArrowRight') + k('KeyL') - k('ArrowLeft') - k('KeyJ'), -1, 1);
    }
    this.leerMando(e, dt);
    this.vista.dx = this.vista.dy = 0;
    this.raton.dx = this.raton.dy = 0;
    return e;
  }

  leerMando(e, dt) {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    const ax = gp.axes.map(dz);
    const b = (i) => gp.buttons[i]?.pressed;
    const prev = this._gpPrev || [];
    const flanco = (i, nombre) => { if (b(i) && !prev[i]) e.flancos.add(nombre); };
    if (this.modo === 'infanteria') {
      e.movX = clamp(e.movX + ax[0], -1, 1); e.movY = clamp(e.movY - ax[1], -1, 1);
      e.vistaX += ax[2] * 900 * dt * this.ajustes.sensRaton; e.vistaY += ax[3] * 600 * dt * this.ajustes.sensRaton;
      if (b(10)) e.correr = true;
    } else if (this.modo === 'oruga') {
      e.orugaI = clamp(e.orugaI - ax[1], -1, 1); e.orugaD = clamp(e.orugaD - ax[3], -1, 1);
    } else if (this.modo === 'ruedas') {
      e.acel = clamp(e.acel - ax[1], -1, 1); e.dir = clamp(e.dir + ax[2], -1, 1);
    } else if (this.modo === 'dron' || this.modo === 'heli' || this.modo === 'avion') {
      e.dAcel = clamp((-ax[1] + 1) / 2, 0, 1);
      e.dSubir = -ax[1];
      e.dGuinada = ax[0]; e.dCabeceo = -ax[3]; e.dAlabeo = ax[2];
    }
    if (this.modo !== 'dron' && this.modo !== 'infanteria' && this.modo !== 'oruga') {
      e.vistaX += ax[2] * 600 * dt * this.ajustes.sensRaton; e.vistaY += ax[3] * 400 * dt * this.ajustes.sensRaton;
    }
    if (b(6)) e.apuntar = true;
    if (b(7)) e.disparar = true;
    flanco(2, 'recargar'); flanco(0, 'saltar'); flanco(1, 'agachar'); flanco(3, 'interactuar');
    flanco(4, 'camara'); flanco(5, 'cambiarArma'); flanco(12, 'dron'); flanco(13, 'detonar'); flanco(8, 'salirDron');
    this._gpPrev = gp.buttons.map((x) => x.pressed);
  }

  consumir(nombre) {
    if (this.flancos.has(nombre)) { this.flancos.delete(nombre); return true; }
    return false;
  }

  limpiarFlancos() { this.flancos.clear(); }
}
