// Cliente de red: conexión WebSocket con el servidor de retransmisión.
export class Red {
  constructor() {
    this.ws = null;
    this.id = null;
    this.conectado = false;
    this.manejadores = {};
    this.ping = 0;
  }

  on(tipo, fn) { this.manejadores[tipo] = fn; }

  conectar(url, nombre, faccion) {
    return new Promise((resolver, rechazar) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { rechazar(e); return; }
      this.ws = ws;
      const temporizador = setTimeout(() => { rechazar(new Error('Tiempo de conexión agotado')); ws.close(); }, 6000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hola', nombre, faccion }));
      ws.onerror = () => { clearTimeout(temporizador); rechazar(new Error('No se pudo conectar con ' + url)); };
      ws.onclose = () => { this.conectado = false; this.manejadores.desconexion?.(); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'bienvenida') {
          clearTimeout(temporizador);
          this.id = m.id;
          this.conectado = true;
          this.intervaloPing = setInterval(() => this.enviar({ t: 'ping', c: performance.now() }), 2000);
          resolver(m);
          return;
        }
        if (m.t === 'lleno') { clearTimeout(temporizador); rechazar(new Error('La sala está llena (máx. 4 jugadores)')); return; }
        if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.c); return; }
        this.manejadores[m.t]?.(m);
      };
    });
  }

  enviar(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  evento(e) { this.enviar({ t: 'ev', e }); }
  estado(s) { this.enviar({ t: 'est', s }); }
  cerrar() { clearInterval(this.intervaloPing); this.ws?.close(); }
}
