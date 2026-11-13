/**
 * 天穹雷脊 · 渲染层 world-bend（「假弯道」：平缓大曲率横弯 + 微起伏，第三波 A 路）。
 *
 * 原理：sim 仍是 lane+worldZ 直线模型（回放/golden/排行榜依赖确定性，本文件绝不读 sim、
 * 不反写任何玩法状态）；弯道纯粹是顶点着色器里的显示变形——每个顶点按「玩家前方纵深」
 * 做 k² 二次缓入的横/纵偏移，路面在 100m 处整体偏移 uBend 米，起弯纵深内恒直。
 * 弯是「渲染空间里的静态弯带」：道具/金币/障碍按当前 z 取偏移，顺着弯带流动不脱道；
 * 弯幅由 setWorldBend 以 ~90s 呼吸周期缓慢摆动（永不急转），引导线因此有呼吸感。
 *
 * 安全边界（判定区视觉恒直）：uBendAhead 恒 18m，k 在 18m 内为 0 且 k² 在起弯处切线连续
 * （无折点），判定区远端 ~20m 处按全幅 7m 折算偏差 < 5mm——玩家近旁的所见即判定。
 *
 * 注入点设计（three 0.187.0，本仓首次 shader 注入）：替换 `#include <project_vertex>`。
 * 原 chunk（ShaderChunk/project_vertex.glsl.js）关键行：
 *   vec4 mvPosition = vec4( transformed, 1.0 );
 *   #ifdef USE_INSTANCING
 *     mvPosition = instanceMatrix * mvPosition;      // instanceMatrix 先于 modelViewMatrix 乘入
 *   #endif
 *   mvPosition = modelViewMatrix * mvPosition;
 *   gl_Position = projectionMatrix * mvPosition;
 * 「chunk 之后拿 view 空间位置反推世界」需逐顶点求 viewMatrix 逆；这里选「世界步注入」：
 * 按 worldpos_vertex.glsl.js 的同款乘序（batchingMatrix → instanceMatrix → modelMatrix）
 * 直接重组世界坐标——InstancedMesh（本场景全部侧景/金币/障碍）天然正确，且弯后的
 * mvPosition 原样交回下游 chunk：fog_vertex 的 vFogDepth = -mvPosition.z 自动按弯后位置
 * 算雾（雾贴住弯道，无折中），clipping_planes / vViewPosition 同理。
 *
 * 已核对的折中（偏差 ≤7m@100m 且随几何整体平移，视觉自洽）：
 *   - worldpos_vertex / shadowmap_vertex 仍按未弯世界坐标生成 shadowCoord → 影子跟着几何
 *     一起被弯走（caster/receiver 同用未弯坐标，查询自洽）；
 *   - envmap 反射按未弯位置采样 → 远处反射有不可感偏差；
 *   - 只动顶点不动法线 → 远处小倾角的着色误差可忽略。
 *
 * 口径：uBendX / uBendY = 「玩家前方 100m 处」路面相对直线的横/纵向偏移米数（k 在 100m
 * 处到 1，更远 clamp 保持该值），uBendAhead = 起弯纵深（恒 18m）。玩家渲染位形 z≈0 恒定
 * （金币/障碍的 z = dist - worldZ，玩家脚下即 0），前方即 -z。
 */
import * as THREE from 'three';

/** 100m 处横向偏移（米，+x = 向右弯）：仅 stormspireProps.update 经 setWorldBend 驱动 */
export const uBendX: THREE.IUniform<number> = { value: 0 };
/** 100m 处纵向偏移（米，+y = 上坡） */
export const uBendY: THREE.IUniform<number> = { value: 0 };
/** 起弯纵深（米）：恒 18——玩家前方 18m 内偏移恒 0（k=0），是「视觉≠判定」穿帮的安全边界 */
export const uBendAhead: THREE.IUniform<number> = { value: 18 };

/** k 的归一跨度：全幅口径 100m − 起弯 18m ⇒ 前方 100m 处 k 恰好到 1 */
const BEND_SPAN = 82;

/** uniform 声明要落在全局作用域：拼在 shader 体最前（three 的 prefix 在其之前注入） */
const BEND_UNIFORMS_GLSL = 'uniform float uBendX;\nuniform float uBendY;\nuniform float uBendAhead;\n';

/** 替换 `#include <project_vertex>` 的片段（功能 12 行；sp 前缀防撞 three 内部变量名） */
const PROJECT_VERTEX_BEND = /* glsl */`
	vec4 mvPosition = vec4( transformed, 1.0 );
	vec4 spWorld = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		spWorld = batchingMatrix * spWorld;
	#endif
	#ifdef USE_INSTANCING
		spWorld = instanceMatrix * spWorld;
	#endif
	spWorld = modelMatrix * spWorld;
	float spK = clamp(( -spWorld.z - uBendAhead ) / ${BEND_SPAN.toFixed(1)}, 0.0, 1.0);
	spWorld.x += uBendX * spK * spK;
	spWorld.y += uBendY * spK * spK;
	mvPosition = viewMatrix * spWorld;
	gl_Position = projectionMatrix * mvPosition;
`;

