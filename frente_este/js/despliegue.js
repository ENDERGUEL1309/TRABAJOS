// Pantalla de despliegue: elección de clase (operador), armas y accesorios.
import { ARMAS, ACCESORIOS, CLASES, permitidos, accesoriosPorDefecto, estadisticas, equipoPorDefecto } from './arsenal.js';

const NOMBRES_ACC = { mira: 'Mira', boca: 'Bocacha', empunadura: 'Empuñadura', cargador: 'Cargador' };

export class Despliegue {
  constructor(juego) {
    this.j = juego;
    this.el = document.getElementById('despliegue');
    this.porClase = {};
    try { this.porClase = JSON.parse(localStorage.getItem('frenteEste.clases.' + juego.local.faccion) || '{}'); } catch { /* */ }
    this.eq = structuredCloneSeguro(juego.equipo);
    this.porClase[this.eq.clase] = this.eq;
    this.el.addEventListener('click', (e) => this.alClic(e));
    this.el.addEventListener('change', (e) => this.alCambio(e));
  }

  abrir() {
    this.el.style.display = 'flex';
    this.pintar();
  }

  cerrar() { this.el.style.display = 'none'; }

  alClic(e) {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const { accion, valor } = b.dataset;
    if (accion === 'clase') {
      this.porClase[this.eq.clase] = this.eq;
      this.eq = this.porClase[valor] && ARMAS[this.porClase[valor].primaria] ? this.porClase[valor] : equipoPorDefecto(valor, this.j.local.faccion);
    } else if (accion === 'primaria') {
      this.eq.primaria = valor; this.eq.accPrimaria = accesoriosPorDefecto(valor);
    } else if (accion === 'secundaria') {
      this.eq.secundaria = valor; this.eq.accSecundaria = accesoriosPorDefecto(valor);
    } else if (accion === 'especial') {
      this.eq.especial = valor;
    } else if (accion === 'desplegar') {
      this.porClase[this.eq.clase] = this.eq;
      try { localStorage.setItem('frenteEste.clases.' + this.j.local.faccion, JSON.stringify(this.porClase)); } catch { /* */ }
      this.cerrar();
      this.j.desplegar(structuredCloneSeguro(this.eq));
      return;
    }
    this.pintar();
  }

  alCambio(e) {
    const s = e.target;
    if (!s.dataset.acc) return;
    const clave = s.dataset.ranura === 'secundaria' ? 'accSecundaria' : 'accPrimaria';
    this.eq[clave] = { ...this.eq[clave], [s.dataset.acc]: s.value };
    this.pintar();
  }

  pintar() {
    const eq = this.eq, C = CLASES[eq.clase];
    const clases = Object.entries(CLASES).map(([k, c]) => `<button class="dp-clase${k === eq.clase ? ' activa' : ''}" data-accion="clase" data-valor="${k}"><b>${c.nombre}</b><span>${resumenClase(c)}</span></button>`).join('');
    const botones = (lista, actual, accion) => lista.map((id) => `<button class="dp-arma${id === actual ? ' activa' : ''}" data-accion="${accion}" data-valor="${id}">${ARMAS[id].nombre}<small>${ARMAS[id].municion}</small></button>`).join('');
    const accesorios = (id, acc, ranura) => {
      const P = permitidos(id);
      return Object.keys(NOMBRES_ACC).filter((k) => P[k].length > 1).map((k) => `<label>${NOMBRES_ACC[k]}<select data-acc="${k}" data-ranura="${ranura}" id="acc-${ranura}-${k}">${P[k].map((o) => `<option value="${o}"${acc[k] === o ? ' selected' : ''}>${ACCESORIOS[k][o].nombre}</option>`).join('')}</select></label>`).join('');
    };
    const accP = eq.accPrimaria || accesoriosPorDefecto(eq.primaria);
    eq.accPrimaria = accP;
    const d = estadisticas(eq.primaria, accP);
    const barras = [
      ['Daño', d.danoSold / 150], ['Cadencia', d.auto ? d.cadencia / 900 : d.cadencia / 1200], ['Alcance', d.vel / 950],
      ['Control', 1 - Math.min(1, d.retroceso / 0.07)], ['Precisión', 1 - Math.min(1, d.dispMira / 0.004)], ['Movilidad', (d.velMov || 1) * (d.tipo === 'carabina' ? 1 : 0.85)],
    ].map(([n, v]) => `<div class="dp-barra"><span>${n}</span><i><b style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></b></i></div>`).join('');
    this.el.innerHTML = `
      <div class="dp-panel">
        <header><h2>DESPLIEGUE</h2><span>${this.j.local.faccion === 'UA' ? 'Fuerzas Armadas de Ucrania' : 'Fuerzas Armadas de Rusia'}</span></header>
        <div class="dp-clases">${clases}</div>
        <p class="dp-desc">${C.desc}</p>
        <div class="dp-cuerpo">
          <section>
            <h3>Arma principal</h3>
            <div class="dp-armas">${botones(C.primarias, eq.primaria, 'primaria')}</div>
            <div class="dp-ficha"><b>${d.nombre}</b> · ${d.municion} · cargador ${d.cargador} · ${d.auto ? 'automática' : d.cerrojo ? 'cerrojo' : 'semiautomática'}${d.visor ? ' · óptica ' + d.zoom + '×' : ''}</div>
            <div class="dp-barras">${barras}</div>
            <div class="dp-acc">${accesorios(eq.primaria, accP, 'primaria')}</div>
          </section>
          <section>
            <h3>Pistola</h3>
            <div class="dp-armas">${botones(C.secundarias, eq.secundaria, 'secundaria')}</div>
            <div class="dp-acc">${accesorios(eq.secundaria, eq.accSecundaria || accesoriosPorDefecto(eq.secundaria), 'secundaria')}</div>
            ${C.especiales.length ? `<h3>Lanzacohetes</h3><div class="dp-armas">${botones(C.especiales, eq.especial, 'especial')}</div>` : ''}
            <p class="dp-extra">Granadas F-1: <b>${C.granadas}</b> · Drones FPV: <b>${C.drones}</b>${C.reabastece ? ' · Reabastece munición a aliados' : ''}</p>
          </section>
        </div>
        <button class="dp-desplegar" data-accion="desplegar">DESPLEGAR</button>
      </div>`;
  }
}

function resumenClase(c) {
  return c.primarias.slice(0, 2).map((id) => ARMAS[id].nombre).join(' / ') + (c.especiales.length ? ' + lanzacohetes' : '') + (c.drones > 1 ? ` + ${c.drones} drones` : '');
}

function structuredCloneSeguro(o) { return JSON.parse(JSON.stringify(o)); }
