// Arranque: menú, ajustes persistentes, pantalla completa/orientación y creación de la partida.
import { Juego } from './juego.js';
import { Audio } from './audio.js';
import { isTouchDevice } from './util.js';

const $ = (id) => document.getElementById(id);
const tactilDetectado = isTouchDevice();
let tactil = tactilDetectado;

function cargarAjustes() {
  let a = {};
  try { a = JSON.parse(localStorage.getItem('frenteEste.ajustes') || '{}'); } catch { /* sin almacenamiento */ }
  const porDefecto = location.protocol.startsWith('http') && location.port ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` : '';
  return {
    nombre: a.nombre || 'Soldado' + Math.floor(Math.random() * 90 + 10),
    modo: a.modo || 'local',
    url: a.url || porDefecto,
    sala: a.sala || 'beta',
    faccion: a.faccion || 'auto',
    calidad: a.calidad || (tactil ? 'media' : 'alta'),
    fov: a.fov || (tactil ? 72 : 75),
    sens: a.sens || 1,
    punto: a.punto ?? true,
    controles: a.controles || 'auto',
    modoDron: 'ESTABLE',
  };
}

const aj = cargarAjustes();
$('opNombre').value = aj.nombre;
$('opModo').value = aj.modo;
$('opUrl').value = aj.url;
$('opSala').value = aj.sala;
$('opFaccion').value = aj.faccion;
$('opCalidad').value = aj.calidad;
$('opFov').value = aj.fov;
$('opSens').value = aj.sens;
$('opPunto').checked = aj.punto;
$('opControles').value = aj.controles;
const refrescar = () => {
  $('opFovV').textContent = $('opFov').value + '°';
  $('opSensV').textContent = Number($('opSens').value).toFixed(1);
  document.body.classList.toggle('modoRed', $('opModo').value === 'red');
};
for (const id of ['opFov', 'opSens', 'opModo']) $(id).addEventListener('input', refrescar);
refrescar();

// Aviso de orientación en móviles
function orientacion() {
  $('girar').style.display = tactil && innerHeight > innerWidth ? 'flex' : 'none';
}
addEventListener('resize', orientacion);
orientacion();

let juego = null;
$('btnJugar').addEventListener('click', async () => {
  if (juego) return;
  Object.assign(aj, {
    nombre: $('opNombre').value.trim() || 'Soldado', modo: $('opModo').value, url: $('opUrl').value.trim(), sala: $('opSala').value.trim() || 'beta',
    faccion: $('opFaccion').value, calidad: $('opCalidad').value, fov: Number($('opFov').value), sens: Number($('opSens').value), punto: $('opPunto').checked, controles: $('opControles').value,
  });
  tactil = aj.controles === 'tactil' ? true : aj.controles === 'pc' ? false : tactilDetectado;
  try { localStorage.setItem('frenteEste.ajustes', JSON.stringify(aj)); } catch { /* ignorar */ }
  const audio = new Audio();
  audio.iniciar(); // requiere gesto del usuario
  if (tactil) {
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* no soportado */ }
    try { await screen.orientation?.lock?.('landscape'); } catch { /* no soportado */ }
  }
  $('btnJugar').disabled = true;
  const ajustes = {
    fov: aj.fov, sensRaton: aj.sens, sensTactil: aj.sens * 1.7, punto: aj.punto, tactil, modoDron: aj.modoDron,
    forzarTactil: aj.controles === 'tactil', forzarPC: aj.controles === 'pc',
  };
  let url = aj.url;
  if (aj.modo === 'red') {
    if (!url) { $('estadoCarga').textContent = 'Indica la dirección del servidor (ws://IP:8080/ws)'; $('btnJugar').disabled = false; return; }
    url += (url.includes('?') ? '&' : '?') + 'sala=' + encodeURIComponent(aj.sala);
  }
  juego = new Juego({ nombre: aj.nombre, modo: aj.modo, url, faccion: aj.faccion, calidad: aj.calidad, ajustes, audio });
  window.juego = juego;
  try {
    await juego.iniciar((t) => { $('estadoCarga').textContent = t; });
    $('menu').style.display = 'none';
    document.body.classList.add('jugando');
  } catch (err) {
    console.error(err);
    $('estadoCarga').textContent = 'Error: ' + (err.message || err);
    $('btnJugar').disabled = false;
    juego?.renderer?.setAnimationLoop(null);
    juego = null;
  }
});
