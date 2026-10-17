// Mapa "Villa Atómica": pueblo de pruebas nucleares de los años 50 en el desierto.
// Dos casas de dos plantas enfrentadas sobre una calle con rotonda, autobús escolar, coches,
// vallas, patios traseros y maniquíes. Arena pequeña para multijugador 2 contra 2.
import * as THREE from 'three';
import { cajaGeo, conColor, fusionar } from '../mundo.js';
import * as TX from '../texturas.js';
import { noise2, fbm, clamp } from '../util.js';

const CALLE = 4.5;          // media anchura de la calzada (m)
const ROTONDA = 12;         // radio de la rotonda central
const LIM = { x0: -52, x1: 52, z0: -37, z1: 37 };

function alturaVilla(x, z) {
  const ex = Math.max(0, Math.abs(x) - 58), ez = Math.max(0, Math.abs(z) - 44);
  const e = Math.hypot(ex, ez);
  let h = noise2(x * 0.25, z * 0.25) * 0.015;
  if (e > 0) h += (1 - Math.exp(-e / 70)) * 22 + fbm(x * 0.008, z * 0.008, 4) * 9 * Math.min(1, e / 60);
  return h;
}

const enRect = (x, z, x0, x1, z0, z1) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
const esCalle = (x, z) => (Math.abs(z) <= CALLE && Math.abs(x) <= 50) || Math.hypot(x, z) <= ROTONDA;
const esAcera = (x, z) => !esCalle(x, z) && ((Math.abs(z) <= CALLE + 1.6 && Math.abs(x) <= 50) || Math.hypot(x, z) <= ROTONDA + 1.6);
// Entradas de garaje: casa A (sur) garaje en x 4..9,5; casa B (norte) en x -9,5..-4
const esEntrada = (x, z) => enRect(x, z, 4.4, 9.1, -15.5, -6) || enRect(x, z, -9.1, -4.4, 6, 15.5) || enRect(x, z, -5, -3, -13, -6) || enRect(x, z, 3, 5, 6, 13);
const esJardin = (x, z) => Math.abs(x) <= 17 && Math.abs(z) >= CALLE + 1.6 && Math.abs(z) <= 34;

const COL = {
  asfalto: new THREE.Color('#3b3a38'), acera: new THREE.Color('#a29d92'), cesped: new THREE.Color('#6d8a3a'),
  cespedSeco: new THREE.Color('#9a9450'), arena: new THREE.Color('#b8a078'), arenaOsc: new THREE.Color('#9c8462'),
};

function colorVilla(x, z, c, n1, n2) {
  if (esCalle(x, z)) { c.copy(COL.asfalto).multiplyScalar(0.9 + n2 * 0.1); return; }
  if (esAcera(x, z) || esEntrada(x, z)) { c.copy(COL.acera).multiplyScalar(0.92 + n2 * 0.08); return; }
  if (esJardin(x, z)) { c.copy(COL.cesped).lerp(COL.cespedSeco, clamp(0.3 + n1 * 0.6, 0, 1)); return; }
  c.copy(COL.arena).lerp(COL.arenaOsc, clamp(0.5 + n1 * 0.7, 0, 1));
}

function hierbaVilla(x, z, r) {
  if (esCalle(x, z) || esAcera(x, z) || esEntrada(x, z)) return null;
  if (esJardin(x, z)) return r() < 0.75 ? { alto: 0.32, verde: 0.85 } : null;
  return r() < 0.03 ? { alto: 0.55, verde: 0.05 } : null;
}

export const VILLA = {
  id: 'villa',
  nombre: 'Villa Atómica',
  configurar(m) {
    m.ZONA = 90;
    m.MAPA = 700;
    m.alturaFn = alturaVilla;
    m.pasoInterior = m.calidad.pasoTerreno > 1.5 ? 0.75 : 0.5;
    m.ajusteCielo = { hor: '#d6cfbd', cen: '#5a8cc2', sol: [0.45, 0.62, -0.4], niebla: 0.0032, luz: 3.1, ambiente: 0.75 };
    m.colorSuelo = colorVilla;
    m.infoHierba = hierbaVilla;
    m.limites = LIM;
    m.camDespliegue = { x: 0, z: 0, r: 40, h: 22 };
    m.vistaMinimapa = 90;
    m.mapaVista = 60;
    m.cuadricula = 10;
    m.columnasHumo = [];
  },
  construir(m) { new Constructor(m).todo(); },
};

