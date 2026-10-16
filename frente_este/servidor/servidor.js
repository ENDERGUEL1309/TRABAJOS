// Servidor de FRENTE ESTE (beta): sirve los archivos estáticos del juego y retransmite el estado
// entre hasta 4 jugadores por sala mediante WebSocket. Uso: node servidor.js [puerto]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PUERTO = Number(process.argv[2] || process.env.PORT || 8080);
const RAIZ = path.resolve(__dirname, '..');
const MAX_JUGADORES = 4;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const servidor = http.createServer((req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (ruta === '/') ruta = '/index.html';
  const archivo = path.normalize(path.join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ + path.sep) || archivo.includes(`${path.sep}servidor${path.sep}`)) { res.writeHead(403); res.end(); return; }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(datos);
  });
});

const salas = new Map(); // nombre -> { jugadores: Map(id -> {ws, nombre, faccion}), ocupantes: Map(vid -> id) }
let siguienteId = 1;

function sala(nombre) {
  if (!salas.has(nombre)) salas.set(nombre, { jugadores: new Map(), ocupantes: new Map() });
  return salas.get(nombre);
}
function enviar(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function difundir(s, msg, excepto) {
  const txt = JSON.stringify(msg);
  for (const [id, j] of s.jugadores) if (id !== excepto && j.ws.readyState === 1) j.ws.send(txt);
}

const wss = new WebSocketServer({ server: servidor, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const nombreSala = (new URL(req.url, 'http://x').searchParams.get('sala') || 'beta').slice(0, 32);
  const s = sala(nombreSala);
  let id = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'hola' && id === null) {
      if (s.jugadores.size >= MAX_JUGADORES) { enviar(ws, { t: 'lleno' }); ws.close(); return; }
      id = 'j' + siguienteId++;
      // Equilibrio de bandos (2 contra 2)
      let ua = 0, ru = 0;
      for (const j of s.jugadores.values()) j.faccion === 'UA' ? ua++ : ru++;
      let faccion = m.faccion === 'RU' || m.faccion === 'UA' ? m.faccion : (ua <= ru ? 'UA' : 'RU');
      if (faccion === 'UA' && ua >= 2 && ru < 2) faccion = 'RU';
      if (faccion === 'RU' && ru >= 2 && ua < 2) faccion = 'UA';
      const nombre = String(m.nombre || 'Soldado').slice(0, 16);
      s.jugadores.set(id, { ws, nombre, faccion });
      enviar(ws, {
        t: 'bienvenida', id, faccion, sala: nombreSala,
        jugadores: [...s.jugadores].filter(([k]) => k !== id).map(([k, j]) => ({ id: k, nombre: j.nombre, faccion: j.faccion })),
        ocupantes: Object.fromEntries(s.ocupantes),
      });
      difundir(s, { t: 'entra', id, nombre, faccion }, id);
      console.log(`[${nombreSala}] entra ${nombre} (${id}, ${faccion}) — ${s.jugadores.size}/${MAX_JUGADORES}`);
      return;
    }
    if (id === null) return;
    switch (m.t) {
      case 'est': difundir(s, { t: 'est', id, s: m.s }, id); break;
      case 'ev': difundir(s, { t: 'ev', id, e: m.e }, id); break;
      case 'subir': {
        const ocupante = s.ocupantes.get(m.vid);
        if (ocupante && ocupante !== id) { enviar(ws, { t: 'subirNo', vid: m.vid }); break; }
        for (const [vid, o] of s.ocupantes) if (o === id) s.ocupantes.delete(vid);
        s.ocupantes.set(m.vid, id);
        enviar(ws, { t: 'subirOk', vid: m.vid });
        difundir(s, { t: 'ocup', vid: m.vid, id }, null);
        break;
      }
      case 'bajar':
        if (s.ocupantes.get(m.vid) === id) { s.ocupantes.delete(m.vid); difundir(s, { t: 'ocup', vid: m.vid, id: null }, null); }
        break;
      case 'ping': enviar(ws, { t: 'pong', c: m.c }); break;
    }
  });

  ws.on('close', () => {
    if (id === null) return;
    s.jugadores.delete(id);
    for (const [vid, o] of s.ocupantes) if (o === id) { s.ocupantes.delete(vid); difundir(s, { t: 'ocup', vid, id: null }, null); }
    difundir(s, { t: 'sale', id }, null);
    console.log(`[${nombreSala}] sale ${id} — ${s.jugadores.size}/${MAX_JUGADORES}`);
    if (s.jugadores.size === 0) salas.delete(nombreSala);
  });
});

servidor.listen(PUERTO, () => console.log(`FRENTE ESTE — servidor en http://localhost:${PUERTO}  (WebSocket en /ws)`));
