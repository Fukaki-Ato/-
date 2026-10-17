/**
 * 角色登场动画面板（render 层，配置驱动，见 characters.json 的 intro 字段）。
 * 进局瞬间在相机正前方摆一块米数尺寸的面板播一段视频：视频期间整局画面冻结
 * （runnerScene 主循环把 tick 让给本模块），播完再解冻开跑；音效由音频导演在
 * start/end 两个时点让位与续播（本模块只报时点，不碰音频）。
 * 视频解码与 <video> 元素属宿主能力（packages/** 零 DOM 禁令），贴图与播放控制
 * 由 apps/* 经 setIntroSource 注入；没注入源（微信端、或注入失败）＝只响登场音效、不冻结。
 */
import * as THREE from 'three';
import type { IntroSpec } from '@tr/game/core/sim/character.js';

/** 宿主注入的视频面：texture 由 VideoTexture 持续刷新，play 播完或出错都 resolve */
export interface IntroSource {
  texture: THREE.Texture;
  play(): Promise<void>;
  stop(): void;
}

/** 视频卡死/事件丢失时的兜底解冻余量（秒）：宁可少看几帧，不能让游戏永远不动 */
const SLACK_S = 1.5;

const sources = new Map<string, IntroSource>();

/** 注册/撤下某角色的登场视频源（apps 侧在 boot 阶段调；传 null 即撤下） */
export function setIntroSource(charId: string, source: IntroSource | null): void {
  if (source) sources.set(charId, source);
  else sources.delete(charId);
}

export interface IntroPanel {
  /** 视频面板还在播：true 时 runnerScene 冻结 sim；音频-only 回退始终为 false */
  active(): boolean;
  /** 每帧推进视频兜底或无视频时的音频-only让位计时 */
  update(dt: number): void;
  dispose(): void;
}

export function createIntroPanel(
  scene: THREE.Scene, camera: THREE.PerspectiveCamera,
  spec: IntroSpec | undefined, charId: string, onStage: (stage: 'start' | 'end') => void,
): IntroPanel | null {
  if (!spec) return null;
  onStage('start'); // 登场音效压过 BGM：无论有没有视频面都先报一声
  const source = sources.get(charId);
  if (!source) {
    // WX/视频注入失败时只播音效，跑酷不冻结；intro.mp3 取自同一段源片，沿用其时长
    // 结束这次音频让位。计时由 runnerScene 每帧推进，dispose 会丢弃迟到的结束通知。
    let elapsed = 0, pending = true;
    const durationS = Number.isFinite(spec.durationS) ? Math.max(0, spec.durationS) : 0;
    return {
      active: () => false,
      update(dt: number) {
        if (!pending) return;
        elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (elapsed >= durationS) { pending = false; onStage('end'); }
      },
      dispose() { pending = false; },
    };
  }

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.widthM, spec.heightM),
    new THREE.MeshBasicMaterial({ map: source.texture, depthTest: false, depthWrite: false, fog: false }),
  );
  mesh.renderOrder = 100; // 压在赛道/角色/特效之上
  scene.add(mesh);

  // 面板每帧贴回相机位置与朝向：相机有跟随平滑与震屏，挂成相机子节点要动 scene 结构，
  // 直接跟随反而只占两行。
  const forward = new THREE.Vector3();
  const place = (): void => {
    camera.getWorldDirection(forward);
    mesh.position.copy(camera.position).addScaledVector(forward, spec.distanceM);
    mesh.quaternion.copy(camera.quaternion);
  };
  place(); // 创建当帧就贴好，避免第一帧面板还立在原点

  let alive = true, started = false, elapsed = 0;
  const finish = (): void => {
    if (!alive) return;
    alive = false;
    mesh.visible = false;
    source.stop();
    onStage('end'); // 交还渲染权并续播 BGM
  };

  return {
    active: () => alive,
    update(dt: number) {
      if (!alive) return;
      if (!started) {
        started = true;
        void source.play().then(finish, finish);
      }
      elapsed += dt;
      place();
      if (elapsed > spec.durationS + SLACK_S) finish();
    },
    dispose() {
      alive = false;
      scene.remove(mesh);
      mesh.geometry.dispose();
      // 只弃本局材质与几何：贴图归宿主注入方，下一局还要复用
      (mesh.material as THREE.Material).dispose();
      source.stop();
    },
  };
}
