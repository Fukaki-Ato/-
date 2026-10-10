/**
 * GLB 角色驱动（three 胶水）：把 assets/characters/*.glb 的蒙皮网格 + 动画 clip 接进 render 层。
 * 铁律：任何一步失败（无 extras.readBinary / 拉取失败 / 解析失败 / 核心 clip 缺失）都返回 null，
 * 由 avatarRig 保留程序化 runnerModel —— 程序化模型是唯一回退路径，绝不让资产问题炸到局内。
 * 姿态来源：glb 的 clip（飞/滑翔俯角、死亡翻倒都做在动画里），外层只摆位置与换道侧倾。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { FxState } from '@tr/game/core/effects/buffEngine.js';
import { STEP_DT } from '@tr/game/core/sim/simTypes.js';
import type { RunnerState } from '@tr/game/core/sim/simTypes.js';
import {
  CORE_CLIP_NAMES, PERF_CLIP_NAMES, createClipContext, isPerfClip, loopsForever, pickClip, readAnimLock,
  type ClipContext, type ClipName,
} from './animClips.js';
import { RUN_BONE_AMPS, amplifyClipSwing } from './animAmplify.js';

/** 换动作的交叉淡化时长（秒）：clip 间切换统一用它，turn→run 的回淡也是它。
 *  0.12→0.08：玩家高频换道时 Run 被 Turn 反复顶掉，更短的淡化让回切更利落，
 *  减少「跑—转身—跑」的拖尾感（Run 占比提升的另一半来源）。 */
export const XFADE = 0.08;
/** Run clip 一个完整步幅周期覆盖的里程（米）：timeScale = 速度/该值，步幅长度才不随速度失真 */
const STRIDE_M = 2.25;
/** timeScale 截断区间（原契约）：再快抽帧明显，再慢像在踩原地。
 *  TS_MAX 1.8→1.4（用户实机判定「播放太快、又不明显、很丑」后的回调档）：
 *  1.8× 时局内周期 0.417s = 步频 2.40Hz，配 2.2× 摆腿放大后脚峰值速度 11~12 m/s
 *  （与角色自身 12 m/s 前进速度同量级）——大幅摆腿撞上高步频，观感就是甩腿风车。
 *  1.4× → 周期 0.556s、步频 1.93Hz（接近 12 m/s 真实冲刺步频 ~2.2Hz），
 *  同档摆腿的脚峰值速度降到 7.4~7.9 m/s，动作从「快而糊」变成「大而清楚」。
 *  注意：把 TS_MAX 提到 ~5.3 让步频去追速度是错方向——那会到 7.1Hz、脚速 30 m/s，更没法看；
 *  真正对不上的是资产步幅（0.65m/周期 vs 需要 6.7m），只能等建模侧重导 sprint cycle。 */
const TS_MIN = 0.6, TS_MAX = 1.4;
/** 胸口估算高度（米）：Chest 骨骼缺失时的兜底（骨骼契约里 Chest 距脚底 1.05m） */
const CHEST_FALLBACK_Y = 1.05;
/** 落脚探测：脚世界高度低于「支撑面 + 该值」算进入触地区（资产实测脚最低点在支撑面上方
 *  0.137m、抬起 0.29~0.43m，0.24 落在区间中段，两谷之间）。
 *  注意单靠高度分不开「真触地」与「摆腿掠过」——该 clip 每周期有两个低谷（0.14m / 0.19m），
 *  阈值法会把浅谷也数成一次落地（尘土密一倍、步频假快）。真正的区分特征是触地期间脚的
 *  水平位移方向：向前迈=落点，向后收=蹬地后收腿。见 tests/renderFootDust.test.mjs。 */
const FOOT_ENTER_Y = 0.24;
/** 尘土生成高度相对支撑面的抬升（米）：贴地但不穿进地面 */
const DUST_LIFT_Y = 0.03;

