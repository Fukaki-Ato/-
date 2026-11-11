/**
 * 局内后处理链（render 层，天穹雷脊整改第二波 B 路）：
 * RenderPass → 低强度 UnrealBloomPass（只捞自发光）→ 单 pass 画面 grade（暗角/颗粒/饱和度/可选轻微色差）
 * → OutputPass 色彩空间收尾。
 * 整改口径（用户避雷清单）：运动模糊不做全屏（前进向速度感由既有 speedLines 承担）、
 * 无强体积光、无厚雾；bloom 阈值 0.82 只让金币/金线/灯头/电弧这类自发光溢光，
 * 石灰岩建筑的漫反射亮度够不到阈值——柱子不泛光，画面不发灰。
 * 降级门（任一不满足 → composer=null，update/resize/dispose 全 no-op，调用方继续裸 renderer.render）：
 *   1) 平台适配层声明 wx 时永远降级：多 pass 填充率开销在小游戏机不划算（wx 路径零额外开销）；
 *   2) renderer.capabilities.isWebGL2（three r163+ 恒真，保留显式口径防运行时回退）；
 *   3) 后处理模块构造可用（选型理由见 try 块内注释）。
 */
import * as THREE from 'three';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** bloom 基线（强度/半径/亮度阈值）：threshold 在线性空间取 0.82，只有自发光材质捞得着 */
const BLOOM_STRENGTH = 0.32, BLOOM_RADIUS = 0.35, BLOOM_THRESHOLD = 0.82;
/** 冲刺联动曲线（boost=clamp(speedMul-1,0,1)）：暗角 0.28→0.42、饱和度 1.0→0.86、bloom 0.32→0.5 */
const VIGNETTE_BASE = 0.28, VIGNETTE_BOOST = 0.14;
const SATURATION_BASE = 1.0, SATURATION_BOOST = 0.14;
const BLOOM_BOOST = 0.18;
/** 联动过渡：每帧向目标值 lerp 0.08——冲刺渐入，结束侧即「回落平滑」 */
const BOOST_LERP = 0.08;
/** 胶片颗粒幅度（±半幅加色，确定性 hash，禁 Math.random） */
const GRAIN_AMT = 0.035;

/**
 * 画面 grade 的主题覆盖（M1 门控契约：theme.grade 字段经 runTheme 派生传入）。
 * 全部可选：不传/缺省字段=雨夜口径常量（上面那组），渲染结果与旧版逐字节一致。
 * coast 晴天档：暗角 0.12 / 颗粒 0 / bloom 0.22 / 联动减半（coast-audit ④ Phase 1 ①）。
 */
export interface GradeOverride {
  vignette?: number;
  grain?: number;
  bloom?: number;
  vignetteBoost?: number;
  saturationBoost?: number;
  bloomBoost?: number;
}

