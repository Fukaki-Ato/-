/**
 * 游戏主画布的 three WebGLRenderer 上下文属性（单源契约，审查 W-1）。
 * WX 端 canvasFactory 必须在 three 建 renderer 之前用同一份属性预创建 WebGL2 上下文
 * （为补 WebGL2RenderingContext 全局）——WebGL 规范规定首次 getContext 之后再次调用
 * 返回同一 context 并忽略新的 attributes，所以预创建时的值就是真机实际生效的值。
 * 改这里 = emptyScene/runnerScene 与 wx 预创建同步改；web 独有画布（uiShell 的
 * alpha:true、uiDemo）不在此契约内，各自显式声明。
 */
export const TR_GAME_CANVAS_ATTRIBUTES = { antialias: true } as const;
