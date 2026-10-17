// HUD mínimo de estilo documental: sello de cámara corporal, brújula, minimapa, avisos,
// retícula de visor de vehículo y OSD de dron FPV.
import * as THREE from 'three';
import { FACCIONES } from './soldado.js';
import { carreteraZ } from './mundo.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(juego) {
    this.j = juego;
    this.el = {};
    for (const id of ['hud', 'bcTiempo', 'bcId', 'brujula', 'minimapa', 'marcador', 'feed', 'mensaje', 'punto', 'marcaImpacto', 'indDano',
      'infoArma', 'armaNombre', 'armaMun', 'vida', 'vidaBarra', 'aviso', 'hudVeh', 'vehNombre', 'vehVel', 'vehVida', 'vehMun', 'vehRecarga',
      'vehIndic', 'vehTorreta', 'reticulaVisor', 'mira3', 'miraDeseo', 'osdDron', 'pantallaMuerte', 'muerteTexto', 'muerteCuenta', 'tabla', 'red', 'ayudaTeclas', 'mapaGrande', 'lienzoMapa', 'visorFusil']) this.el[id] = $(id);
    this.el.minimapa.addEventListener('click', () => this.alternarMapa());
    this.el.mapaGrande.addEventListener('click', () => this.alternarMapa(false));
    this.ctxB = this.el.brujula.getContext('2d');
    this.ctxM = this.el.minimapa.getContext('2d');
    this.mensajes = [];
    this.tMsg = 0;
    this.tImpacto = 0;
    this.danos = [];
    this.vistos = new Map(); // id -> tiempo hasta el que es visible en el minimapa
    this.fondoMapa = this.crearFondoMapa();
    this.modo = '';
  }

  crearFondoMapa() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const W = this.j.mundo, ZONA = W.ZONA;
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const wx = -ZONA + (x / 256) * ZONA * 2, wz = -ZONA + (y / 256) * ZONA * 2;
      const h = W.getHeight(wx, wz);
      const v = W.mapa === 'frente' ? 60 + (h + 10) * 2.2 : 150 + h * 3;
      const i = (y * 256 + x) * 4;
      img.data[i] = v * 0.75; img.data[i + 1] = v * 0.8; img.data[i + 2] = v * 0.62; img.data[i + 3] = 235;
    }
    g.putImageData(img, 0, 0);
    const k = 256 / (ZONA * 2), m = (x) => (x + ZONA) * k;
    g.strokeStyle = 'rgba(40,30,20,0.9)'; g.lineWidth = 1.5;
    for (const [ax, az, bx, bz] of W.segTrinchera) { g.beginPath(); g.moveTo(m(ax), m(az)); g.lineTo(m(bx), m(bz)); g.stroke(); }
    g.fillStyle = 'rgba(30,30,30,0.6)';
    for (const c2 of W.colisores) {
      if (c2.max.y - c2.min.y < 2) continue;
      g.fillRect(m(c2.min.x), m(c2.min.z), Math.max(1, (c2.max.x - c2.min.x) * k), Math.max(1, (c2.max.z - c2.min.z) * k));
    }
    return c;
  }

  setModo(m) {
    this.modo = m;
    const vis = (id, v) => { this.el[id].style.display = v ? '' : 'none'; };
    vis('infoArma', m === 'infanteria');
    vis('vida', m === 'infanteria' || m === 'vehiculo');
    vis('hudVeh', m === 'vehiculo');
    vis('osdDron', m === 'dron');
    vis('brujula', m !== 'dron');
    vis('minimapa', m !== 'dron');
    vis('punto', m === 'infanteria');
    vis('reticulaVisor', false);
    vis('mira3', false);
    vis('miraDeseo', false);
    vis('pantallaMuerte', m === 'muerto');
    if (m !== 'infanteria') this.visor(null);
    document.body.classList.toggle('desplegando', m === 'despliegue');
    document.body.classList.toggle('modo-dron', m === 'dron');
  }

  mensaje(txt, dur = 3) { this.el.mensaje.textContent = txt; this.el.mensaje.style.opacity = 1; this.tMsg = dur; }

  baja(asesino, arma, victima, colA, colV) {
    const d = document.createElement('div');
    d.className = 'baja';
    d.innerHTML = `<span style="color:${colA}">${asesino}</span> <i>${arma}</i> <span style="color:${colV}">${victima}</span>`;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => d.remove(), 7000);
  }

  impacto(muerte = false) {
    this.tImpacto = 0.18;
    this.el.marcaImpacto.classList.toggle('mortal', muerte);
  }

  // Indicador de daño direccional (ángulo relativo a la vista)
  dano(angulo) {
    const d = document.createElement('div');
    d.className = 'arcoDano';
    d.style.transform = `translate(-50%,-50%) rotate(${angulo}rad)`;
    this.el.indDano.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  avistar(id) { this.vistos.set(id, performance.now() + 3500); }

  actualizar(dt) {
    const J = this.j, E = this.el;
    // Sello de tiempo de la cámara corporal
    const ahora = new Date();
    E.bcTiempo.textContent = ahora.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
    if (this.tMsg > 0) { this.tMsg -= dt; if (this.tMsg <= 0) E.mensaje.style.opacity = 0; }
    if (this.tImpacto > 0) { this.tImpacto -= dt; E.marcaImpacto.style.opacity = 1; } else E.marcaImpacto.style.opacity = 0;
    const L = J.local;
    E.marcador.innerHTML = `<span class="ua">UA ${J.puntos.UA}</span> <span class="sep">·</span> <span class="ru">${J.puntos.RU} RU</span>`;
    E.red.textContent = J.red?.conectado ? `EN LÍNEA · ${J.soldados.size} jug. · ${J.red.ping} ms` : 'LOCAL · BOTS';
    if (!L) return;
    E.vidaBarra.style.width = Math.max(0, L.vida) + '%';
    E.vidaBarra.style.background = L.vida > 50 ? '#d8d8c8' : L.vida > 25 ? '#e0a040' : '#e04030';
    if (this.modo !== 'dron') this.dibujarBrujula(J.rumbo());
    if (this.modo !== 'dron') this.dibujarMinimapa();
    if (this.modo === 'infanteria' && J.arma) {
      const a = J.arma;
      E.armaNombre.textContent = a.def.nombre;
      E.armaMun.textContent = (a.recargando > 0 ? 'RECARGANDO…' : `${a.est.cargador} / ${a.est.reserva}`) + `  ·  G ${J.granadas}`;
      E.punto.style.opacity = J.ajustes.punto ? (1 - a.apuntado) * 0.8 : 0;
    }
  }

  // Retícula de óptica de aumento (PSO-1 o mil-dot)
  visor(tipo) {
    const v = this.el.visorFusil;
    if (!tipo) { if (v.style.display !== 'none') v.style.display = 'none'; return; }
    v.style.display = '';
    v.dataset.tipo = tipo;
  }

  // Mapa completo de la zona de operaciones
  alternarMapa(forzar) {
    const m = this.el.mapaGrande;
    const abrir = forzar ?? m.style.display === 'none';
    m.style.display = abrir ? '' : 'none';
    clearInterval(this.intMapa);
    if (abrir) { document.getElementById('mapaPie').textContent = `Mapa de operaciones · cuadrícula de ${this.j.mundo.cuadricula || 200} m · toca para cerrar`; this.dibujarMapaGrande(); this.intMapa = setInterval(() => this.dibujarMapaGrande(), 500); }
  }

  fondoCompleto() {
    if (this.fondoGrande) return this.fondoGrande;
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), W = this.j.mundo;
    const MAPA = W.mapaVista || W.MAPA, ZONA = W.ZONA, CUAD = W.cuadricula || 200;
    const img = g.createImageData(N, N);
    const k = (MAPA * 2) / N;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const wx = -MAPA + x * k, wz = -MAPA + y * k;
      const h = W.getHeight(wx, wz), hx = W.getHeight(wx + k, wz), hz = W.getHeight(wx, wz + k);
      const sombra = Math.max(0.55, Math.min(1.25, 1 + (h - hx) * 0.12 + (h - hz) * 0.12));
      const base = W.mapa === 'frente' ? 70 + (h + 15) * 1.6 : 175 + h * 2;
      const i = (y * N + x) * 4;
      img.data[i] = base * 0.86 * sombra; img.data[i + 1] = base * 0.88 * sombra; img.data[i + 2] = base * 0.66 * sombra; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const m = (v) => (v + MAPA) / k;
    // Carretera principal
    if (W.mapa === 'frente') {
      g.strokeStyle = 'rgba(205,190,160,0.7)'; g.lineWidth = 2;
      g.beginPath(); for (let x = -MAPA; x <= MAPA; x += 20) { x === -MAPA ? g.moveTo(m(x), m(carreteraZ(x))) : g.lineTo(m(x), m(carreteraZ(x))); } g.stroke();
    } else {
      // Calle y rotonda
      g.fillStyle = 'rgba(55,55,52,0.9)';
      g.fillRect(m(-50), m(-4.5), 100 / k, 9 / k);
      g.beginPath(); g.arc(m(0), m(0), 12 / k, 0, Math.PI * 2); g.fill();
    }
    // Árboles
    g.fillStyle = 'rgba(40,52,28,0.75)';
    for (const a of W.arboles) g.fillRect(m(a.x) - 0.7, m(a.z) - 0.7, 1.4, 1.4);
    // Edificios
    g.fillStyle = 'rgba(30,28,26,0.85)';
    for (const col of W.colisores) if (col.max.y - col.min.y > 2) g.fillRect(m(col.min.x), m(col.min.z), Math.max(1, (col.max.x - col.min.x) / k), Math.max(1, (col.max.z - col.min.z) / k));
    // Trincheras
    g.strokeStyle = 'rgba(60,40,25,1)'; g.lineWidth = 1.2;
    for (const [ax, az, bx, bz] of W.segTrinchera) { g.beginPath(); g.moveTo(m(ax), m(az)); g.lineTo(m(bx), m(bz)); g.stroke(); }
    // Cuadrícula de 200 m
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '9px monospace';
    for (let v = -MAPA; v <= MAPA; v += CUAD) {
      g.beginPath(); g.moveTo(m(v), 0); g.lineTo(m(v), N); g.stroke();
      g.beginPath(); g.moveTo(0, m(v)); g.lineTo(N, m(v)); g.stroke();
    }
    for (let i = 0; i < Math.round((MAPA * 2) / CUAD); i++) { g.fillText(String.fromCharCode(65 + i), m(-MAPA + i * CUAD) + 3, 10); g.fillText(String(i + 1), 2, m(-MAPA + i * CUAD) + 12); }
    // Zona de combate
    g.strokeStyle = 'rgba(242,201,76,0.5)'; g.setLineDash([4, 4]);
    const Lm = W.limites || { x0: -ZONA, x1: ZONA, z0: -ZONA, z1: ZONA };
    g.strokeRect(m(Lm.x0), m(Lm.z0), (Lm.x1 - Lm.x0) / k, (Lm.z1 - Lm.z0) / k); g.setLineDash([]);
    this.fondoGrande = c;
    return c;
  }

  dibujarMapaGrande() {
    const J = this.j, cv = this.el.lienzoMapa, g = cv.getContext('2d');
    const MAPA = J.mundo.mapaVista || J.mundo.MAPA;
    const S = cv.width, k = S / (MAPA * 2), m = (v) => (v + MAPA) * k;
    g.drawImage(this.fondoCompleto(), 0, 0, S, S);
    const L = J.local, ahora = performance.now();
    g.font = '600 12px ui-monospace, monospace'; g.textAlign = 'center';
    for (const f of ['UA', 'RU']) {
      const B = J.mundo.bases[f];
      g.fillStyle = FACCIONES[f].color; g.globalAlpha = 0.85;
      g.fillRect(m(B.x) - 6, m(B.z || 0) - 6, 12, 12);
      g.globalAlpha = 1; g.fillText((J.mundo.mapa === 'frente' ? 'BASE ' : 'INICIO ') + f, m(B.x), m(B.z || 0) - 10);
    }
    g.fillStyle = '#e8e6da'; if (J.mundo.mapa === 'frente') g.fillText('ALDEA', m(10), m(-20));
    for (const v of J.vehiculos) {
      if (v.destruido) continue;
      const amigo = v.conductor ? J.soldados.get(v.conductor)?.faccion === L.faccion : v.faccion === L.faccion;
      if (!amigo && !(v.conductor && (this.vistos.get(v.conductor) || 0) > ahora)) continue;
      g.save(); g.translate(m(v.pos.x), m(v.pos.z)); g.rotate(-v.yaw);
      g.fillStyle = amigo ? '#e8e6da' : '#ff6a50';
      if (v.aereo) { g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.fill(); }
      else g.fillRect(-3.5, -6, 7, 12);
      g.restore();
    }
    for (const s of J.soldados.values()) {
      if (!s.vivo || s.enVehiculo || s === L) continue;
      const aliado = s.faccion === L.faccion;
      if (!aliado && !((this.vistos.get(s.id) || 0) > ahora)) continue;
      g.fillStyle = aliado ? FACCIONES[s.faccion].color : '#ff4030';
      g.beginPath(); g.arc(m(s.pos.x), m(s.pos.z), 4, 0, Math.PI * 2); g.fill();
      if (aliado) { g.fillStyle = '#e8e6da'; g.fillText(s.nombre, m(s.pos.x), m(s.pos.z) - 7); }
    }
    for (const d of J.drones.values()) {
      if (!d.vivo || (d.faccion !== L.faccion && !((this.vistos.get(d.id) || 0) > ahora))) continue;
      g.strokeStyle = d.faccion === L.faccion ? '#9fd' : '#f64'; g.lineWidth = 2;
      const x = m(d.pos.x), y = m(d.pos.z);
      g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke();
    }
    if (L.vivo) {
      const p = J.posFoco();
      g.save(); g.translate(m(p.x), m(p.z)); g.rotate((J.rumbo() * Math.PI) / 180);
      g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }

  dibujarBrujula(rumbo) {
    const g = this.ctxB, W = g.canvas.width, H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    g.font = '600 13px ui-monospace, monospace'; g.textAlign = 'center';
    const pxGrado = 3;
    const nombres = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
    for (let a = -90; a <= 90; a += 5) {
      const b = Math.round(rumbo / 5) * 5 + a;
      const x = W / 2 + (b - rumbo) * pxGrado;
      const n = ((b % 360) + 360) % 360;
      const al = 1 - Math.abs(x - W / 2) / (W / 2);
      g.globalAlpha = Math.max(0, al);
      g.fillStyle = '#e8e6da';
      if (nombres[n] !== undefined) { g.fillText(nombres[n], x, 16); g.fillRect(x - 0.5, 22, 1, 10); }
      else if (n % 15 === 0) { g.font = '11px ui-monospace, monospace'; g.fillText(String(n), x, 16); g.font = '600 13px ui-monospace, monospace'; g.fillRect(x - 0.5, 24, 1, 6); }
      else g.fillRect(x - 0.5, 27, 1, 3);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#f2c94c';
    g.beginPath(); g.moveTo(W / 2, 34); g.lineTo(W / 2 - 5, 40); g.lineTo(W / 2 + 5, 40); g.fill();
  }

  dibujarMinimapa() {
    const J = this.j, g = this.ctxM, S = g.canvas.width;
    const L = J.local;
    const centro = J.posFoco();
    const ZONA = J.mundo.ZONA;
    const escala = S / (J.mundo.vistaMinimapa || 220); // metros visibles
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#20231b'; g.fillRect(0, 0, S, S);
    const k = 256 / (ZONA * 2);
    g.globalAlpha = 0.85;
    g.drawImage(this.fondoMapa, S / 2 - (centro.x + ZONA) * escala, S / 2 - (centro.z + ZONA) * escala, ZONA * 2 * escala, ZONA * 2 * escala);
    g.globalAlpha = 1;
    const aMapa = (p) => [S / 2 + (p.x - centro.x) * escala, S / 2 + (p.z - centro.z) * escala];
    const ahora = performance.now();
    for (const v of J.vehiculos) {
      if (v.destruido) continue;
      const [x, y] = aMapa(v.pos);
      g.save(); g.translate(x, y); g.rotate(-v.yaw);
      g.fillStyle = v.faccion === L.faccion ? 'rgba(220,220,200,0.9)' : 'rgba(200,120,100,0.8)';
      g.fillRect(-3, -5, 6, 10);
      g.restore();
    }
    for (const s of J.soldados.values()) {
      if (s === L || !s.vivo || s.enVehiculo) continue;
      const aliado = s.faccion === L.faccion;
      if (!aliado && !((this.vistos.get(s.id) || 0) > ahora)) continue;
      const [x, y] = aMapa(s.pos);
      g.fillStyle = aliado ? FACCIONES[s.faccion].color : '#ff4030';
      g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
    }
    for (const d of J.drones.values()) {
      if (!d.vivo) continue;
      if (d.faccion !== L.faccion && !((this.vistos.get(d.id) || 0) > ahora)) continue;
      const [x, y] = aMapa(d.pos);
      g.strokeStyle = d.faccion === L.faccion ? '#9fd' : '#f64'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke();
    }
    // Jugador
    g.translate(S / 2, S / 2); g.rotate(-J.rumbo() * Math.PI / 180 * -1);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(230,230,210,0.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#e8e6da'; g.font = '600 11px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText('N', S / 2, 12);
    void k;
  }

  // HUD de vehículo
  vehiculo(v, info) {
    const E = this.el;
    E.vehNombre.textContent = v.nombre + (info.primera ? ' · VISOR' : ' · EXTERIOR');
    E.vehVel.textContent = Math.round(Math.abs(v.velActual || 0) * 3.6) + ' km/h';
    E.vehVida.textContent = 'BLINDAJE ' + Math.round((v.vida / v.def.vida) * 100) + '%';
    E.vehMun.textContent = info.municion;
    E.vehRecarga.style.width = Math.round(info.carga * 100) + '%';
    E.vehRecarga.parentElement.style.display = info.carga < 1 ? '' : 'none';
    // Indicador casco/torreta: la torreta apunta arriba, el casco gira -torYaw
    E.vehIndic.setAttribute('transform', `rotate(${(v.torYaw * 180) / Math.PI} 40 40)`);
    E.reticulaVisor.style.display = info.primera ? '' : 'none';
    E.reticulaVisor.classList.toggle('termica', !!info.termico);
    E.mira3.style.display = info.mira ? '' : 'none';
    if (info.mira) { E.mira3.style.left = info.mira[0] + 'px'; E.mira3.style.top = info.mira[1] + 'px'; }
    E.miraDeseo.style.display = info.deseo ? '' : 'none';
    if (info.deseo) { E.miraDeseo.style.left = info.deseo[0] + 'px'; E.miraDeseo.style.top = info.deseo[1] + 'px'; }
  }

  dron(d, operador) {
    const o = this.el.osdDron;
    const alt = d.pos.y - this.j.mundo.getHeight(d.pos.x, d.pos.z);
    const volt = (19.8 + d.bateria * 5.4).toFixed(1);
    const dist = operador ? Math.round(d.pos.distanceTo(operador)) : 0;
    const eu = new THREE.Euler().setFromQuaternion(d.q, 'YXZ');
    const rumbo = Math.round((((-eu.y * 180) / Math.PI) % 360 + 360) % 360);
    const t = Math.floor(d.tVuelo);
    const lq = Math.round(d.senal * 100);
    o.querySelector('.d-volt').textContent = volt + 'V';
    o.querySelector('.d-volt').classList.toggle('alerta', d.bateria < 0.2);
    o.querySelector('.d-alt').textContent = 'ALT ' + alt.toFixed(0) + 'm';
    o.querySelector('.d-vel').textContent = Math.round(d.velocidadKmh()) + ' km/h';
    o.querySelector('.d-dist').textContent = '⌂ ' + dist + 'm';
    o.querySelector('.d-tiempo').textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    o.querySelector('.d-modo').textContent = d.modo + (d.armado ? ' · ARMADO' : ' · SEGURO');
    o.querySelector('.d-lq').textContent = 'LQ ' + lq + '%';
    o.querySelector('.d-lq').classList.toggle('alerta', lq < 40);
    o.querySelector('.d-rumbo').textContent = String(rumbo).padStart(3, '0') + '°';
    o.querySelector('.d-gas').style.height = Math.round(d.acel * 100) + '%';
    // Horizonte artificial
    o.querySelector('.d-horizonte').style.transform = `translate(-50%,-50%) rotate(${(-eu.z * 180) / Math.PI}deg) translateY(${eu.x * 120}px)`;
  }

  muerte(texto, cuenta) {
    this.el.muerteTexto.innerHTML = texto;
    this.el.muerteCuenta.textContent = cuenta > 0 ? `Reaparición en ${Math.ceil(cuenta)} s` : 'Pulsa FUEGO o toca para reaparecer';
  }

  tabla(visible) {
    const t = this.el.tabla;
    t.style.display = visible ? '' : 'none';
    if (!visible) return;
    const filas = [...this.j.soldados.values()].sort((a, b) => b.kills - a.kills)
      .map((s) => `<tr class="${s.faccion.toLowerCase()}"><td>${s.faccion}</td><td>${s.nombre}${s === this.j.local ? ' (tú)' : ''}${s.esBot ? ' [IA]' : ''}</td><td>${s.kills}</td><td>${s.muertes}</td></tr>`).join('');
    t.innerHTML = `<table><tr><th>Bando</th><th>Jugador</th><th>Bajas</th><th>Muertes</th></tr>${filas}</table>`;
  }
}