/**
 * grade 着色器：一个 pass 打包四件套（暗角/颗粒/饱和度/色差）。
 * 工作在线性空间（composer 中间缓冲是 HalfFloat 线性），色彩空间编码一律交给链尾 OutputPass。
 */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uFrame: { value: 0 }, // 确定性颗粒的帧计数（同一帧永远算出同一颗粒，回放可复现）
    uVignette: { value: VIGNETTE_BASE },
    uSaturation: { value: SATURATION_BASE },
    uGrain: { value: GRAIN_AMT }, // 主题可覆盖（coast 晴天档=0）：ShaderPass 克隆 uniform 后按局写入
    uAberration: { value: 0 }, // 轻微色差默认关（0 时走单次采样分支，零额外开销）
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uFrame;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uGrain;
    uniform float uAberration;
    varying vec2 vUv;
    float hash21(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    void main() {
      vec2 uv = vUv;
      vec2 fromC = uv - 0.5;
      float r2 = dot(fromC, fromC);
      // 轻微色差（默认关）：径向对 R/B 通道各偏移一点，模拟廉价镜头色散
      vec3 col;
      if (uAberration > 0.0) {
        vec2 shift = fromC * (uAberration * r2);
        col = vec3(
          texture2D(tDiffuse, uv + shift).r,
          texture2D(tDiffuse, uv).g,
          texture2D(tDiffuse, uv - shift).b
        );
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      // 暗角：屏幕边缘平滑压暗、中心不动（r2 二次衰减）
      col *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2);
      // 饱和度：按 Rec.709 亮度做去饱和插值
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      // 胶片颗粒：hash(帧计数, 屏幕坐标) 确定性抖动——无随机数状态、逐帧可复现
      float n = hash21(uv * 917.0 + vec2(uFrame * 0.717, uFrame * 0.913));
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface PostFx {
  /** null=降级（wx/非 WebGL2/构建失败），调用方回裸 renderer.render(scene, camera) */
  composer: EffectComposer | null;
  /** 每帧渲染前调用：推进颗粒帧计数 + 冲刺画面联动；降级时 no-op */
  update(dt: number, speedMul: number): void;
  /** 与 renderer 同口径（setPixelRatio×setSize）联动 resize；降级时 no-op */
  resize(w: number, h: number, dpr: number): void;
  /** 全量释放：逐 pass（bloom 的降采样 target / grade·output 的 material+quad）+ composer 双缓冲 */
  dispose(): void;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
  env: PlatformAdapter['env'],
  /** 主题 grade 覆盖（runTheme 从 theme.grade 派生；不传=雨夜口径常量） */
  grade?: GradeOverride,
): PostFx {
  // 主题覆盖解析：全部缺省回雨夜口径常量——不配置的主题行为与旧版逐字节一致
  const vBase = grade?.vignette ?? VIGNETTE_BASE;
  const vBoost = grade?.vignetteBoost ?? VIGNETTE_BOOST;
  const sBoost = grade?.saturationBoost ?? SATURATION_BOOST;
  const bBase = grade?.bloom ?? BLOOM_STRENGTH;
  const bBoost = grade?.bloomBoost ?? BLOOM_BOOST;
  const gAmt = grade?.grain ?? GRAIN_AMT;
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let gradePass: ShaderPass | null = null;
  // 平台判定来自 adapter.env，共享渲染层不探测宿主全局。
  let enabled = false;
  let viewSize = new THREE.Vector2(1, 1);
  try {
    enabled = env === 'web'
      // getSize 探针：EffectComposer 构造即依赖它；测试桩/残缺 renderer（headless:three）在此降级
      && typeof renderer.getSize === 'function'
      && renderer.capabilities.isWebGL2 === true;
    if (enabled) viewSize = renderer.getSize(new THREE.Vector2());
  } catch { enabled = false; }

  if (enabled) {
    try {
      // import 选型：顶层静态 import + 本构造 try/catch（而非动态 import）。理由：这四个 jsm
      // 附加模块是纯 three 数学/材质代码、零宿主全局副作用，wx 端打进包也安全；静态 import 让
      // 打包器正常内联、createPostFx 保持同步签名（调用方免 async 接线）；「模块可用」退化为
      // 构造期 try/catch，任何缺失/异常与上面两道门汇入同一条降级路径，兜底不弱于动态 import。
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(viewSize.x, viewSize.y), bBase, BLOOM_RADIUS, BLOOM_THRESHOLD,
      );
      composer.addPass(bloomPass);
      gradePass = new ShaderPass(GRADE_SHADER);
      gradePass.uniforms.uGrain.value = gAmt; // 主题覆盖的颗粒幅度（coast 晴天档=0）
      composer.addPass(gradePass);
      // OutputPass 必须放链尾（r152+ 色彩管理口径）：composer 中间缓冲全是线性 HalfFloat，
      // 没有它，最终写入 canvas 的仍是线性值——整体发灰/过暗（本链路最容易翻车的点）；
      // 它读取 renderer.toneMapping / outputColorSpace 做收尾，因此其后不能再挂任何 pass
      //（后续 pass 会把已编码 sRGB 当线性二次处理）。
      composer.addPass(new OutputPass());
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(viewSize.x, viewSize.y); // 内部乘 pixelRatio，与 renderer 尺寸口径一致
    } catch {
      // 构建失败（模块缺失/老版本缺 OutputPass/GPU 限制）：整链降级，不影响游戏可玩性
      composer = null; bloomPass = null; gradePass = null;
    }
  }

  let frame = 0;
  let vignette = vBase, saturation = SATURATION_BASE, bloomStrength = bBase;

  return {
    composer,
    // dt 当前未用（lerp 是 0.08/帧 的逐帧口径）；若改按时间归一（lerp/秒）再取用
    update(dt: number, speedMul: number) {
      if (!composer || !gradePass || !bloomPass) return;
      frame++;
      gradePass.uniforms.uFrame.value = frame;
      const boost = Math.min(1, Math.max(0, speedMul - 1)); // 雷霆冲刺等提速 buff 的表现强度
      vignette += (vBase + vBoost * boost - vignette) * BOOST_LERP;
      saturation += (SATURATION_BASE - sBoost * boost - saturation) * BOOST_LERP;
      bloomStrength += (bBase + bBoost * boost - bloomStrength) * BOOST_LERP;
      gradePass.uniforms.uVignette.value = vignette;
      gradePass.uniforms.uSaturation.value = saturation;
      bloomPass.strength = bloomStrength;
    },
    resize(w: number, h: number, dpr: number) {
      if (!composer) return;
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
    },
    dispose() {
      if (!composer) return;
      // composer.dispose 只释放自身双缓冲 target 与 copyPass，不遍历 passes——
      // bloom（多级降采样 target）/grade/output 各自的 material+quad 必须显式逐 pass 释放
      //（RenderPass 无资源，基类 dispose 是空实现）。
      for (const p of composer.passes) p.dispose();
      composer.dispose();
    },
  };
}
