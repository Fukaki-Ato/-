/**
 * UI 基础贴片材质（九宫格/占位方块共用）：自定义 ShaderMaterial 直通管线。
 * 颜色约定（全 UI 一致，WYSIWYG）：纹理 NoColorSpace 原样采样、颜色经 uiColor() 存原始 sRGB 值、
 * 自定义 shader 原样输出——绕开 three 色彩管理（sRGB→linear 转换会让 #7FD1FF 变暗成 (54,163,255)），
 * 也不受宿主 renderer 的 outputColorSpace/toneMapping 影响；主场景材质不受任何干扰。
 */
import * as THREE from 'three';
import { clipUniforms, uiColor } from '../paint.js';

const UI_BASIC_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vClipWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vClipWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const UI_BASIC_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec4 uClipPlanes[8];
uniform float uClipCount;
varying vec3 vClipWorld;
varying vec2 vUv;
void main() {
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uClipCount) break;
    if (dot(vClipWorld, uClipPlanes[i].xyz) + uClipPlanes[i].w < 0.0) discard;
  }
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * t.rgb, a);
}
`;

export function createUiBasicMaterial(opts: { map: THREE.Texture; color?: THREE.ColorRepresentation; opacity?: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: opts.map },
      uColor: { value: uiColor(opts.color ?? '#ffffff') },
      uOpacity: { value: opts.opacity ?? 1 },
      ...clipUniforms(),
    },
    vertexShader: UI_BASIC_VERT,
    fragmentShader: UI_BASIC_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function setUiBasicColor(mat: THREE.ShaderMaterial, c: THREE.ColorRepresentation): void {
  (mat.uniforms.uColor!.value as THREE.Color).copy(uiColor(c));
}

export function setUiBasicOpacity(mat: THREE.ShaderMaterial, o: number): void {
  mat.uniforms.uOpacity!.value = o;
}

/** 1×1 白纹理（无贴图纯色片用） */
export function createWhiteTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}
