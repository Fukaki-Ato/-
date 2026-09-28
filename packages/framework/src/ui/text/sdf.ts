/**
 * SDF 文本着色器材质（assets/fonts/README.md §4 的采样约定）。
 * d = (v.r - 0.5) * uSpreadK，单位「设备像素」，正=字形内部；uSpreadK = spread * k * pixelRatio。
 * 抗锯齿半宽 w = max(fwidth(d), 0.5)（1 设备像素过渡）；WebGL1 需 derivatives 扩展（已声明）。
 */
import * as THREE from 'three';
import { clipUniforms, uiColor } from '../paint.js';

export const SDF_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vClipWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vClipWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SDF_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uSpreadK;
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
  float d = (texture2D(uAtlas, vUv).r - 0.5) * uSpreadK;
  float w = max(fwidth(d), 0.5);
  float alpha = smoothstep(-w, w, d) * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export interface SdfMaterialParams {
  color: THREE.ColorRepresentation;
  opacity: number;
  /** spread * (fontSizePx/sdf.fontSize) * pixelRatio —— 距离场换算到设备像素的系数 */
  spreadK: number;
}

export function createSdfMaterial(texture: THREE.Texture | null, p: SdfMaterialParams): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: texture },
      uSpreadK: { value: p.spreadK },
      uColor: { value: uiColor(p.color) },
      uOpacity: { value: p.opacity },
      ...clipUniforms(),
    },
    vertexShader: SDF_VERTEX_SHADER,
    fragmentShader: SDF_FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
}

/** 按目标字号刷新 spreadK（S 变化 / pixelRatio 变化时调用） */
export function spreadKFor(sdfSpread: number, sdfFontSize: number, fontSizePx: number, pixelRatio: number): number {
  return sdfSpread * (fontSizePx / sdfFontSize) * pixelRatio;
}
