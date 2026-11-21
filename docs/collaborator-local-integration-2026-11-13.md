# 协作者分支与本地在制工作整合

## 范围与落点

本次以本地固定提交审核和整合；Git fetch 与 GitHub API 均遇到 TLS/EOF，远程是否新增提交尚未核实。

| 来源 | 固定版本 / 处理 |
| --- | --- |
| 本地 `main` | `26c59cc`，保持原指针 |
| 已缓存 `origin/main` | `a331f03`，通过后续候选完整继承 |
| mostny 场景线 / PR #55 | `8cb37d6`，四新场景、特殊玩法，继承已有整合修正并复核 |
| kljfg 道具线 / PR #56 | `69e2c2a`，十件 GLB、地面光圈，继承并复核 |
| 既有整合成果 | `38d5116`，包括主题同轨修正、设置页档案入口、十角色免费开放 |
| 后续优化成果 | `8160d0c`，保留 B01–B05 本机事务、回放快照、构建身份及新开局版本匹配 |
| 原目录未提交工作 | `backup/local-wip-integration-20261113-gRBgr7` = `2bf5c186`，原 `ca6396a` 上 301 个实际文件的本地快照 |

整合分支：`integration/collaborators-local-20261113-gRBgr7`。独立工作树：`/tmp/opencode/thunder-run-integration-20261113-gRBgr7/repo`。
以 `8160d0c` 为第一父提交合并上述快照，保留两侧成果；不是把整棵旧微信工作树覆盖到新主线。
原目录 `/workspace/雷霆酷跑` 的状态及 tracked diff 与开工时逐字节一致；其中九个嵌套工作树没有作为 gitlink 或普通文件导入。

## 审核发现与修复

| 严重度 | 发现 / 修复 | 验证 |
| --- | --- | --- |
| P1 | WX 使用共享 flow v3 规则身份，旧云函数仍用 core v2，且 content 漏 themes。云构建改为完整八份内容、同源 flow helper 和已校验构建身份 | 真实 `createRunSession → connectWxCloud → handler/store → simulation.cjs` 开局、提交契约测试 |
| P1 | WX 特殊主题未传给云端，修 hash 后仍会按默认主题重放。主题贯通 begin、持久票据与回放；拒绝非法/retired，finish 不能改主题 | 特殊主题与默认主题反例、票据绑定、真实权威收入断言 |
| P1 | 直接采用场景线会丢失 WX 单 renderer 与 GLB 纹理加载工厂。保留 renderer surface 所有权、注入 loader、帧排序和销毁 | shared-renderer、WX 完整启动/进局/结算/重开回归 |
| P1 | 新配置全角色免费，但旧云档案仍可能不拥有角色或被扣费购买。既有事务内幂等补齐免费角色，保留钱、物品、偏好、领奖/收据，单事务最多增加一次 revision | SDK 包装器、并发迁移、购买/领奖/结算竞争、重复 finish；付费机制使用显式非免费 fixture 保留覆盖 |
| P2 | 雷脊计分环 Z 方向反转。改为 `distance - worldZ` | 实例矩阵前方 −50m、接近 −25m、完成隐藏 |
| P2 | 雷脊云渊鲸分配 15 个球体却只更新 12 个，三个单位球停在原点挡住角色。实例容量改为实际 `SEG` | 六处 raycast、冻结帧 count12→15 恢复对照、旧实现红/新实现绿的实例位置回归，最终生产截图确认不再遮腿 |
| P2 | 图书馆倒挂区仍投地面道具，角色无法拾取。暂不增加倒挂道具玩法，在区体内排除地面箱 | 同 fixture 普通主题真实掉落 650/850m，反重力主题仅区外 850m |
| P2 | WX 几何徽标未接弯道 shader、光圈缺独立释放、海湾 puddleGlow 遗漏释放 | 共用 bend uniforms、资源计数/无增长/全部释放断言 |
| P2 | 新旧工作树 Three 类型分别为 0.160/0.187。统一为已采用的 0.187 运行时对应类型，WX 声明直接依赖，移除失效的 derivatives 扩展开关 | 干净 npm ci、强制 TS 重建、构建侧 noEmit |
| P2 | 完整微信入口漏接主线 `gameplay.json` 别名；第十企鹅缺 PNG 且启动名单只有九人 | 保留构建策略并移至 bootstrap 映射；企鹅由仓库已有 WebP 透明转码，实际启动加载十张肖像 |

