/**
 * 跑酷局的「主题派生 + 输入接线」（自 runnerScene.ts 拆出：300 行红线机械重构，纯剪切搬家，零行为变化）：
 *   deriveRunStage  runner 参数解析（laneWidth / glideFallMps）、themes.json 主题查找，
 *                   sky/fog/vfxTint/groundColor/lighting/scenery 推导；两盏灯与闪白插值色在此一并建好；
 *   wireRunInput    adapter.onInput（doubleTap/swipe/key）→ sim.applyAction 的映射，返回退订函数。
 * 只做纯派生与订阅接线，不碰 Three 场景图（scene.add 与逐帧写回仍归 runnerScene，保持原顺序）。
 */
import * as THREE from 'three';
import type { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { InputEvent, PlatformAdapter, Unsubscribe } from '@tr/framework/platform/platformAdapter.js';
import { FLASH_TINT } from './lightning.js';
import type { EnvSpec } from './stormspire/env.js';

/** postfx 画面 grade 的主题覆盖（M1 门控契约：theme.grade 字段，缺省=雨夜口径，postfx.ts 同名常量） */
export interface GradeSpec {
  vignette: number;
  grain: number;
  bloom: number;
  vignetteBoost: number;
  saturationBoost: number;
  bloomBoost: number;
}

/** 主题派生结果：runnerScene 解构接回，字段名与拆分前的局部变量一一对应（最小 diff）。 */
export interface RunStage {
  /** 跑道车道宽（runner.laneWidth，缺省 2.2） */
  laneWidth: number;
  /** 滑翔倒计时换算速率：core 以 heightM/glideS 匀速下降（movement.ts），HUD 显示真实剩余秒数用 */
  glideFallMps: number;
  sky: { baseColor: string; flashColor: string };
  fogColor: string;
  /** vfxTint：速度线等待效的主题色调 */
  tint: string;
  groundColor: string;
  /** lighting 覆盖派生的两盏灯（scene.add 顺序与逐帧强度写回仍在 runnerScene） */
  hemi: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  /** 无 lighting 覆盖时的基准光强（renderSim 闪白增益叠加用） */
  HEMI_BASE: number;
  KEY_BASE: number;
  /** 闪白（雷电）：背景/雾色的基色与目标色缓存，逐帧按闪白强度插值 */
  skyBase: THREE.Color;
  fogBase: THREE.Color;
  flashTint: THREE.Color;
  /** 环境闪电间隔（theme.sky.flashEveryS=[min,max] 秒区间随机；缺省 [9999,9999]=关闭） */
  flashGap(): number;
  /** scenery（themes.json）：track/obstacle 层选景 + 雷脊 IBL 环境贴图的门控字段 */
  scenery: string;
  /** postfx 画面 grade（theme.grade 覆盖；缺省=雨夜口径） */
  grade: GradeSpec;
  /** theme.features.wetRoad：湿路系统总闸（车道线倒影 + 路面水洼 roughnessMap），trackVisuals 消费 */
  wetRoad: boolean;
  /** theme.env：主题 IBL 环境贴图配色（null=该主题不挂 envMap） */
  env: EnvSpec | null;
}

export function deriveRunStage(content: GameContent, opts?: { themeId?: string }): RunStage {
  const runner = (content.game.params.runner ?? {}) as Record<string, number>;
  const laneWidth = runner.laneWidth ?? 2.2;
  /** 滑翔倒计时换算：core 以 heightM/glideS 匀速下降（movement.ts），HUD 显示与 s.gliding 一致的真实剩余秒数 */
  const flight = (content.game.params.flight ?? {}) as Record<string, number>;
  const glideFallMps = (flight.heightM ?? 4.6) / (flight.glideS ?? 1.8);
  // 默认主题 = 大厅「场景切换」所选（storage 经 mainFlow 注入）；缺省回首个 live 条目（不硬编码 id，避免删主题时漏改）
  const themeItems = (content.themes.items ?? []) as Record<string, unknown>[];
  const theme = (opts?.themeId ? themeItems.find(t => t['id'] === opts.themeId) : undefined)
    ?? themeItems.find(t => t['status'] === 'live') ?? themeItems[0];
  const sky = (theme?.sky ?? { baseColor: '#8ED0F2', flashColor: '#FFF3C4' }) as { baseColor: string; flashColor: string };
  const fogColor = ((theme?.fog as Record<string, unknown> | undefined)?.color as string | undefined) ?? sky.baseColor;
  const tint = (theme?.vfxTint as string | undefined) ?? '#FFD98A';
  const groundColor = (theme?.groundColor as string | undefined) ?? '#E3CFA4';
  // 白天海滨的光：半球光天空浅蓝/地面暖沙，主光偏暖阳色（夜景那套冷光会让晴天发灰）。
  // 主题可用 lighting 字段覆盖整套光（天穹雷脊的雷暴冷光），缺省回这套海滨口径。
  const lig = (theme?.['lighting'] ?? {}) as Record<string, string | number | undefined>;
  const HEMI_BASE = typeof lig.hemiIntensity === 'number' ? lig.hemiIntensity : 1.15;
  const hemi = new THREE.HemisphereLight(
    new THREE.Color((lig.hemiSky as string | undefined) ?? '#bfe3ff'),
    new THREE.Color((lig.hemiGround as string | undefined) ?? '#d8c39a'),
    HEMI_BASE,
  );
  const KEY_BASE = typeof lig.keyIntensity === 'number' ? lig.keyIntensity : 1.9;
  const keyLight = new THREE.DirectionalLight(new THREE.Color((lig.key as string | undefined) ?? '#fff2d0'), KEY_BASE);
  /** 闪白（雷电）：背景/雾色的基色与目标色缓存，逐帧按闪白强度插值。
   *  flashTint 按 scenery 分支（titan-brief §10.0-8）：泰坦的 sky.flashColor #FFE9B8 是「护栏/闪白语义」
   *  的亡火暖金（ revive 闪、护栏），不是雷暴冷白——titan-brief §10.0-8 矛盾清单的裁决。 */
  const skyBase = new THREE.Color(sky.baseColor), fogBase = new THREE.Color(fogColor);
  /** scenery（themes.json）：track/obstacle 层选景 + 雷脊 IBL 环境贴图的门控字段 */
  const scenery = (theme?.['scenery'] as string | undefined) ?? 'seaside';
  const flashTint = new THREE.Color(scenery === 'titan' ? '#FFE9B8' : FLASH_TINT);
  /** 环境闪电（theme.sky.flashEveryS=[min,max] 秒区间随机；缺省 [9999,9999]=关闭）：
   *  渲染层定时器，落点在前方 14~34m 随机车道，与玩法判定无关（lightning 同款渲染层随机口径）。 */
  const flashEvery = ((theme?.sky as Record<string, unknown> | undefined)?.['flashEveryS'] as number[] | undefined) ?? [9999, 9999];
  const flashGap = () => Math.max(1, flashEvery[0] ?? 9999) + Math.random() * Math.max(0, (flashEvery[1] ?? 9999) - (flashEvery[0] ?? 9999));
  // M1 门控契约三件：grade（postfx 画面参数）/ features.wetRoad（湿路总闸）/ env（IBL 配色）。
  // 缺省值=雨夜口径常量（postfx.ts 同名）：不配置的主题渲染结果与旧版逐字节一致。
  const g = (theme?.['grade'] ?? {}) as Record<string, number | undefined>;
  const grade: GradeSpec = {
    vignette: g.vignette ?? 0.28,
    grain: g.grain ?? 0.035,
    bloom: g.bloom ?? 0.32,
    vignetteBoost: g.vignetteBoost ?? 0.14,
    saturationBoost: g.saturationBoost ?? 0.14,
    bloomBoost: g.bloomBoost ?? 0.18,
  };
  const features = (theme?.['features'] ?? {}) as Record<string, unknown>;
  const wetRoad = features.wetRoad === true;
  const envRaw = (theme?.['env'] ?? null) as Record<string, string> | null;
  const env = envRaw && envRaw.sky && envRaw.glow && envRaw.ground
    ? { sky: envRaw.sky, glow: envRaw.glow, ground: envRaw.ground }
    : null;
  return {
    laneWidth, glideFallMps, sky, fogColor, tint, groundColor,
    hemi, keyLight, HEMI_BASE, KEY_BASE, skyBase, fogBase, flashTint, flashGap, scenery,
    grade, wetRoad, env,
  };
}

/** 输入 → sim（v2：手势与键盘合并为单个 onInput 订阅，§7.8）；返回退订函数进 dispose。 */
export function wireRunInput(adapter: PlatformAdapter, sim: RunnerSim): Unsubscribe {
  return adapter.onInput((e: InputEvent) => {
    if (e.type === 'doubleTap') { sim.applyAction('skill'); return; } // 主动技能：双击屏幕（skills.json trigger=double_tap）
    if (e.type === 'swipe') {
      if (e.dir === 'left') sim.applyAction('laneL');
      else if (e.dir === 'right') sim.applyAction('laneR');
      else if (e.dir === 'up') sim.applyAction('jump');
      else if (e.dir === 'down') sim.applyAction('slide');
      return;
    }
    if (e.type !== 'key' || e.phase !== 'down') return; // v1 隐式仅 down（§7.8）；up 留给 UI 按压态
    const code = e.code;
    if (code === 'ArrowLeft') sim.applyAction('laneL');
    else if (code === 'ArrowRight') sim.applyAction('laneR');
    else if (code === 'ArrowUp' || code === 'Space') sim.applyAction('jump');
    else if (code === 'ArrowDown') sim.applyAction('slide');
    else if (code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight') sim.applyAction('skill');
  });
}
