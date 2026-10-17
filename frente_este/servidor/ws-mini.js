// WebSocket mínimo (RFC 6455) sin dependencias: solo lo que necesita el servidor del juego
// (mensajes de texto, ping/pong y cierre). Misma interfaz básica que el paquete "ws".
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Conexion extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.readyState = 1;
    this.bufer = Buffer.alloc(0);
    this.fragmentos = [];
    socket.setNoDelay(true);
    socket.on('data', (d) => this.recibir(d));
    socket.on('close', () => this.finalizar());
    socket.on('error', () => this.finalizar());
  }

  recibir(datos) {
    this.bufer = Buffer.concat([this.bufer, datos]);
    while (this.bufer.length >= 2) {
      const b0 = this.bufer[0], b1 = this.bufer[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, enmascarado = (b1 & 0x80) !== 0;
      let largo = b1 & 0x7f, pos = 2;
      if (largo === 126) { if (this.bufer.length < 4) return; largo = this.bufer.readUInt16BE(2); pos = 4; }
      else if (largo === 127) { if (this.bufer.length < 10) return; largo = Number(this.bufer.readBigUInt64BE(2)); pos = 10; }
      if (largo > this.maxPayload) { this.close(); return; }
      const total = pos + (enmascarado ? 4 : 0) + largo;
      if (this.bufer.length < total) return;
      let carga = this.bufer.subarray(pos + (enmascarado ? 4 : 0), total);
      if (enmascarado) {
        const m = this.bufer.subarray(pos, pos + 4);
        carga = Buffer.from(carga);
        for (let i = 0; i < carga.length; i++) carga[i] ^= m[i & 3];
      }
      this.bufer = this.bufer.subarray(total);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.trama(0xa, carga); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.fragmentos.push(carga);
        if (fin) { const msg = Buffer.concat(this.fragmentos); this.fragmentos = []; this.emit('message', msg); }
      }
    }
  }

  trama(op, carga) {
    if (this.readyState !== 1) return;
    const n = carga.length;
    const cab = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
    this.socket.write(Buffer.concat([cab, carga]));
  }

  send(texto) { this.trama(0x1, Buffer.from(String(texto))); }

  close() {
    if (this.readyState !== 1) return;
    try { this.socket.write(Buffer.from([0x88, 0])); } catch { /* ya cerrado */ }
    this.readyState = 2;
    this.socket.end();
    this.finalizar();
  }

  finalizar() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.socket.destroy();
    this.emit('close');
  }
}

class WebSocketServer extends EventEmitter {
  constructor({ server, path = '/', maxPayload = 64 * 1024 }) {
    super();
    server.on('upgrade', (req, socket) => {
      const ruta = new URL(req.url, 'http://x').pathname;
      const clave = req.headers['sec-websocket-key'];
      if (ruta !== path || !clave || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
      const acepta = crypto.createHash('sha1').update(clave + GUID).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acepta}\r\n\r\n`);
      this.emit('connection', new Conexion(socket, maxPayload), req);
    });
  }
}

module.exports = { WebSocketServer };