/** 已注入登记（幂等：共享工厂/兜底 traverse/显式分支可能对同一材质重复调用） */
const bent = new WeakSet<THREE.Material>();

/**
 * 给材质挂 world-bend 顶点变形（本仓首次 shader 注入，刻意保守）：只改顶点位置，
 * 不碰 normal/uv/雾参数；Basic / Lambert / Standard 的 vertex 模板都在同一位置 include
 * project_vertex（meshbasic.glsl.js:34 / meshlambert.glsl.js:39 / meshphysical.glsl.js:44，
 * 且 begin_vertex 都在其前 ⇒ transformed 已含蒙皮/形变终值），同一片段三种材质通用。
 * 注入即清零：材质一律按场景现建，新场景首个注入材质把上一局残留弯道量归零，保证
 * 「仅 stormspire 活跃时 uniforms 非零」不依赖场景销毁顺序（stormspire 首帧 update 立即写回）。
 */
export function applyWorldBend(mat: THREE.Material): void {
  if (bent.has(mat)) return;
  bent.add(mat);
  uBendX.value = 0;
  uBendY.value = 0;
  // 程序缓存分桶：Material.customProgramCacheKey 缺省退化为 onBeforeCompile.toString()，
  // 显式给固定 key 钉死「注入材质 ≠ 未注入材质」，不依赖 toString 在压缩后仍稳定
  mat.customProgramCacheKey = () => 'tr-world-bend-1';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uBendX'] = uBendX;
    shader.uniforms['uBendY'] = uBendY;
    shader.uniforms['uBendAhead'] = uBendAhead;
    shader.vertexShader = BEND_UNIFORMS_GLSL
      + shader.vertexShader.replace('#include <project_vertex>', PROJECT_VERTEX_BEND);
  };
}

/**
 * 每帧驱动（仅 stormspireProps.update 调用，其它主题从不调 ⇒ 恒等变换）：双正弦呼吸，
 * 横向周期 ≈ 88.5s、纵向 ≈ 118.6s，角速度恒定 ⇒ 永不急转。零每帧分配：只写 uniform.value。
 */
export function setWorldBend(t: number): void {
  uBendX.value = 7 * Math.sin(t * 0.071);
  uBendY.value = 4 * Math.sin(t * 0.053 + 2);
}

/** 泰坦呼吸低层写手（仅 titanProps.update 驱动；其它主题恒零不调用）：远场呼吸经 uBendY 的 k² 权重
 *  生效——远方起伏可见、近场 18m 恒平（安全边界同 setWorldBend）；amp=1 基线（颅首醒态总装传 ~1.5，
 *  呼吸振幅 +50%）；周期 10s（titan-brief §1.2）。100m 处全幅 2.5m。 */
export function setTitanBreath(t: number, amp: number): void {
  uBendX.value = 0;
  uBendY.value = 2.5 * amp * Math.sin((Math.PI * 2 * t) / 10);
}

/** 熔炉假弯道低层写手（仅 forgeheartProps.update 驱动；其它主题恒零不调用）：
 *  uBendX = 4·sin(t·0.06)（~105s 平缓横弯）、uBendY = 3·tideLevel（弯道纵向起伏跟着岩浆潮位走——
 *  forgeheart-brief §13-6；tideLevel 由调用方传 level(distAcc)）。近场 18m 恒平边界同 setWorldBend。 */
export function setForgeheartBend(t: number, tideLevel: number): void {
  uBendX.value = 4 * Math.sin(t * 0.06);
  uBendY.value = 3 * tideLevel;
}

/** 失重图书馆假弯道低层写手（仅 libraryProps.update 驱动；其它主题恒零不调用）：
 *  uBendX = 4·sin(t·0.0655)（周期 ≈96s 平缓横弯）、uBendY = 2.5·sin(t·0.0491 + 1.7)（周期 ≈128s 纵向漂移，
 *  与横弯相位错开 1.7）——library-brief §11.1-8：100m 处横 4m / 纵 2.5m，书城回廊的缓慢漂移感。
 *  近场 18m 恒平边界同 setWorldBend。 */
export function setLibraryBend(t: number): void {
  uBendX.value = 4 * Math.sin(t * 0.0655);
  uBendY.value = 2.5 * Math.sin(t * 0.0491 + 1.7);
}
