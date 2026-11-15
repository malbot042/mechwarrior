// Post-proceso CRT: pantalla plana (sin curvatura ni esquinas redondeadas),
// scanlines, máscara de apertura RGB, aberración cromática, bloom de fósforo,
// ruido, parpadeo y banda de refresco.
import * as THREE from 'three';

const frag = /* glsl */`
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tHud;
uniform float uTime;
uniform vec2  uRes;      // resolución virtual (líneas)
uniform vec2  uOut;      // resolución real en píxeles
uniform int   uPalette;  // 0 color, 1 ámbar, 2 verde
uniform float uShake;
uniform float uFlash;
uniform float uStatic;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

vec3 src(vec2 uv){
  vec3 c = texture2D(tScene, uv).rgb;
  c = pow(max(c, 0.0), vec3(1.0/2.2));          // lineal -> pantalla
  vec4 h = texture2D(tHud, uv);
  return mix(c, h.rgb, h.a);
}

void main(){
  vec2 uv = vUv;
  // temblor horizontal por línea
  float line = floor(uv.y * uRes.y);
  float jit = (hash(vec2(line, floor(uTime*40.0))) - 0.5) * (0.0006 + uShake*0.006 + uStatic*0.02);
  uv.x += jit;
  uv = clamp(uv, 0.0, 1.0);

  // aberración cromática
  vec2 ca = vec2(0.0009 + uShake*0.003, 0.0);
  vec3 col;
  col.r = src(uv + ca).r;
  col.g = src(uv).g;
  col.b = src(uv - ca).b;

  // bloom barato (fósforo)
  vec2 px = 1.0 / uRes;
  vec3 glow = vec3(0.0);
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      glow += src(uv + vec2(float(i), float(j)) * px * 2.2);
  glow /= 9.0;
  col += max(glow - 0.35, 0.0) * 0.8;

  // paletas monocromo
  float lum = dot(col, vec3(0.30, 0.59, 0.11));
  if (uPalette == 1) col = vec3(1.0, 0.64, 0.20) * lum * 1.3;
  else if (uPalette == 2) col = vec3(0.38, 1.0, 0.48) * lum * 1.25;

  // scanlines: una línea oscura por cada fila virtual
  float s = sin(vUv.y * uRes.y * 3.14159265);
  col *= 0.62 + 0.38 * s * s;

  // máscara de apertura (rejilla vertical RGB) en píxeles reales
  float m = mod(gl_FragCoord.x, 3.0);
  vec3 mask = m < 1.0 ? vec3(1.0, 0.78, 0.78) : (m < 2.0 ? vec3(0.78, 1.0, 0.78) : vec3(0.78, 0.78, 1.0));
  col *= mask * 1.18;

  // banda de refresco que baja lentamente
  float roll = fract(uTime * 0.07);
  col *= 1.0 + 0.05 * exp(-pow((1.0 - vUv.y - roll) * 30.0, 2.0));

  // ruido y estática
  float n = hash(vUv * uOut + fract(uTime) * 100.0);
  col += (n - 0.5) * (0.035 + uStatic * 0.6);
  col = mix(col, vec3(n), uStatic * 0.35);

  // parpadeo de red eléctrica
  col *= 0.975 + 0.025 * sin(uTime * 120.0);

  // viñeta suave y rectangular (las esquinas siguen siendo rectas)
  vec2 v = vUv * (1.0 - vUv);
  col *= 0.82 + 0.18 * clamp(pow(v.x * v.y * 20.0, 0.25), 0.0, 1.0);

  col += uFlash * vec3(1.0, 0.85, 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createCRT(renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tHud: { value: null }, uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) }, uOut: { value: new THREE.Vector2(1, 1) },
      uPalette: { value: 0 }, uShake: { value: 0 }, uFlash: { value: 0 }, uStatic: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    uniforms: mat.uniforms,
    render() { renderer.setRenderTarget(null); renderer.render(scene, cam); },
  };
}