配置合并保留十角色全免费、九套 coastal 模型和企鹅原模型；保留主线周任务奖励修正及微信商城/手册结构。
保留蛙登场/场景音乐/音量、Web 本机购买与云账户隔离、远距信标和全部新道具模型。原角色/补给素材没有删除。

## 字体与测试契约

- Web 旧 atlas 保留双方字形像素、advance/bearing，补齐缺字；WX 从已固定 SHA 的 Noto OFL 源重建，没有混入旧 Microsoft/Segoe 字形像素。
- Web CJK 为 2048×2654，WX CJK 为 2048×2404；合并字符集超过原 2K 方形容量，按仓库既有 4096px 上限检查。字形覆盖、实际 UV、许可来源等断言保持。U+FE0F 为零宽无墨单元。
- TypeScript 7 不再在根入口提供旧 `createSourceFile` API。四份字体测试改为真实 native API/AST 提取字面量，保留模板/转义和“不缺字”检查，不以正则或跳过替代。
- 更新角色/模型清单的旧九角色、十六模型假设；保留全部原测试关系，增加企鹅自身肖像及真实启动十张加载断言。
- 回放版本测试显式信任其保留的旧构建 SHA，避免隐含假定“当前包总等于 38d5116”；未放宽来自数据库的代码信任校验。
- 浏览器目视发现 Web 原变量字体缺 `昏渔港` 等新增字。用实际 `fc-query` cmap 确认后，保留原字体，增加同一固定 Noto OFL 源的 334 字形 / 96352 字节 OTF 补集及 CSS fallback；全部七个主题名的真实字体 cmap 覆盖通过。字体诊断中本机 FontTools/Fontkit 不可用，改用已有 opentype.js 与 Fontconfig，没有安装新的根依赖。补字后五项 Web CSS/页面回归通过，再重建及浏览器重验。

## 历史分支处置

- `yan/jetpack-pickup-3d` 的旧模型由 PR #56 新版及本地 coastal 飞行包覆盖；保留历史 ref，不重复合入旧二进制。
- `feature/test-site-current` / `integration/handtest-all` 的侧景和海报成果已在当前维护线存在，不再合并旧整棵目录。
- `content/frog-jump-charge`、`feature/run-skill-icons` 等早期候选仍含不同的充能玩法/共享 UI API；`feature/home-feature-integration` 是旧本机成长/任务方案。这些未作为本次新的 mostny/kljfg 提交重新启用，保留分支，避免覆盖当前技能、服务端任务与经济契约。
- Cocos 候选及 `sess/S12`–`S19` 是独立架构历史线，当前 Web/WX 不依赖它们；备份 ref、失效工作树记录未清理。

## 实际执行与验证

1. 检查状态、README/协作规范、分支祖先关系、已有整合记录；并行只读审查场景/道具及优化契约。首次历史 ref 检查受子会话 Git 工具限制，改由主会话输出固定 ref 的 cherry/log/diff 后完成筛查。
2. 原目录用独立临时 index 创建快照；独立任务树合并遇到 22 个冲突文件，逐项保留双方有效行为。字体二进制由字体流程生成，未手改 dist/build。
3. 初次编译暴露光圈 dispose 缺失与 Three 类型不一致。依赖元数据获取先超时，离线解析报告缓存缺失，有限时联网请求报告 TLS ECONNRESET，dedupe 同样缺缓存；对齐声明与锁中已有的 0.187 记录后由 npm 离线规范化，根干净安装成功。没有改用其他库版本或放宽编译。
4. SDK 按其独立锁离线安装成功；之前四项 SDK 跳过用例纳入最终完整执行。强制 TS 重建及独立回放构建通过。
5. 首轮 check 为 1043/1061，18 失败：遗漏资源释放、旧素材清单/缺企鹅、TS7 测试 API、主题特例 fixture 与显式回放信任假设。定点修正后 1062/1062 通过，随后行数门禁发现 trackGen 301 行；压掉一行空行后完整重跑。
6. **最终交付版 `npm run check`：1063/1063 通过，零失败、零跳过；8 配置/schema/primitive 校验、305 个 TS 文件架构/300 行门禁及 WX dry bundle 全通过。** 最后一项为新增鲸身原点实例回归。
7. Web 生产构建通过；大 JS chunk 警告保留。浏览器检查先因根路径构建搭配子路径服务导致首页未加载；改回 `TR_WEB_BASE=/thunder-run/` 重建。随后脚本使用了不存在的 `.page-back` 选择器，在已打开的设置页超时，按真实返回按钮 aria-label 修正后三个主题流程通过；目视字体遗漏补齐后再次重验。各次截图/日志保留于任务父目录 `observation-attempts`，最后证据见下节。
8. 最后目视雷脊图发现遮腿，静态审查未能定位，不将“无脚本错误”当作显示正常。隔离 Vite 页对同一 7m 帧做 mesh/raycast 与实例数恢复对照，确认是鲸身未更新实例；原型 hook 首次未捕获 renderer、超时后改为仅内存的 renderSim 捕获，中途服务器重启后继续原诊断。产品源码只修实例数一行，新增回归旧产物红、新产物绿；随后重建生产包并重跑实际三主题流程，最终雷脊图已目视确认腿部完整。