class Constructor {
  constructor(m) {
    this.m = m;
    this.g = { muro: [], tejado: [], suelo: [], hormigon: [], madera: [], metal: [], vidrio: [], maniqui: [] };
  }

  // Caja con colisor opcional, transformada por la matriz de la pieza
  pieza(lista, M, x, y, z, w, h, d, color, colMat = null, ts = 2) {
    const g = cajaGeo(w, h, d, ts).translate(x, y, z);
    if (M) g.applyMatrix4(M);
    conColor(g, color);
    this.g[lista].push(g);
    if (colMat) { g.computeBoundingBox(); this.m.addColisor(g.boundingBox.min, g.boundingBox.max, colMat); }
    return g;
  }

  todo() {
    const m = this.m;
    this.casa(-2, -19, 0, new THREE.Color('#8fbf9f'), new THREE.Color('#e9e6dc'));   // casa verde (sur), mira al norte
    this.casa(2, 19, 2, new THREE.Color('#e5c56a'), new THREE.Color('#efe9da'));     // casa amarilla (norte), mira al sur
    this.calle();
    this.autobus(-2.5, 1.2);
    this.coche(-30, -2.3, 0, '#7a2a24', 'pickup');
    this.coche(26, 2.4, 0, '#2f5a7a', 'sedan');
    this.coche(6.75, -11.5, 1, '#c9c2b0', 'sedan');
    this.coche(-6.75, 11.5, 1, '#5b6e3a', 'pickup');
    this.coche(-41, 2.6, 0, '#d8d4c8', 'camion');
    this.coche(41, -2.6, 0, '#a8402c', 'camion');
    this.vallas();
    this.patios();
    this.maniquies();
    this.limites();
    this.paisaje();
    m.instanciarArboles([[-13, -10, 0.8], [13, 9, 0.85], [-12, 28, 0.9], [12, -29, 0.95], [-30, 14, 0.7], [31, -13, 0.75]], () => false);
    // Materiales y mallas fusionadas
    const mats = {
      muro: new THREE.MeshStandardMaterial({ map: TX.texRevestimiento(), vertexColors: true, roughness: 0.85 }),
      tejado: new THREE.MeshStandardMaterial({ map: TX.texTejas(), vertexColors: true, roughness: 0.9 }),
      suelo: new THREE.MeshStandardMaterial({ map: TX.texParquet(), vertexColors: true, roughness: 0.7 }),
      hormigon: new THREE.MeshStandardMaterial({ map: TX.texHormigon(), vertexColors: true, roughness: 0.95 }),
      madera: new THREE.MeshStandardMaterial({ map: TX.texMadera(), vertexColors: true, roughness: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5, map: TX.texBlindaje('#bdbdb5', 'pintura_coche') }),
      vidrio: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.45 }),
      maniqui: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
    };
    for (const [k, lista] of Object.entries(this.g)) {
      if (!lista.length) continue;
      const mesh = new THREE.Mesh(fusionar(lista), mats[k]);
      mesh.castShadow = k !== 'vidrio';
      mesh.receiveShadow = true;
      m.scene.add(mesh);
    }
    this.bases();
  }

  // ---------------- Casa de dos plantas ----------------
  casa(cx, cz, rot, pintura, molduras) {
    const M = new THREE.Matrix4().makeRotationY((rot * Math.PI) / 2).setPosition(cx, 0, cz);
    const w = 12, d = 9, t = 0.25;
    const f0 = 0.3, f1 = 3.5, techo = 6.7;
    const gris = new THREE.Color('#9a968c'), blanco = new THREE.Color(1, 1, 1), interior = new THREE.Color('#e8e2d2');
    // Cimientos y porche
    this.pieza('hormigon', M, 0, f0 / 2, 0, w + 0.2, f0, d + 0.2, gris, 'hormigon');
    this.pieza('hormigon', M, -2, f0 / 2 - 0.1, d / 2 + 0.8, 3, f0 - 0.2, 1.6, gris, 'hormigon');
    // Suelos de madera
    this.pieza('suelo', M, 0, f0 + 0.01, 0, w - 2 * t, 0.02, d - 2 * t, blanco, null, 2);
    // Muros por planta: [centro, ancho, alféizar, dintel]
    const plantas = [
      { y0: f0, alto: f1 - f0 - 0.2, frente: [[-2, 1.1, 0, 2.2], [2.5, 2.0, 0.9, 2.2]], fondo: [[3, 1.0, 0, 2.2], [-2.5, 1.6, 0.9, 2.2]], izq: [[1, 1.4, 0.9, 2.2]], der: [[-1, 1.0, 0, 2.2]] },
      { y0: f1, alto: techo - f1 - 0.2, frente: [[-3, 1.6, 0.9, 2.2], [2.5, 2.4, 0.8, 2.3]], fondo: [[-2, 1.4, 0.9, 2.2], [3, 1.4, 0.9, 2.2]], izq: [[-1, 1.4, 0.9, 2.2]], der: [[1.5, 1.3, 0.85, 2.3]] },
    ];
    for (const P of plantas) {
      const muros = [
        { L: w, pos: (s) => [s, d / 2 - t / 2], eje: 'x', huecos: P.frente, n: [0, 1] },
        { L: w, pos: (s) => [s, -d / 2 + t / 2], eje: 'x', huecos: P.fondo, n: [0, -1] },
        { L: d - 2 * t, pos: (s) => [-w / 2 + t / 2, s], eje: 'z', huecos: P.izq, n: [-1, 0] },
        { L: d - 2 * t, pos: (s) => [w / 2 - t / 2, s], eje: 'z', huecos: P.der, n: [1, 0] },
      ];
      for (const muro of muros) this.muro(M, muro, P.y0, P.alto, t, pintura, molduras);
    }
    // Forjado intermedio con hueco de escalera (x -5.75..-4.45, z -1.5..3.5)
    const yS = f1 - 0.1;
    this.pieza('hormigon', M, (-4.45 + w / 2 - t) / 2, yS, 0, w / 2 - t + 4.45, 0.2, d - 2 * t, interior, 'hormigon');
    this.pieza('hormigon', M, -5.1, yS, (-d / 2 + t - 1.5) / 2, 1.3, 0.2, -1.5 + d / 2 - t, interior, 'hormigon');
    this.pieza('hormigon', M, -5.1, yS, (3.5 + d / 2 - t) / 2, 1.3, 0.2, d / 2 - t - 3.5, interior, 'hormigon');
    this.pieza('suelo', M, 0, f1 + 0.01, -0.5, w - 2 * t, 0.02, 1, blanco); // remate visual
    // Barandilla del hueco
    this.pieza('madera', M, -4.4, f1 + 0.5, 1.0, 0.08, 1.0, 5.0, blanco, 'madera');
    // Escalera: 10 peldaños de 0,32 m
    for (let k = 0; k < 10; k++) {
      const top = f0 + 0.32 * (k + 1);
      const z1 = 3.5 - 0.5 * k, z0 = z1 - 0.5;
      this.pieza('madera', M, -5.1, top / 2, (z0 + z1) / 2, 1.25, top, 0.5, new THREE.Color('#b08a62'), 'madera');
    }
    // Tabique de planta baja con puerta
    this.pieza('muro', M, (-1 + 1.5) / 2, f0 + 1.45, -0.5, 2.5, 2.9, 0.15, interior, 'ladrillo');
    this.pieza('muro', M, (2.6 + 5.75) / 2, f0 + 1.45, -0.5, 3.15, 2.9, 0.15, interior, 'ladrillo');
    this.pieza('muro', M, 2.05, f0 + 2.55, -0.5, 1.1, 0.7, 0.15, interior, 'ladrillo');
    // Techo de la planta alta
    this.pieza('hormigon', M, 0, techo - 0.1, 0, w, 0.2, d, interior, 'hormigon');
    // Tejado a dos aguas
    const rid = 2.0, vol = 0.5, semi = d / 2 + vol, ang = Math.atan2(rid, d / 2);
    const largo = Math.hypot(semi, rid * (semi / (d / 2)));
    for (const lado of [-1, 1]) {
      const g = cajaGeo(w + vol * 2, 0.08, largo, 1.5).rotateX(lado * ang).translate(0, techo + rid / 2 - 0.05, lado * (d / 4 + vol / 4));
      g.applyMatrix4(M); conColor(g, new THREE.Color('#d8d2c8')); this.g.tejado.push(g);
    }
    for (const lado of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(0, rid); sh.lineTo(-d / 2, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }).rotateY(Math.PI / 2).translate(lado * (w / 2) - (lado > 0 ? t : 0), techo, 0);
      g.applyMatrix4(M); conColor(g, pintura); this.g.muro.push(g);
    }
    // Chimenea
    this.pieza('hormigon', M, -3.5, techo + 1.6, -1.5, 0.8, 3.2, 0.8, new THREE.Color('#8a5a48'));
    // Garaje (techo transitable a la altura de la planta alta)
    const gx0 = w / 2, gx1 = w / 2 + 5.5, gz0 = -3.5, gz1 = 3.5, gAlto = f1 - 0.2;
    this.pieza('hormigon', M, (gx0 + gx1) / 2, 0.03, 0, gx1 - gx0, 0.06, gz1 - gz0, gris);
    this.pieza('muro', M, (gx0 + gx1) / 2, gAlto / 2, gz0 + t / 2, gx1 - gx0, gAlto, t, pintura, 'ladrillo');
    this.muro(M, { L: gz1 - gz0 - 2 * t, pos: (s) => [gx1 - t / 2, s], eje: 'z', huecos: [[0, 1.4, 1.0, 2.2]], n: [1, 0] }, 0, gAlto, t, pintura, molduras);
    this.pieza('muro', M, gx0 + 0.3, gAlto / 2, gz1 - t / 2, 0.6, gAlto, t, pintura, 'ladrillo');
    this.pieza('muro', M, gx1 - 0.3, gAlto / 2, gz1 - t / 2, 0.6, gAlto, t, pintura, 'ladrillo');
    this.pieza('muro', M, (gx0 + gx1) / 2, 2.55 + (gAlto - 2.55) / 2, gz1 - t / 2, gx1 - gx0, gAlto - 2.55, t, pintura, 'ladrillo');
    this.pieza('hormigon', M, (gx0 + gx1) / 2, f1 - 0.1, 0, gx1 - gx0, 0.2, gz1 - gz0, interior, 'hormigon');
    // Puerta de garaje medio abierta (enrollada arriba)
    this.pieza('metal', M, (gx0 + gx1) / 2, 2.35, gz1 - 0.35, gx1 - gx0 - 1.2, 0.4, 0.08, molduras);
    // Muebles
    this.pieza('madera', M, 3.5, f0 + 0.4, 2.5, 2.2, 0.8, 0.9, new THREE.Color('#7a5a46'), 'madera');      // sofá
    this.pieza('madera', M, 3.0, f0 + 0.38, -2.6, 1.6, 0.76, 1.0, new THREE.Color('#9a7552'), 'madera');   // mesa
    this.pieza('metal', M, 5.3, f0 + 0.9, -3.8, 0.8, 1.8, 0.7, new THREE.Color('#e8e4d8'), 'metal');        // nevera
    this.pieza('madera', M, -2.2, f1 + 0.3, -2.8, 2.0, 0.6, 1.6, new THREE.Color('#d8cfc0'), 'madera');    // cama
    this.pieza('madera', M, 4.0, f1 + 0.45, -3.6, 1.4, 0.9, 0.6, new THREE.Color('#8a6a50'), 'madera');    // cómoda
    this.pieza('madera', M, 3.2, f1 + 0.4, 2.8, 1.0, 0.8, 1.0, new THREE.Color('#6a4a36'), 'madera');      // cajas junto a la ventana
  }

  // Muro con huecos (puertas/ventanas), molduras blancas y cristales en las ventanas
  muro(M, muro, y0, alto, t, pintura, molduras) {
    const huecos = muro.huecos.map((h) => ({ a: h[0] - h[1] / 2, b: h[0] + h[1] / 2, sill: h[2], top: h[3] })).sort((p, q) => p.a - q.a);
    const tramo = (s0, s1, yb, yt) => {
      if (s1 - s0 < 0.03 || yt - yb < 0.03) return;
      const [px, pz] = muro.pos((s0 + s1) / 2);
      const [sw, sd] = muro.eje === 'x' ? [s1 - s0, t] : [t, s1 - s0];
      this.pieza('muro', M, px, y0 + (yb + yt) / 2, pz, sw, yt - yb, sd, pintura, 'ladrillo');
    };
    let cursor = -muro.L / 2;
    for (const h of huecos) {
      tramo(cursor, h.a, 0, alto);
      if (h.sill > 0) tramo(h.a, h.b, 0, h.sill);
      if (h.top < alto) tramo(h.a, h.b, h.top, alto);
      cursor = h.b;
      // Molduras exteriores
      const fuera = t / 2 + 0.03;
      const marco = (s, yy, ancho, altoM) => {
        const [px, pz] = muro.pos(s);
        const ox = muro.n[0] * fuera, oz = muro.n[1] * fuera;
        const [sw, sd] = muro.eje === 'x' ? [ancho, 0.06] : [0.06, ancho];
        this.pieza('madera', M, px + ox, y0 + yy, pz + oz, sw, altoM, sd, molduras);
      };
      marco((h.a + h.b) / 2, h.top + 0.05, h.b - h.a + 0.2, 0.1);
      marco(h.a - 0.05, (h.sill + h.top) / 2, 0.1, h.top - h.sill);
      marco(h.b + 0.05, (h.sill + h.top) / 2, 0.1, h.top - h.sill);
      if (h.sill > 0) {
        marco((h.a + h.b) / 2, h.sill - 0.04, h.b - h.a + 0.25, 0.08);
        // Cristal roto en algunas ventanas (solo visual, no detiene balas)
        if (Math.random() < 0.6) {
          const [px, pz] = muro.pos((h.a + h.b) / 2);
          const [sw, sd] = muro.eje === 'x' ? [h.b - h.a, 0.02] : [0.02, h.b - h.a];
          this.pieza('vidrio', M, px, y0 + (h.sill + h.top) / 2, pz, sw, h.top - h.sill, sd, new THREE.Color('#9fb6c0'));
        }
      }
    }
    tramo(cursor, muro.L / 2, 0, alto);
  }

  // ---------------- Calle ----------------
  calle() {
    const amarillo = new THREE.Color('#d8b23a'), blanco = new THREE.Color('#e8e6e0');
    for (let x = -48; x <= 48; x += 4) {
      if (Math.abs(x) < ROTONDA + 1) continue;
      this.pieza('hormigon', null, x, 0.025, 0, 2, 0.01, 0.14, amarillo);
    }
    // Bordillos
    for (const s of [-1, 1]) for (const lado of [-1, 1]) {
      const x0 = ROTONDA + 1, x1 = 50;
      this.pieza('hormigon', null, s * (x0 + x1) / 2, 0.06, lado * (CALLE + 0.05), x1 - x0, 0.12, 0.12, blanco);
    }
    // Farolas
    for (const [x, z] of [[-24, 6.4], [24, -6.4], [-14, -6.4], [14, 6.4]]) {
      this.pieza('metal', null, x, 3, z, 0.14, 6, 0.14, new THREE.Color('#5a5a58'), 'metal');
      this.pieza('metal', null, x, 6.0, z - Math.sign(z) * 0.7, 0.2, 0.12, 1.4, new THREE.Color('#5a5a58'));
      this.pieza('vidrio', null, x, 5.9, z - Math.sign(z) * 1.3, 0.35, 0.15, 0.5, new THREE.Color('#fff3c0'));
    }
    // Buzones
    for (const [x, z] of [[-6, -6.6], [6, 6.6]]) {
      this.pieza('madera', null, x, 0.55, z, 0.1, 1.1, 0.1, new THREE.Color('#d0c8b8'), 'madera');
      this.pieza('metal', null, x, 1.15, z, 0.25, 0.25, 0.5, new THREE.Color('#3a5a8a'));
    }
  }

  autobus(x, z) {
    const amarillo = new THREE.Color('#e0a521'), negro = new THREE.Color('#1c1c1c');
    this.pieza('metal', null, x, 1.7, z, 10.5, 2.4, 2.5, amarillo, 'metal');
    this.pieza('vidrio', null, x - 0.3, 2.35, z, 9.2, 0.75, 2.53, new THREE.Color('#2a3036'));
    this.pieza('metal', null, x + 5.6, 1.1, z, 1.2, 1.2, 2.4, amarillo, 'metal');          // morro
    this.pieza('metal', null, x + 6.25, 0.7, z, 0.15, 0.3, 2.5, negro);
    this.pieza('metal', null, x - 5.3, 0.7, z, 0.15, 0.3, 2.5, negro);
    this.pieza('metal', null, x, 1.15, z, 10.6, 0.08, 2.52, negro);                         // franja
    for (const wx of [-3.5, 3.6]) for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14).rotateX(Math.PI / 2).translate(x + wx, 0.5, z + s * 1.1);
      conColor(g, negro); this.g.metal.push(g);
    }
  }

  coche(x, z, rot, color, tipo) {
    const c = new THREE.Color(color), negro = new THREE.Color('#1d1d1d'), vidrio = new THREE.Color('#2b343a');
    const M = new THREE.Matrix4().makeRotationY((rot * Math.PI) / 2).setPosition(x, 0, z);
    if (tipo === 'sedan') {
      this.pieza('metal', M, 0, 0.7, 0, 4.8, 0.7, 1.85, c, 'metal');
      this.pieza('metal', M, -0.2, 1.3, 0, 2.5, 0.55, 1.7, c, 'metal');
      this.pieza('vidrio', M, -0.2, 1.32, 0, 2.3, 0.45, 1.72, vidrio);
    } else if (tipo === 'pickup') {
      this.pieza('metal', M, 0, 0.75, 0, 5.2, 0.7, 1.9, c, 'metal');
      this.pieza('metal', M, 0.8, 1.45, 0, 1.6, 0.75, 1.8, c, 'metal');
      this.pieza('vidrio', M, 0.8, 1.5, 0, 1.4, 0.55, 1.82, vidrio);
      this.pieza('metal', M, -1.4, 1.25, 0.88, 2.3, 0.4, 0.08, c); this.pieza('metal', M, -1.4, 1.25, -0.88, 2.3, 0.4, 0.08, c);
    } else {
      this.pieza('metal', M, 2.6, 1.3, 0, 1.8, 2.0, 2.2, c, 'metal');
      this.pieza('vidrio', M, 3.4, 1.7, 0, 0.1, 0.7, 1.9, vidrio);
      this.pieza('metal', M, -1.1, 1.75, 0, 5.4, 2.7, 2.4, new THREE.Color('#d9d6cc'), 'metal');
    }
    const L = tipo === 'camion' ? 3.0 : 1.6;
    for (const wx of [-L, L]) for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12).rotateX(Math.PI / 2).translate(wx, 0.38, s * 0.92).applyMatrix4(M);
      conColor(g, negro); this.g.metal.push(g);
    }
  }

  // ---------------- Vallas ----------------
  valla(x0, z0, x1, z1, alto, tipo) {
    const largo = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / largo, uz = (z1 - z0) / largo;
    const blanca = new THREE.Color('#ece8dc'), madera = new THREE.Color('#a68a66');
    const col = tipo === 'estacas' ? blanca : madera;
    const paso = tipo === 'estacas' ? 0.16 : 0.15;
    for (let s = 0.05; s < largo; s += paso) {
      const x = x0 + ux * s, z = z0 + uz * s;
      const roto = tipo !== 'estacas' && Math.random() < 0.06;
      if (roto) continue;
      const a = tipo === 'estacas' ? alto : alto * (0.97 + Math.random() * 0.06);
      this.pieza('madera', null, x, a / 2, z, Math.abs(ux) > 0.5 ? (tipo === 'estacas' ? 0.08 : 0.14) : 0.03, a, Math.abs(ux) > 0.5 ? 0.03 : (tipo === 'estacas' ? 0.08 : 0.14), col, null, 1);
    }
    for (const yy of tipo === 'estacas' ? [0.25, alto - 0.2] : [0.3, alto - 0.3]) {
      this.pieza('madera', null, (x0 + x1) / 2, yy, (z0 + z1) / 2, Math.abs(ux) > 0.5 ? largo : 0.05, 0.07, Math.abs(ux) > 0.5 ? 0.05 : largo, col, null, 1);
    }
    const e = 0.06;
    this.m.addColisor({ x: Math.min(x0, x1) - e, y: 0, z: Math.min(z0, z1) - e }, { x: Math.max(x0, x1) + e, y: alto, z: Math.max(z0, z1) + e }, 'madera');
  }

  vallas() {
    // Vallas bajas de estacas delante de los jardines (se saltan), con huecos para el camino y la entrada
    for (const s of [-1, 1]) {
      const z = s * 6.3;
      const huecos = s < 0 ? [[-5, -3], [4.4, 9.1]] : [[3, 5], [-9.1, -4.4]];
      const cortes = [-17, ...huecos.flat().sort((a, b) => a - b), 17];
      for (let i = 0; i < cortes.length; i += 2) this.valla(cortes[i], z, cortes[i + 1], z, 0.9, 'estacas');
      // Laterales de los jardines delanteros
      this.valla(-17, z, -17, s * 23, 0.9, 'estacas');
      this.valla(17, z, 17, s * 23, 0.9, 'estacas');
      // Vallas altas de los patios traseros con portillos
      this.valla(-17, s * 23, -17, s * 34, 1.9, 'tablas');
      this.valla(17, s * 23, 17, s * 34, 1.9, 'tablas');
      this.valla(-17, s * 34, -3, s * 34, 1.9, 'tablas');
      this.valla(1, s * 34, 17, s * 34, 1.9, 'tablas');
    }
  }

  patios() {
    const madera = new THREE.Color('#8a6e52'), roja = new THREE.Color('#9a3b2e'), metal = new THREE.Color('#6a6a66');
    for (const s of [-1, 1]) {
      // Cobertizo
      const x = s * -12, z = s * 30;
      this.pieza('madera', null, x, 1.25, z, 3.2, 2.5, 2.6, roja, 'madera');
      this.pieza('madera', null, x, 2.6, z, 3.5, 0.15, 2.9, madera);
      // Mesa de pícnic y barbacoa
      this.pieza('madera', null, s * 6, 0.75, s * 28, 2.0, 0.08, 0.9, madera, 'madera');
      this.pieza('madera', null, s * 6, 0.4, s * 28.8, 2.0, 0.06, 0.3, madera);
      this.pieza('madera', null, s * 6, 0.4, s * 27.2, 2.0, 0.06, 0.3, madera);
      this.pieza('metal', null, s * 10, 0.5, s * 26, 0.6, 1.0, 0.6, metal, 'metal');
      // Columpio
      this.pieza('metal', null, s * -5, 2.1, s * 29, 0.08, 0.08, 3.2, metal);
      for (const dz of [-1.5, 1.5]) this.pieza('metal', null, s * -5, 1.05, s * 29 + dz, 0.08, 2.1, 0.08, metal, 'metal');
    }
  }

  // Maniquíes de pruebas: figuras humanas sin rasgos repartidas por el pueblo
  maniquies() {
    const pos = [[-6, -8, 0.3], [5, -9.5, 2.6], [-9.5, 8, 3.4], [7.5, 9, 1.2], [-1, -4.2, 1.6], [3, 4.6, 4.5], [-20, -3, 1.9], [21, 3.5, 4.2],
      [-3.5, -15.3, 0], [3.5, 15.3, 3.14], [10, -26, 0.8], [-9, 25, 2.5]];
    const piel = new THREE.Color('#d8c3a6'), ropa = [new THREE.Color('#7c8fa6'), new THREE.Color('#a66a5a'), new THREE.Color('#6e7d58'), new THREE.Color('#c9b48a')];
    pos.forEach(([x, z, yaw], i) => {
      const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, alturaVilla(x, z) + (Math.abs(z) > 14 && Math.abs(z) < 24 && Math.abs(x) < 6 ? 0.3 : 0), z);
      const c = ropa[i % ropa.length];
      const partes = [
        [new THREE.CapsuleGeometry(0.17, 0.42, 4, 10).translate(0, 1.25, 0), c],
        [new THREE.SphereGeometry(0.12, 12, 10).scale(0.9, 1.1, 1).translate(0, 1.72, 0), piel],
        [new THREE.CapsuleGeometry(0.075, 0.75, 3, 8).translate(-0.1, 0.48, 0), c],
        [new THREE.CapsuleGeometry(0.075, 0.75, 3, 8).translate(0.1, 0.48, 0), c],
        [new THREE.CapsuleGeometry(0.055, 0.55, 3, 8).rotateZ(i % 2 ? 0.25 : -0.9).translate(-0.27, 1.25, 0.05), piel],
        [new THREE.CapsuleGeometry(0.055, 0.55, 3, 8).rotateZ(-0.2).translate(0.26, 1.2, 0), piel],
      ];
      for (const [g, col] of partes) { g.applyMatrix4(M); conColor(g, col); this.g.maniqui.push(g); }
      const y = M.elements[13];
      this.m.addColisor({ x: x - 0.25, y, z: z - 0.25 }, { x: x + 0.25, y: y + 1.85, z: z + 0.25 }, 'madera');
    });
  }

  // Barreras de hormigón en los bordes jugables
  limites() {
    const gris = new THREE.Color('#b8b4aa');
    for (let x = LIM.x0; x <= LIM.x1; x += 3.2) for (const z of [LIM.z0 - 1, LIM.z1 + 1]) this.pieza('hormigon', null, x, 0.45, z, 3.0, 0.9, 0.6, gris, 'hormigon');
    for (let z = LIM.z0; z <= LIM.z1; z += 3.2) for (const x of [LIM.x0 - 1, LIM.x1 + 1]) {
      if (Math.abs(z) < CALLE + 1) continue;
      this.pieza('hormigon', null, x, 0.45, z, 0.6, 0.9, 3.0, gris, 'hormigon');
    }
  }

  // Paisaje lejano: torre de pruebas, búnkeres y postes en el desierto
  paisaje() {
    const acero = new THREE.Color('#6d6a64');
    const tx = 30, tz = -260, ty = alturaVilla(tx, tz);
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) this.pieza('metal', null, tx + dx, ty + 30, tz + dz, 0.4, 60, 0.4, acero);
    for (let h = 5; h < 60; h += 6) { this.pieza('metal', null, tx, ty + h, tz - 3, 6.4, 0.2, 0.2, acero); this.pieza('metal', null, tx, ty + h, tz + 3, 6.4, 0.2, 0.2, acero); this.pieza('metal', null, tx - 3, ty + h, tz, 0.2, 0.2, 6.4, acero); this.pieza('metal', null, tx + 3, ty + h, tz, 0.2, 0.2, 6.4, acero); }
    this.pieza('metal', null, tx, ty + 61, tz, 5, 3, 5, new THREE.Color('#8a857a'));
    for (const [x, z] of [[-120, 90], [140, -70], [-160, -110]]) this.pieza('hormigon', null, x, alturaVilla(x, z) + 1.2, z, 8, 2.4, 6, new THREE.Color('#a8a296'));
    for (let x = -300; x <= 300; x += 40) { const z = 110; this.pieza('madera', null, x, alturaVilla(x, z) + 4, z, 0.25, 8, 0.25, new THREE.Color('#6a5644')); }
  }

  bases() {
    const m = this.m;
    const spawns = (x) => [-6, -3, 0, 3, 6].map((z) => new THREE.Vector3(x, alturaVilla(x, z), z));
    m.bases = {
      UA: { spawns: spawns(-46), vehiculos: [], aeronaves: [], x: -46, z: 0, radio: 7, yaw: -Math.PI / 2 },
      RU: { spawns: spawns(46), vehiculos: [], aeronaves: [], x: 46, z: 0, radio: 7, yaw: Math.PI / 2 },
    };
    // Puntos de interés para la IA (calle, autobús, jardines, interiores y patios)
    m.puntosIA = [[-20, 0], [20, 0], [-8, 3], [8, -3], [0, -9], [0, 9], [-12, -14], [12, 14], [-4, -18], [4, 18], [-2, -21], [2, 21],
      [-10, -28], [10, 28], [7, -28], [-7, 28], [-30, 8], [30, -8], [-28, -20], [28, 20]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  }
}