export interface AnimAvatar {
  /** gltf.scene（脚底在原点、面朝 -Z；外层按帧写 position 与 rotation.z） */
  group: THREE.Group;
  /** buff 挂件骨骼锚点（VFX 挂载用）；骨骼缺失返回 null */
  getBone(name: string): THREE.Object3D | null;
  /** 胸口相对脚底的高度（米）：优先 Chest 骨骼（组内局部高度），缺骨骼按 1.05*scale 兜底 */
  get chestY(): number;
  /** @param dt 帧间隔（秒）；@param s @param fx 只读的 sim 状态与原语视图 */
  update(dt: number, s: RunnerState, fx: FxState): void;
  /** 落脚事件订阅：Run（贴地前进）期间脚掌每次离开触地区时上报世界坐标，render 层放尘土。
   *  传 null 退订。为什么需要：脚行程被腿长锁死在 0.65m/周期，而 12 m/s 下一个周期身体前进
   *  6.7m——脚相对地面 90% 在滑，没有落地反馈观众读不出「在跑」（tests/renderFootDust）。 */
  setFootfallHandler(fn: ((x: number, y: number, z: number) => void) | null): void;
  dispose(): void;
}

/**
 * 异步载入并装配 GLB 角色。
 * @param adapter 平台适配（extras.readBinary 不可用 → 直接返回 null，保留程序化模型）
 * @param prefabPath characters.json 的 model.prefab（web 壳同路径由 vite dev/build 服务）
 * @param scale characters.json 的 model.scale
 * @param isDead 装配完成前的存活探测（场景已销毁 → 返回 true）：GLB 是异步的，重开一局/
 *   回菜单时上一局的加载可能才回来——晚到的 build() 会把 __trAnim 全局探针覆盖成不再
 *   update 的死实例（QA 采样读到 time=0/ts=0 的冻结快照，曾被误判成「动画卡死」）。
 */
export function createAnimAvatar(
  adapter: PlatformAdapter, prefabPath: string, scale = 1, urlParams?: URLSearchParams | null,
  isDead?: () => boolean,
): Promise<AnimAvatar | null> {
  if (!adapter.extras) {
    console.warn('[avatarRig] 平台无 extras（v2 契约 D7），跳过 GLB 角色（保留程序化模型）:', prefabPath);
    return Promise.resolve(null);
  }
  return adapter.extras.readBinary(prefabPath)
    .then(buf => new Promise<AnimAvatar | null>(resolve => {
      new GLTFLoader().parse(buf, '', gltf => {
        try {
          resolve(build(gltf.scene, gltf.animations, scale, urlParams, isDead));
        } catch (e) {
          console.warn('[avatarRig] GLB 装配失败（回退程序化模型）', prefabPath, e);
          resolve(null);
        }
      }, err => {
        console.warn('[avatarRig] GLB 解析失败（回退程序化模型）', prefabPath, err);
        resolve(null);
      });
    }))
    .catch(e => {
      console.warn('[avatarRig] 角色资源读取失败（回退程序化模型）', prefabPath, String(e));
      return null;
    });
}

