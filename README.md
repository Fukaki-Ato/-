# 雷霆酷跑（微信小游戏）

基于 Cocos Creator 3.8.x + TypeScript 的跑酷类微信小游戏。

当前阶段：**外围系统开发**（除跑酷玩法本体外的全部功能）。跑酷玩法由独立模块/后续会话接入，边界协议见 `docs/06-跑酷对接协议.md`。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| docs/00-总览与范围.md | 项目目标、功能范围、角色分工、里程碑 |
| docs/01-架构与工程规范.md | 分层架构、目录结构、工具链、代码规范 |
| docs/02-数据模型与配置表.md | 存档结构、配置表 schema、时间与红点规则 |
| docs/03-核心服务与事件协议.md | 服务职责、事件表、关键流程 |
| docs/04-UI规范与界面清单.md | UI 基座规范、逐界面规格、资源规范 |
| docs/05-平台适配与云开发.md | 本地/微信适配层、云开发设计、合规 |
| docs/06-跑酷对接协议.md | 与玩法模块的进入/结算协议 |
| docs/07-测试与验收标准.md | 测试策略、模块验收清单、总验收流程 |
| docs/08-环境搭建与运行.md | 工具安装、工程打开、构建与真机调试 |
| docs/09-会话计划与派发规则.md | 子会话编号、依赖关系、派发与验收流程 |
| docs/prompts/ | 各子会话开场提示词（复制即用） |
| docs/reports/ | 各子会话完成报告（子会话撰写，主会话验收） |

## 目录速览

```
assets/scripts/core/       纯 TypeScript 核心层（禁止 import 'cc'）
assets/scripts/ui/         Cocos 界面层（Boot / 面板 / 组件）
assets/resources/          运行期资源（配置表 / 图片 / 音频）
tests/                     Vitest 单元测试（对应 core）
cloudfunctions/            微信云函数（S10）
docs/                      设计与流程文档
```

## 常用命令（S01 完成后可用）

```bash
npm install
npm run check      # typecheck(core+cc) + 单元测试，提交前必须全绿
npm test           # 仅运行单元测试
npm run typecheck:core
npm run typecheck:cc
```

## 子会话开发流程

1. 主会话输出 `docs/prompts/SXX-*.md` 开场提示词；
2. 用户将提示词全文派发给一个新的子会话（同一工作区），一次只派发一个；
3. 子会话完成后提交 git，并撰写 `docs/reports/SXX-*.md`；
4. 用户在主会话回复「SXX 完成」，由主会话执行验收并给出结论。

详见 `docs/09-会话计划与派发规则.md`。
