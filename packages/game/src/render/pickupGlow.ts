/**
 * 道具地面光圈（render 层）：悬浮道具正下方的一圈"魔法阵"亮环，提示玩家这里能捡。
 * 与 konbini 灯池同一套思路（径向软衰减 + 加色混合 + 视距淡出），形态是
 * 「内圈软光池 + 亮环带 + 两道沿环缓旋的高光弧」，颜色按道具徽标主色走。
 * 几何/材质全部预建（道具槽 ≤8），逐帧只写 position 与两个 uniform，零分配；
 * 远处靠 shader 里的视距淡出收掉，不额外做可见性剔除。
 */
import * as THREE from 'three';

/** 每道具光圈色（徽标主色的亮部；加色混合下偏亮才压得住路面）；未登记 id 走兜底暖白 */
const GLOW_COLOR: Record<string, number> = {
  item_coin: 0xffd23f,
  item_key: 0x8fe8ff,
  item_magnet: 0xb48cff,
  item_shield: 0x5fe8e0,
  item_jetpack: 0xffa94d,
  item_board: 0x9a5cff,
  item_multiplier: 0xffd23f,
  item_xp_card: 0xffe9a8,
  item_boots: 0x43d9a3,
  item_helmet: 0xffc94d,
};
const GLOW_DEFAULT = 0xfff1c9;

/** 光圈直径（米）：0.7m 箱的约 1.7 倍，环带不蹭道具本体 */
const DIAMETER = 1.7;
/** 视距淡出（米）：60m 内全亮，100m 收没（与 konbini 灯池口径一致） */
const FADE_NEAR = 60, FADE_FAR = 100;
/** 呼吸与高光弧旋转速率：呼吸让光圈"活着"，弧旋给"充能中"的动感 */
const PULSE_BASE = 0.86, PULSE_AMP = 0.14, PULSE_RAD_S = 1.5, ARC_RAD_S = 0.55;
const MAX = 8;

const VERT = [
  'varying vec2 vUv; varying float vD;',
  'void main() {',
  '  vUv = uv;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  vD = -mv.z;',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');

const FRAG = [
  'uniform vec3 uColor; uniform float uK; uniform float uT;',
  'uniform float uNear; uniform float uFar;',
  'varying vec2 vUv; varying float vD;',
  'void main() {',
  '  float r = length(vUv - 0.5) * 2.0;',
  '  if (r > 1.0) discard;',
  '  float pool = pow(1.0 - r, 2.2) * 0.52;',                                  // 内圈软光池
  '  float ring = smoothstep(0.30, 0.62, r) * smoothstep(1.0, 0.78, r);',      // 亮环带主体
  '  float ang = atan(vUv.y - 0.5, vUv.x - 0.5);',
  '  float arc = pow(max(sin((ang + uT) * 2.0), 0.0), 6.0);',                  // 两道对置高光弧缓旋
  '  float a = pool + ring * (0.78 + 0.32 * arc);',
  '  float k = a * uK * smoothstep(uFar, uNear, vD);',
  '  gl_FragColor = vec4(uColor * k, k);',
  '}',
].join('\n');

export interface PickupGlow {
  /** 占一个光圈槽位（与道具同 x/z，y 固定贴地）；phase 用 worldZ 错开呼吸/旋弧相位 */
  show(x: number, z: number, itemRef: string, phase: number, t: number): void;
  /** 帧末收掉本帧没刷新到的槽位 */
  hideRest(): void;
}

export function createPickupGlow(scene: THREE.Scene): PickupGlow {
  const geo = new THREE.PlaneGeometry(DIAMETER, DIAMETER);
  geo.rotateX(-Math.PI / 2);
  const colorCache = new Map<string, THREE.Color>();
  const slots: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  for (let i = 0; i < MAX; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(GLOW_DEFAULT) }, uK: { value: 1 }, uT: { value: 0 },
        uNear: { value: FADE_NEAR }, uFar: { value: FADE_FAR },
      },
      vertexShader: VERT, fragmentShader: FRAG,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.position.y = 0.03; // 高于车道虚线（0.014），贴住路面
    mesh.frustumCulled = false;
    scene.add(mesh);
    slots.push({ mesh, mat });
  }
  /** 本帧已占用数：show 顺序占位，hideRest 只收掉没用到的（与模型槽同款协议） */
  let used = 0;

  return {
    show(x, z, itemRef, phase, t) {
      if (used >= MAX) return; // 槽满：光圈是加分项，丢弃不报错
      const slot = slots[used++];
      const col = colorCache.get(itemRef) ?? colorCache.set(itemRef, new THREE.Color(GLOW_COLOR[itemRef] ?? GLOW_DEFAULT)).get(itemRef)!;
      (slot.mat.uniforms['uColor'].value as THREE.Color).copy(col);
      slot.mat.uniforms['uK'].value = PULSE_BASE + PULSE_AMP * Math.sin(t * PULSE_RAD_S + phase);
      slot.mat.uniforms['uT'].value = t * ARC_RAD_S + phase;
      slot.mesh.position.x = x;
      slot.mesh.position.z = z;
      slot.mesh.visible = true;
    },
    hideRest() {
      for (; used < MAX; used++) slots[used].mesh.visible = false;
      used = 0;
    },
  };
}