WX dry bundle：20 个真实模型，主包 2503.7 KB、分包 12884.7 KB、合计 15388.3 KB，均在现有门禁内。两个历史未交付皮肤 `volt_thunder.glb` / `bolt_storm.glb` 仍在 manifest 中明确标缺失，没有伪造素材或声称已验收。

### 浏览器观察

- 最终生产子路径包使用全新隔离浏览器上下文，390×844 验证十角色均免费、企鹅可选、设置页打开/退出玩家档案；320px 设置页文字补字后重新目视确认。
- 经真实设置按钮分别进入白日海景、天穹雷脊、失重图书馆，HUD 距离均推进至 9m；每次 Esc 能回大厅，coastal/bball GLB 的三个实际请求均 200，未记录脚本或着色器错误。
- 浏览器使用软件 WebGL、本地静态产物服务；API 明确隔离为 503，因此只证明未联网时页面/渲染流程，实际票据及收入关系由真实本地 handler/store 测试覆盖。浏览器及临时服务在脚本 finally 中关闭。
- 最终生产证据：[浏览器回执](review-evidence/2026-11-13-integration-AveTbW/browser-results.json)、[390px 大厅](review-evidence/2026-11-13-integration-AveTbW/lobby-390.png)、[320px 设置](review-evidence/2026-11-13-integration-AveTbW/settings-320.png)、[海景跑局](review-evidence/2026-11-13-integration-AveTbW/coast-run.png)、[雷脊修复后跑局](review-evidence/2026-11-13-integration-AveTbW/stormspire-run.png)、[图书馆跑局](review-evidence/2026-11-13-integration-AveTbW/library-run.png)。截图仅为早段，不证明 600m 后翻转长局、目标手机帧率或微信像素效果。
- 遮挡定位证据：[raycast/矩阵回执](review-evidence/2026-11-13-integration-LLXt3X/whale-diagnostic.json)、[临时 count12](review-evidence/2026-11-13-integration-LLXt3X/whale-count12-control.png)、[恢复 count15](review-evidence/2026-11-13-integration-LLXt3X/whale-count15-restored.png)。定位对照来自开发页且保持后处理开启；上述最终复验使用重新构建的生产 bundle。

### 日志与边界

任务日志目录为工作树父目录，包括 `npm-ci-aligned.log`、`cloud-sdk-install.log`、`build-force.log`、`check-integrated.log`、`check-final.log`、`check-accepted.log`、最终 `check-delivery.log`、`build-web-delivery.log`、`browser-delivery.log` 及各定向/诊断日志。提交前冲突清零、diff whitespace 检查通过，生成物和嵌套 gitlink 未入暂存；原目录状态/差异再次核对保持一致。

远程 PR 最新状态、真实 CloudBase 部署/IO、微信开发者工具和真机视觉/性能仍待核验。此交付是本地整合候选；没有用 Web、软件 WebGL、Node 测试或 dry bundle 代替微信目标端验收。尚未推送远程或发布站点。
