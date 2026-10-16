// Post-procesado: estética de cámara corporal (ojo de pez, aberración cromática, grano, viñeta,
// gradación de color), visor de tanque y vídeo analógico de dron FPV con interferencias.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from './util.js';

const ShaderCamara = {
  uniforms: {
    tDiffuse: { value: null },
    uTiempo: { value: 0 },
    uAspecto: { value: 1 },
    uDist: { value: 0.3 },
    uAberr: { value: 1 },
    uVineta: { value: 1 },
    uGrano: { value: 0.06 },
    uSat: { value: 0.82 },
    uAnalogico: { value: 0 },
    uSenal: { value: 1 },
    uDano: { value: 0 },
    uDestello: { value: 0 },
    uTermico: { value: 0 },
    uDesenfoque: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTiempo, uAspecto, uDist, uAberr, uVineta, uGrano, uSat, uAnalogico, uSenal, uDano, uDestello, uTermico, uDesenfoque;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    vec2 distorsion(vec2 uv, float k){
      vec2 c = uv - 0.5; c.x *= uAspecto;
      float r2 = dot(c, c);
      float rmax = 0.25 * (uAspecto * uAspecto + 1.0);
      c *= (1.0 + k * r2) / (1.0 + k * rmax);
      c.x /= uAspecto;
      return c + 0.5;
    }
    vec3 muestra(vec2 uv){
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uDesenfoque > 0.0) {
        float o = uDesenfoque * 0.004;
        col = (col + texture2D(tDiffuse, uv + vec2(o, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(o, 0.0)).rgb
             + texture2D(tDiffuse, uv + vec2(0.0, o)).rgb + texture2D(tDiffuse, uv - vec2(0.0, o)).rgb) / 5.0;
      }
      return col;
    }
    void main(){
      vec2 uv = vUv;
      float t = uTiempo;
      // Vídeo analógico: jitter horizontal por línea y barras rodantes
      float ruidoSenal = 1.0 - uSenal;
      if (uAnalogico > 0.5) {
        float linea = floor(uv.y * 240.0);
        float j = (hash(vec2(linea, floor(t * 60.0))) - 0.5) * (0.002 + ruidoSenal * 0.03);
        float rot = step(0.985 - ruidoSenal * 0.2, hash(vec2(floor(t * 8.0), linea * 0.1)));
        uv.x += j + rot * (hash(vec2(t, linea)) - 0.5) * 0.06 * ruidoSenal;
        uv.y += sin(t * 0.7) * 0.002 * ruidoSenal;
      }
      vec2 d = distorsion(uv, uDist);
      vec2 dir = d - 0.5;
      float ab = uAberr * 0.0035 * (1.0 + uAnalogico * 1.5);
      vec3 col;
      col.r = muestra(d + dir * ab).r;
      col.g = muestra(d).g;
      col.b = muestra(d - dir * ab).b;
      if (uAnalogico > 0.5) {
        // Sangrado de color horizontal
        vec3 s = texture2D(tDiffuse, d + vec2(0.004, 0.0)).rgb + texture2D(tDiffuse, d - vec2(0.004, 0.0)).rgb;
        col = mix(col, s * 0.5, 0.35);
      }
      // Fuera de imagen tras la distorsión -> negro
      if (d.x < 0.0 || d.x > 1.0 || d.y < 0.0 || d.y > 1.0) col = vec3(0.0);
      // Térmico (visor de tanque): blanco caliente
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      if (uTermico > 0.5) {
        float calor = smoothstep(0.05, 0.9, lum * 1.6);
        col = vec3(pow(calor, 1.2)) * vec3(0.95, 1.0, 0.95);
      }
      // Gradación tipo cámara corporal: saturación baja, negros levantados, tono frío en sombras
      col = mix(vec3(lum), col, uSat);
      col = col * 0.96 + 0.025;
      col = mix(col, col * vec3(0.92, 1.0, 1.04), 1.0 - smoothstep(0.0, 0.5, lum));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
      // Destello (explosión cercana) y daño
      col += uDestello * vec3(1.0, 0.95, 0.85);
      vec2 cv = vUv - 0.5;
      float vin = smoothstep(0.85, 0.2, length(cv * vec2(uAspecto * 0.8, 1.0)));
      col *= mix(1.0, vin, uVineta);
      col = mix(col, vec3(lum * 0.6, 0.02, 0.02), uDano * (1.0 - vin) * 0.85);
      col = mix(col, vec3(lum), uDano * 0.5);
      // Grano
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(t * 13.7) * 100.0) - 0.5;
      col += g * (uGrano + uAnalogico * 0.08 + ruidoSenal * uAnalogico * 0.5);
      if (uAnalogico > 0.5) {
        col *= 0.92 + 0.08 * sin(vUv.y * 900.0);
        float estatica = hash(vUv * 400.0 + t * 37.0);
        col = mix(col, vec3(estatica), clamp(ruidoSenal * ruidoSenal * 1.3, 0.0, 1.0));
      }
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export const PERFILES = {
  bodycam: { dist: 0.42, aberr: 1.0, vineta: 0.7, grano: 0.05, sat: 0.8, analogico: 0, termico: 0 },
  apuntando: { dist: 0.15, aberr: 0.6, vineta: 0.7, grano: 0.045, sat: 0.82, analogico: 0, termico: 0 },
  vehiculo3: { dist: 0.12, aberr: 0.4, vineta: 0.5, grano: 0.03, sat: 0.85, analogico: 0, termico: 0 },
  visorFusil: { dist: 0.0, aberr: 0.5, vineta: 0.3, grano: 0.04, sat: 0.85, analogico: 0, termico: 0 },
  visor: { dist: 0.0, aberr: 0.2, vineta: 1.0, grano: 0.05, sat: 0.6, analogico: 0, termico: 0 },
  termico: { dist: 0.0, aberr: 0.2, vineta: 1.0, grano: 0.08, sat: 0.0, analogico: 0, termico: 1 },
  dron: { dist: 0.7, aberr: 1.4, vineta: 0.8, grano: 0.06, sat: 0.7, analogico: 1, termico: 0 },
};

export class PostFX {
  constructor(renderer, scene, camara, calidad) {
    this.renderer = renderer;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: calidad.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camara);
    this.composer.addPass(this.render);
    this.composer.addPass(new OutputPass());
    this.pase = new ShaderPass(ShaderCamara);
    this.composer.addPass(this.pase);
    this.perfil = 'bodycam';
    this.dano = 0;
    this.destello = 0;
    this.senal = 1;
    this.desenfoque = 0;
    this.u = this.pase.uniforms;
  }

  setCamara(c) { this.render.camera = c; }
  setPerfil(p) { this.perfil = p; }

  resize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.u.uAspecto.value = w / h;
  }

  dibujar(dt) {
    const P = PERFILES[this.perfil], u = this.u;
    const salto = this.perfil === 'dron' || this.perfil === 'termico' || u.uAnalogico.value !== P.analogico;
    const k = salto ? 1000 : 8;
    u.uDist.value = damp(u.uDist.value, P.dist, k, dt);
    u.uAberr.value = damp(u.uAberr.value, P.aberr, k, dt);
    u.uVineta.value = damp(u.uVineta.value, P.vineta, k, dt);
    u.uGrano.value = P.grano;
    u.uSat.value = damp(u.uSat.value, P.sat, k, dt);
    u.uAnalogico.value = P.analogico;
    u.uTermico.value = P.termico;
    u.uTiempo.value += dt;
    u.uSenal.value = this.senal;
    u.uDano.value = this.dano;
    this.destello = Math.max(0, this.destello - dt * 3);
    u.uDestello.value = this.destello;
    this.desenfoque = Math.max(0, this.desenfoque - dt * 0.8);
    u.uDesenfoque.value = this.desenfoque;
    this.composer.render(dt);
  }
}
