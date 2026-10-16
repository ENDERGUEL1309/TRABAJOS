// Audio procedural con WebAudio: disparos con retardo por distancia (velocidad del sonido),
// explosiones, motores, zumbido de drones, chasquidos supersónicos y ambiente de frente.
import * as THREE from 'three';

const VSON = 343;

export class Audio {
  constructor() {
    this.ctx = null;
    this.oyente = new THREE.Vector3();
    this.activo = false;
  }

  iniciar() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp).connect(c.destination);
    // Reverberación sencilla para disparos (convolución con ruido decreciente)
    this.reverb = c.createConvolver();
    const len = c.sampleRate * 2.2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbGain = c.createGain(); this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    // Ruido blanco reutilizable
    this.ruido = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.ruido.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Ruido marrón (graves)
    this.ruidoMarron = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const m = this.ruidoMarron.getChannelData(0);
    let last = 0;
    for (let i = 0; i < m.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; m[i] = last * 3.5; }
    this.activo = true;
    this.ambiente();
  }

  setOyente(pos, quat) {
    if (!this.activo) return;
    this.oyente.copy(pos);
    const L = this.ctx.listener, t = this.ctx.currentTime;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat), u = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 6; p.rolloffFactor = 0.9; p.maxDistance = 5000;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  fuente(buffer, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = loop;
    if (!loop) s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  // Disparo: ráfaga de ruido filtrado + golpe grave. 'calibre': 1 fusil, 2 ametralladora pesada, 4 cañón.
  disparo(pos, calibre = 1, propio = false) {
    if (!this.activo) return;
    const c = this.ctx;
    const d = propio ? 0 : this.oyente.distanceTo(pos);
    const t = c.currentTime + d / VSON;
    const salida = propio ? this.master : this.panner(pos);
    if (!propio) salida.connect(this.master);
    const lejos = Math.min(1, d / 600);
    // Ruido
    const n = this.fuente(this.ruido);
    const bp = c.createBiquadFilter(); bp.type = 'lowpass';
    bp.frequency.value = (propio ? 9000 : 6000 * (1 - lejos) + 500) / Math.sqrt(calibre);
    const g = c.createGain();
    const v = (propio ? 0.9 : 1.6) * Math.min(2, calibre);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 * calibre + lejos * 0.3);
    n.connect(bp).connect(g).connect(salida);
    g.connect(this.reverb);
    n.start(t, Math.random()); n.stop(t + 0.6 * calibre + 0.5);
    // Golpe grave
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140 / calibre + 40, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.15 * calibre);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(v * 0.9, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18 * calibre);
    o.connect(g2).connect(salida);
    o.start(t); o.stop(t + 0.3 * calibre + 0.1);
    if (propio && calibre === 1) this.clic(t + 0.03, 2500, 0.15);
  }

  clic(t, f = 2000, v = 0.2) {
    const c = this.ctx;
    const n = this.fuente(this.ruido);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.06);
  }

  paso(intensidad = 1) {
    if (!this.activo) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.fuente(this.ruido);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 350 + Math.random() * 300; f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.1 * intensidad, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.14);
  }

  recarga() {
    if (!this.activo) return;
    const t = this.ctx.currentTime;
    this.clic(t + 0.3, 1500, 0.35); this.clic(t + 0.9, 1200, 0.4); this.clic(t + 1.9, 2200, 0.4); this.clic(t + 2.2, 1800, 0.35);
  }

  // Chasquido supersónico de una bala que pasa cerca
  chasquido(pos) {
    if (!this.activo) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.fuente(this.ruido);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const p = this.panner(pos); p.connect(this.master);
    n.connect(hp).connect(g).connect(p);
    n.start(t, Math.random()); n.stop(t + 0.08);
  }

  impacto(pos, mat) {
    if (!this.activo) return;
    const c = this.ctx, d = this.oyente.distanceTo(pos);
    if (d > 120) return;
    const t = c.currentTime + d / VSON;
    const n = this.fuente(this.ruido);
    const f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = mat === 'metal' || mat === 'blindaje' ? 3200 : mat === 'tierra' ? 600 : 1400; f.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const p = this.panner(pos); p.connect(this.master);
    n.connect(f).connect(g).connect(p);
    n.start(t, Math.random()); n.stop(t + 0.1);
    if (mat === 'metal' || mat === 'blindaje') {
      const o = c.createOscillator(); o.frequency.value = 1800 + Math.random() * 1500;
      const g2 = c.createGain(); g2.gain.setValueAtTime(0.12, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g2).connect(p); o.start(t); o.stop(t + 0.3);
    }
  }

  explosion(pos, tam = 1) {
    if (!this.activo) return;
    const c = this.ctx, d = this.oyente.distanceTo(pos);
    const t = c.currentTime + d / VSON;
    const p = this.panner(pos); p.refDistance = 25 * tam; p.connect(this.master);
    const lejos = Math.min(1, d / 1500);
    const n = this.fuente(this.ruidoMarron);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000 * (1 - lejos) + 200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(3 * tam, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.5 + tam);
    n.connect(lp).connect(g).connect(p);
    g.connect(this.reverb);
    n.start(t); n.stop(t + 4);
    const n2 = this.fuente(this.ruido);
    const g3 = c.createGain();
    g3.gain.setValueAtTime(1.5 * tam * (1 - lejos), t); g3.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n2.connect(g3).connect(p);
    n2.start(t); n2.stop(t + 0.4);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    const g4 = c.createGain(); g4.gain.setValueAtTime(2 * tam, t); g4.gain.exponentialRampToValueAtTime(0.001, t + 1);
    o.connect(g4).connect(p); o.start(t); o.stop(t + 1.1);
  }

  // Motor continuo posicional: tipo 'diesel' (tanque), 'ligero', 'camion', 'dron'
  motor(tipo) {
    if (!this.activo) return null;
    const c = this.ctx;
    const p = this.panner(new THREE.Vector3());
    p.refDistance = tipo === 'dron' ? 4 : 10;
    const g = c.createGain(); g.gain.value = 0;
    g.connect(p).connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = tipo === 'dron' ? 4000 : 600;
    lp.connect(g);
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = tipo === 'dron' ? 'square' : 'sawtooth';
    const g1 = c.createGain(); g1.gain.value = 0.35;
    const g2 = c.createGain(); g2.gain.value = 0.2;
    o1.connect(g1).connect(lp); o2.connect(g2).connect(lp);
    const n = this.fuente(tipo === 'dron' ? this.ruido : this.ruidoMarron, true);
    const gn = c.createGain(); gn.gain.value = tipo === 'dron' ? 0.08 : 0.5;
    n.connect(gn).connect(lp);
    o1.start(); o2.start(); n.start();
    const base = { diesel: 32, ligero: 45, camion: 38, dron: 190 }[tipo];
    return {
      set: (pos, rpm, vol) => {
        const t = c.currentTime;
        if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, 0.05); p.positionY.setTargetAtTime(pos.y, t, 0.05); p.positionZ.setTargetAtTime(pos.z, t, 0.05); }
        else p.setPosition(pos.x, pos.y, pos.z);
        const f = base * (0.6 + rpm * (tipo === 'dron' ? 1.6 : 1.4));
        o1.frequency.setTargetAtTime(f, t, 0.08);
        o2.frequency.setTargetAtTime(f * (tipo === 'dron' ? 2.01 : 0.5), t, 0.08);
        lp.frequency.setTargetAtTime((tipo === 'dron' ? 2500 : 300) + rpm * (tipo === 'dron' ? 4000 : 900), t, 0.1);
        g.gain.setTargetAtTime(vol, t, 0.1);
      },
      parar: () => { try { o1.stop(); o2.stop(); n.stop(); g.disconnect(); } catch (e) { /* ya parado */ } },
    };
  }

  // Viento y combates lejanos aleatorios
  ambiente() {
    const c = this.ctx;
    const n = this.fuente(this.ruidoMarron, true);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = c.createGain(); g.gain.value = 0.12;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08;
    const lg = c.createGain(); lg.gain.value = 0.06;
    lfo.connect(lg).connect(g.gain);
    n.connect(lp).connect(g).connect(this.master);
    n.start(); lfo.start();
    const lejano = () => {
      if (!this.activo) return;
      const a = Math.random() * 6.28, d = 1500 + Math.random() * 3000;
      const p = this.oyente.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d));
      if (Math.random() < 0.6) this.explosion(p, 1.5 + Math.random() * 2);
      else {
        const rafaga = 3 + Math.floor(Math.random() * 8);
        for (let i = 0; i < rafaga; i++) setTimeout(() => this.disparo(p, 1.5), i * 110);
      }
      setTimeout(lejano, 4000 + Math.random() * 14000);
    };
    setTimeout(lejano, 3000);
  }

  pitido(dur = 1.2) {
    // Acúfeno tras explosión cercana
    if (!this.activo) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.value = 3800;
    const g = c.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur);
  }
}
