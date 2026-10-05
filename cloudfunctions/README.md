# 雷霆酷跑 云开发（cloudfunctions）

本目录为微信云开发云函数源码（Node.js + `wx-server-sdk`），与 docs/05 §4 对应。所有函数均通过云函数上下文 `cloud.getWXContext().OPENID` 识别用户，客户端不直连数据库。

## 目录结构

```
cloudfunctions/
  common/            公共工具（校验/错误码/文本清洗），无第三方依赖
  login/             OPENID 初始化/读取 players 档案
  syncSave/          云存档上传/下载（版本时间戳防覆盖）
  submitScore/       提交成绩，维护 scores/players 最佳分数与名次
  getLeaderboard/    世界榜查询（top 1-100）
  sync-common.js     把 common/ 同步进各函数目录（上传前必须执行）
```

> 微信开发者工具「上传并部署」只包含云函数自身目录，因此 `common/` 不参与直接上传。
> 修改公共代码后，在 `cloudfunctions/` 执行：

```bash
node sync-common.js
```

然后用微信开发者工具逐个右键云函数目录 → **上传并部署：云端安装依赖**。生成到 `cloudfunctions/<name>/common/` 的副本已加入 .gitignore，不入库。

## 集合初始化（云开发控制台 → 数据库）

在云开发控制台创建以下集合（名称区分大小写）：

| 集合 | 字段 | 索引建议 | 权限建议 |
| --- | --- | --- | --- |
| `players` | `_openid, nickname, avatarUrl, bestScore, createdAt, updatedAt` | `_openid` 唯一索引；`bestScore` 降序（可选） | **所有用户不可读写**（仅云函数管理端访问） |
| `saves` | `_openid, save, version, updatedAt` | `_openid` 唯一索引 | **所有用户不可读写**（仅云函数管理端访问） |
| `scores` | `_openid, score, distance, mode, nickname, avatarUrl, updatedAt` | `_openid` 唯一索引；`score` 降序 + `updatedAt` 升序（复合） | **所有用户不可读写**（仅云函数管理端访问） |

权限说明（最小权限原则）：

- 客户端所有读写都经云函数（管理端权限，不受集合权限限制），因此集合可直接设为「所有用户不可读写」，不需要「所有人可读」；
- 若后续开放客户端直读（例如活动配置），再单独放宽对应集合，不要整体放开；
- `scores` 采用「每人只保留最佳一条」策略（`_openid` 唯一），排行榜不会出现同一玩家多行。

索引创建：云开发控制台 → 数据库 → 选择集合 → 索引管理 → 新建索引。`_openid` 唯一索引可避免并发重复建档；成绩集合的 `score` 降序索引用于排行榜排序（top 50 场景数据量小，无索引也可运行）。

## 云函数契约（与 contracts.ts / docs/05 对齐）

| 函数 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `login` | 无 | `{ ok, uid, nickname, avatarUrl, bestScore }` | `uid = OPENID`；首次调用自动建档 |
| `syncSave` | `{ action: 'upload', save, version, updatedAt }` 或 `{ action: 'download' }` | 上传 `{ ok, serverUpdatedAt }`；下载 `{ ok, save, version, updatedAt, serverUpdatedAt }` | 上传时云端 `updatedAt` 更新则拒绝（`STALE_SAVE` + `serverUpdatedAt`），防止旧档覆盖新档 |
| `submitScore` | `{ score, distance, mode, nickname, avatarUrl }` | `{ ok, bestScore, rank }` | rank 为「分数严格大于我的记录数 + 1」；非法入参返回 `INVALID_SCORE` |
| `getLeaderboard` | `{ board: 'global', top }` | `{ ok, list: [{ rank, uid, nickname, avatarUrl, score }], me }` | rank 从 1 开始；`me` 未上榜为 `null`；`board='friends'` 返回 `UNSUPPORTED_BOARD`（好友榜走开放数据域） |

错误返回统一为 `{ ok: false, code, message }`；云函数内部异常不抛出到客户端（记录 `console.error` 供云开发日志排查）。

入参校验（`common/index.js`）：

- `score` / `distance`：0 ~ 1,000,000,000 的有限数字；
- `mode`：非空字符串（≤32 字符）；
- `nickname` / `avatarUrl`：去除控制字符并截断（32 / 512 字符）；
- `save`：对象且 JSON ≤ 256KB；`version` 非负整数；`updatedAt` 正数时间戳；
- `top`：1 ~ 100，默认 50。

## 部署步骤（微信开发者工具）

1. 微信开发者工具导入 `build/wechatgame` 构建产物，打开「云开发」面板并**开通云开发环境**（记下环境 ID）；
2. 在云开发控制台 → 数据库中按上表创建集合并配置权限/索引（首次）；
3. 回到项目目录，执行 `cd cloudfunctions && node sync-common.js`；
4. 编辑器左侧「云函数」列表中找到 `login` / `syncSave` / `submitScore` / `getLeaderboard`：
   - 若列表为空：右键 `cloudfunctions/login` 等目录 → 「创建并部署：云端安装依赖」；
   - 已存在：右键 → 「上传并部署：云端安装依赖」；
5. 把环境 ID 填入 `assets/resources/config/app.json` 的 `cloudEnvId`，重新构建后再联调；
6. 云函数日志：云开发控制台 → 云函数 → 选中函数 → 日志，排查 `DB_ERROR` 等。

> 本工程云函数不使用开放接口（openapi），因此未提供 `config.json` 权限声明；如后续调用 `cloud.openapi.*`，再为对应函数增加最小 `permissions.openapi` 配置。

## 本地调试（可选）

- 云函数依赖不在本仓库安装（保持部署无关依赖为零）；如需本地单测可单独 `npm install`；
- 微信开发者工具的「云函数本地调试」可直接运行本目录函数（需先同步 common）。