function build(
  root: THREE.Group, clips: THREE.AnimationClip[], scale: number, urlParams?: URLSearchParams | null,
  isDead?: () => boolean,
): AnimAvatar | null {
  // 核心 clip（10 个）缺一即判资产不合格：半套动作比没有更糟（会静默少播受击/死亡等关键反馈）。
  // 表演 clip（Laugh/Basketball）按存在性装配：奶龙带 Laugh、篮球小子带 Basketball，
  // 两个资产的表演 clip 不同源，缺一个不判失败——pickClip 命中缺失的由 play() 回落 Run。
  const actions = {} as Record<ClipName, THREE.AnimationAction | null>;
  const mixer = new THREE.AnimationMixer(root);
  for (const name of CORE_CLIP_NAMES) {
    const clip = clips.find(c => c.name === name);
    if (!clip) {
      console.warn('[avatarRig] GLB 缺少核心动画 clip:', name);
      mixer.stopAllAction();
      return null;
    }
    actions[name] = mixer.clipAction(clip);
  }
  for (const name of PERF_CLIP_NAMES) {
    const clip = clips.find(c => c.name === name);
    actions[name] = clip ? mixer.clipAction(clip) : null;
  }
  // 两个表演 clip 全缺 = 契约外资产（既不是奶龙也不是篮球小子），判不合格
  if (!actions.Laugh && !actions.Basketball) {
    console.warn('[avatarRig] GLB 无表演 clip（Laugh/Basketball 均缺），判资产不合格');
    mixer.stopAllAction();
    return null;
  }
  // Run 步态放大（render 层解释，资产文件零改动）：v8 Run 是慢跑规格（脚行程 ~0.45m/周期），
  // baseSpeed 12 m/s 下一步覆盖 2.5m、timeScale 又被 TS_MAX 钳住，原样播就是「原地倒腾短腿+滑步」。
  // 只放大 Run 的四肢摆动；Idle/Jump/Land/Death… 一律逐字节不动，循环口径不受影响。
  // RUN_BONE_AMPS 的十个骨名（LegUpperL/R…ArmLowerL/R）奶龙与篮球小子都实测命中，放大同款生效。
  const runAct = mixer.clipAction(amplifyClipSwing(clips.find(c => c.name === 'Run')!, RUN_BONE_AMPS));
  actions.Run = runAct;

  root.scale.setScalar(scale);
  root.traverse(o => { o.frustumCulled = false; }); // 蒙皮包围盒不可靠，关剔除防人物突然消失
  const bones = new Map<string, THREE.Object3D>();
  root.traverse(o => { if (o.name && !bones.has(o.name)) bones.set(o.name, o); });

  const ctx: ClipContext = createClipContext();
  let current: ClipName | null = null;
  let tsSmooth = 1;                  // timeScale 平滑值，防帧位移抖动让跑步抽风
  let ticks = 0;                     // update() 累计次数（探针 __trAnim.ticks：死实例停止增长）
  /** 落脚探测状态：两只脚各自「是否正踩在触地区里」与进入触地时的水平位置（判迈步方向） */
  let footfall: ((x: number, y: number, z: number) => void) | null = null;
  const inContact = { L: false, R: false };
  const entryZ = { L: 0, R: 0 };
  /** 表演 clip 锁播累计秒与当前 clip：满一期交还状态机（LoopRepeat 的 time 会归零，不能靠 time 判） */
  let perfLockT = 0;
  let perfLockClip: ClipName | null = null;
  /** QA 探针（?debug/?test 时挂 window.__trAnim）：clip 切换时间线 + 正在播的 action 快照 */
  const clipLog: Array<{ clip: ClipName; loop: boolean; restart: boolean; t: number }> = [];
  /** QA 锁 ?anim=（build 时读入；一次性 clip 播完自动置 null，见 update 里的解锁块）。
   *  为什么必须自动解锁：锁是 URL 参数，会跨刷新/书签持久，而一次性 clip（Basketball 2s /
   *  Death 1.1s）LoopOnce + clampWhenFinished 播完就永久定在末帧——用户实测「一开始是好的，
   *  之后跑步没动作、下蹲也没动作」，就是验收地址 ?anim=Basketball 在 2s 后把角色定死。 */
  let lock = readAnimLock(urlParams);
  const chestV = new THREE.Vector3();
  const footV = new THREE.Vector3();

  /**
   * Idle 的双实例交替：Idle 首末姿差 110°（建模侧实测，不可直接循环），按契约 LoopOnce 播一次，
   * 播完后用同 clip 的第二个 action 做 0.12s 交叉淡化交回自身首帧，抹掉硬跳。
   */
  const idleClip = clips.find(c => c.name === 'Idle');
  let idleAct = actions.Idle as THREE.AnimationAction; // CORE 必存在（上面缺一即 return null）
  let idleSpare: THREE.AnimationAction | null = null;
  function idleCrossfadeToHead() {
    if (!idleClip) return;
    const spare = idleSpare ?? mixer.clipAction(idleClip);
    spare.setLoop(THREE.LoopOnce, Infinity);
    spare.clampWhenFinished = true;
    idleAct.fadeOut(XFADE);
    spare.reset().fadeIn(XFADE).play();
    idleSpare = idleAct;      // 旧实例淡出到权重 0 后自动停摆，可回收复用
    idleAct = spare;
    actions.Idle = idleAct;   // 后续 play('Idle') 与「播完」判定都指向正在播的那个实例
  }

  /** 切 clip：同 clip 不重播；restart（死亡进场）强制从 0；其余走 0.12s 交叉淡化。
   *  表演 clip 缺失回落 Run：pickClip 是纯函数、不认识资产有哪些 clip（篮球小子没有 Laugh、
   *  奶龙没有 Basketball），QA 锁 ?anim=Laugh 锁到不存在的 clip 时也走这里，不静默不播。 */
  function play(name: ClipName, loop: boolean, restart: boolean) {
    let clip = name;
    if (!actions[clip]) { clip = 'Run'; loop = loopsForever('Run'); restart = false; }
    const next = actions[clip] as THREE.AnimationAction;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop; // 播一次的动作保持末帧（Death 倒地定格、Basketball 投篮定势）
    if (current === clip && !restart) return;
    if (current && current !== clip) actions[current]!.fadeOut(XFADE);
    next.reset();
    if (current !== clip) next.fadeIn(XFADE);
    next.play();
    current = clip;
    clipLog.push({ clip, loop, restart: restart === true, t: +performance.now().toFixed(1) });
    if (clipLog.length > 200) clipLog.splice(0, clipLog.length - 200); // 有界，防长局内存涨
  }
  // 装载完成到首帧 update 之间是待机，不是 T-pose；Idle 按契约只播一次（播完交回首帧）
  play('Idle', loopsForever('Idle'), false);

  // 迟到装配防护（见 createAnimAvatar 的 isDead 注释）：场景已销毁就整体放弃，
  // 绝不把 __trAnim 探针/几何体留给一个永远不会再 update 的实例。
  if (isDead?.()) {
    mixer.stopAllAction();
    return null;
  }

  // QA 探针（?debug/?test）：与 __trRun 同生命周期，只读快照，不影响播放
  if (urlParams?.has('debug') || urlParams?.has('test')) {
    const footWorld = (name: string) => {
      const b = bones.get(name);
      if (!b) return null;
      const p = b.getWorldPosition(footV);
      return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
    };
    (globalThis as Record<string, unknown>).__trAnim = {
      get current() { return current; },
      /** update() 累计调用次数：>0 且持续增长=探针所属实例活着（死实例的 ticks 停止增长） */
      get ticks() { return ticks; },
      /** 当前生效的 QA 锁（自动解锁后为 null；测试面板据此显示提示） */
      get lock() { return lock; },
      get act() {
        if (!current) return null;
        const a = actions[current];
        if (!a) return null;
        return { clip: current, time: +a.time.toFixed(2), dur: +a.getClip().duration.toFixed(2), weight: +a.getEffectiveWeight().toFixed(2), ts: +a.getEffectiveTimeScale().toFixed(2) };
      },
      /** 双脚世界坐标：验证 Run 步态放大（animAmplify）在局内的实际幅度 */
      get feet() { return { L: footWorld('FootL'), R: footWorld('FootR') }; },
      get log() { return clipLog; },
    };
  }

  return {
    group: root,
    getBone(name) { return bones.get(name) ?? null; },
    get chestY() {
      const chest = bones.get('Chest');
      // 转成组内局部高度：avatarRig 还要再叠加 s.y，这里不能混进 group 的世界位移
      return chest ? root.worldToLocal(chest.getWorldPosition(chestV)).y : CHEST_FALLBACK_Y * scale;
    },
    update(dt, s, fx) {
      ticks++;
      const pick = pickClip(s, fx, ctx, dt, lock);
      play(pick.clip, pick.loop, pick.restart === true);
      mixer.update(dt);
      // 一次性 clip 播完的收尾：只有 Idle 交回自身首帧（首末差 110°，用交叉淡化抹掉硬跳）；
      // Jump/Hit/Land/TurnLeft/TurnRight/Death 一律保持末帧，等状态切换时自然淡出
      const act = actions[pick.clip];
      if (!pick.loop && pick.clip === 'Idle' && act && act.time >= act.getClip().duration - 1e-4) {
        idleCrossfadeToHead();
      }
      // QA 锁的一次性 clip 播完自动解锁：放完投篮/死亡演示就交还状态机，角色继续跑/滑。
      // 循环锁（Run/Slide/Fly/Laugh）不受影响，持续锁播；死亡定格场景由状态机自己接管
      // （仍 !alive → 继续返回 Death，观感不变）。
      if (lock && !pick.loop && act && act.time >= act.getClip().duration - 1e-4) lock = null;
      // 表演 clip 锁播满一期同样交还：?anim=Laugh 播 2s 欢呼后自动回跑（状态机永不播表演 clip）
      if (lock && isPerfClip(pick.clip)) {
        if (perfLockClip !== pick.clip) { perfLockClip = pick.clip; perfLockT = 0; }
        perfLockT += dt;
        const pa = actions[pick.clip];
        if (pa && perfLockT >= pa.getClip().duration) { lock = null; perfLockClip = null; perfLockT = 0; }
      } else if (perfLockClip) { perfLockClip = null; perfLockT = 0; }
      // Run 步频补偿：用 sim 固定步长的精确速度（distance/prevDistance 是同一步的前后值，
      // STEP_DT 归一），不用「帧位移/dt」估——渲染帧率高于 sim 步频时（120Hz/144Hz 屏）
      // 没有 step 的渲染帧会被估成 0 速，timeScale 在 TS_MIN↔TS_MAX 之间振荡，步频一快一慢。
      // 只压 Run：其它 clip（Jump/Land/Turn…）是定长表演，跟着抽帧会看不出在演什么。
      const speed = (s.distance - s.prevDistance) / STEP_DT;
      const target = Math.min(TS_MAX, Math.max(TS_MIN, speed / STRIDE_M));
      tsSmooth += (target - tsSmooth) * Math.min(1, dt * 8);
      runAct.setEffectiveTimeScale(tsSmooth);
      // 落脚探测：只在 Run（贴地且前进）时做。脚世界高度低于 ENTER 记一次触地并记住进入时的
      // 水平位置，向上穿出时若触地期间脚向前迈才算落点（向后=蹬地后收腿，跳过）。
      // y 用支撑面高度（s.y，车顶/坡道也正确），不等同于脚骨高度；x/z 取本帧脚世界坐标。
      if (footfall && pick.clip === 'Run') {
        for (const [bone, key] of [['FootL', 'L'], ['FootR', 'R']] as const) {
          const b = bones.get(bone);
          if (!b) continue;
          const p = b.getWorldPosition(footV);
          if (p.y < s.y + FOOT_ENTER_Y) {
            if (!inContact[key]) { inContact[key] = true; entryZ[key] = p.z; }
          } else if (inContact[key]) {
            inContact[key] = false;
            if (p.z - entryZ[key] > 0) footfall(p.x, s.y + DUST_LIFT_Y, p.z);
          }
        }
      } else {
        inContact.L = false; inContact.R = false; // 非 Run 帧清记忆，回来时不补发过期蹬地
      }
    },
    setFootfallHandler(fn) { footfall = fn; },
    dispose() {
      mixer.stopAllAction();
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => mat.dispose());
      });
    },
  };
}
