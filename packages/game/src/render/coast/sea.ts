/**
 * 白日海景 · 海面与空气感（三个手写着色器，全部无贴图无依赖）。
 * sea：顶点做两层正弦起伏（近岸幅度大、远处压平，免得远处糊成一片抖），片元按深度渐变蓝、
 *      叠一层细碎波光（sin 的高次幂 ⇒ 只有很窄的亮点在闪）、靠岸一条摆动的水线泡沫，
 *      并按视距向雾色收出去 ⇒ 「远处海平面光影 + 海岸线渐变景深」一次做完。
 * mist：几片巨大的软边四边形慢慢横飘 ⇒ 海面薄雾缓慢流动。
 * sparkle：不用几何波动的碎光点，走实例化小方片按相位明灭，比在顶点里算更省。
 */
import * as THREE from 'three';

/**
 * 海面材质。
 * ⚠ 轴向：几何是 PlaneGeometry 绕 x 躺平的，于是 uv.x ↔ 世界 x（垂直海岸线，也就是「离岸远近」），
 * uv.y ↔ 世界 -z（沿着海岸线）。所以深度、泡沫、浪幅全部按 u 算，按 v 算会画出一条条横在面上的白带
 * （第一版就踩了这个：水线本该是沿海岸的一条，结果变成沿 z 的等距条纹）。
 * @param shoreU 水线所在的 u（0=最远海，1=岸）
 */
export function seaMat(light: string, deep: string, foamColor: string, hazeColor: string,
  amp: number, shoreU: number, sparkle: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uT: { value: 0 }, uLight: { value: new THREE.Color(light) }, uDeep: { value: new THREE.Color(deep) },
      uFoam: { value: new THREE.Color(foamColor) }, uHaze: { value: new THREE.Color(hazeColor) },
      uAmp: { value: amp }, uShore: { value: shoreU }, uSpark: { value: sparkle },
    },
    vertexShader: [
      'uniform float uT; uniform float uAmp; varying vec2 vUv; varying float vD;',
      'void main() {',
      '  vUv = uv;',
      '  vec3 p = position;',
      '  float off = smoothstep(0.0, 0.5, 1.0 - uv.x);',                        // 越近岸浪越小
      '  p.y += sin(p.x * 0.5 + uT * 1.15) * uAmp * off + sin(p.z * 0.36 - uT * 0.85) * uAmp * 0.7 * off;',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      '  vD = -mv.z;',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uLight; uniform vec3 uDeep; uniform vec3 uFoam; uniform vec3 uHaze;',
      'uniform float uT; uniform float uShore; uniform float uSpark;',
      'varying vec2 vUv; varying float vD;',
      'void main() {',
      '  float off = 1.0 - vUv.x;',                                              // 0=岸边 1=远海
      '  vec3 c = mix(uLight, uDeep, smoothstep(0.02, 0.42, off));',             // 浅滩清透 → 外海深蓝
      '  float wob = 0.012 * sin(vUv.y * 26.0 + uT * 1.6) + 0.007 * sin(vUv.y * 13.0 - uT);',
      '  c = mix(c, uFoam, smoothstep(0.05 + wob, 0.0, abs(off - uShore)));',     // 沿海岸的一条泡沫线
      '  float s = sin(vUv.y * 150.0 + uT * 1.9) * sin(off * 210.0 - uT * 1.4);',
      '  c += uFoam * pow(max(s, 0.0), 24.0) * uSpark * smoothstep(0.05, 0.3, off);',  // 细碎波光
      '  c = mix(c, uHaze, smoothstep(60.0, 190.0, vD));',                         // 远海收进雾色 = 景深
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
  });
}

/** 浅滩薄水：半透明、带一点起伏与泡沫，铺在湿沙上（同样按 u=离岸方向收边） */
export function shallowMat(color: string, foamColor: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uF: { value: new THREE.Color(foamColor) },
    },
    vertexShader: [
      'uniform float uT; varying vec2 vUv; varying float vE;',
      'void main() {',
      '  vUv = uv;',
      '  vec3 p = position;',
      '  p.y += sin(p.x * 1.3 + uT * 1.6) * 0.03 + sin(p.z * 0.9 - uT * 1.1) * 0.026;',
      '  vE = p.y;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uC; uniform vec3 uF; uniform float uT; varying vec2 vUv; varying float vE;',
      'void main() {',
      '  float land = vUv.x;',                                                   // 0=靠海 1=靠陆
      '  float edge = smoothstep(0.96, 0.42, land);',                            // 往陆侧慢慢退掉
      '  float foam = smoothstep(0.6, 0.53, land) * smoothstep(0.44, 0.52, land)',
      '    * (0.5 + 0.5 * sin(vUv.y * 34.0 + uT * 2.0));',                        // 一条摆动的水痕
      '  vec3 c = mix(uC, uF, clamp(foam, 0.0, 1.0));',
      '  gl_FragColor = vec4(c, (0.4 + 0.25 * vE + foam * 0.5) * edge);',
      '}',
    ].join('\n'),
  });
}

/** 薄雾片：躺平的大方片，软边靠 poolMat 那套径向衰减；这里只做几何 */
export function mistGeo(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 海面/浅滩共用的一块平面（躺平，uv 保留给着色器） */
export function waterGeo(w: number, h: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, seg, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}
