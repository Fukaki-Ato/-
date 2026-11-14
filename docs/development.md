# 开发环境与检查

## 必需环境

- 推荐 Node 24（`.nvmrc`，CI 同源）；当前工程要求 Node `>=22.23.0`，任务和排行榜后端使用内置 `node:sqlite`。旧版兼容矩阵不再适用于最新 main。
- 在仓库根执行 `npm ci`，按提交的 `package-lock.json` 安装所有 app/package workspaces。
- 间接依赖安全检查用 `npm audit`；有兼容修复时优先定向更新、检查锁文件 diff 并重跑安装/构建，不盲目强制升级主依赖。
- 游戏运行/构建不需要 Python、系统中文字体或微信开发者工具；已有运行时素材已入库。

## 常用路径

```bash
npm run check                       # 完整本地质量门禁
npm test -- tests/mainFlow.test.mjs  # 编译后只跑指定文件
npm run dev                         # Vite，127.0.0.1:8767
```

`npm run dev` 启动前编译一次；共享包修改时另开 `npm run watch`，否则 app 读到的可能是旧 `dist`。
`npm run preview:web` 只服务已有生产产物，先执行 `npm run build:web`；以 Vite 输出的地址为准。
本地地址不是对外预览地址，本仓没有自动部署命令。

用户交付要求：每次测试站部署完成，回复必须附上完整、可点击的测试站地址，并说明发布文件核对与站内浏览器验证的实际结果。不能只回复“已部署”，也不能用 localhost 或内网地址代替。每次部署仍核验实际发布版本；不进行助手侧公网可达性探测。

固定测试站入口：**http://43.136.20.106:18790/thunder-run/**（用户指定公网 Nginx 18790；公网 IP 经云实例元数据确认）。正式站与测试站分开，部署 UI 时不要更新正式站。每次交付都提供此链接；若实例公网 IP 或入口配置改变，重新确认地址。2026-10-11：用户明确说明防火墙只允许本人访问，并确认自己可以打开站点；要求无需确认公网可达性。助手侧超时／502 是预期访问限制，不作为部署失败或待解决阻塞，不尝试绕过限制，不修改安全组／防火墙。验收以发布文件一致性、站内浏览器／手机尺寸与游戏流程验证为准；对外访问仅记录为用户确认，不冒称助手独立验证。

公网地址排障：代理／TUN 环境下，出口 IP 查询可能返回代理 IP，而不是主机的入站公网 IP。优先使用实例公网配置或只查询公网 IP 的云元数据；本机腾讯云元数据域名曾被代理 DNS 映射成假 IP，改用云平台的元数据链路地址后确认了公网 IP。地址发现与公网可达性验证必须分开，不能把元数据查询成功当作外部访问成功。

子路径部署时设置 `TR_WEB_BASE` 后再构建，例如：

```bash
# Linux/macOS shell
TR_WEB_BASE=/thunder-run/ npm run build:web
```

PowerShell：`$env:TR_WEB_BASE='/thunder-run/'; npm run build:web`。
自动检查不想弹浏览器时同样设置 `TR_NO_OPEN=1`。不要把本机路径、代理或凭据写入工程入口文档。

## 检查范围与排障

- `npm run check` 顺序：TS project references → Node 测试 → 8 份配置 → 架构/行数 → 临时 WX bundle/体积。任一步失败即停止；**不包含 Web 生产构建或浏览器/真机验收**。
- 测试导入共享包的编译产物。`npm test` 自动编译；直接 `node tools/test.mjs tests/<name>.test.mjs` 前需 `npm run build`。
- 测试入口显式枚举顶层 `tests/*.test.mjs`，不依赖 shell 或 Node 的 glob 展开；新增测试按此命名。
- 怀疑增量产物过期：`npm exec -- tsc -b --force` 后重跑目标检查；不提交生成物。
- 8767 被占用：确认占用进程，再换端口（`npm run dev --workspace @tr/web -- --port 8768`）；不要盲目杀进程。
- DOM 页面的键盘/焦点清理在 `apps/web/src/mobileUi.ts`，不是每个 overlay 各自管理。修改页面测试时验证实际生命周期，不再断言旧版全局 resize/keydown 代码存在；回归见 `tests/mobile-ui.test.mjs`。

## 可选素材工具

- 字体工具不是根 workspace：先 `npm ci --prefix tools/fontgen`；自动字体探测只查 Windows 候选，其他平台需提供可解析的 TTF/TTC（`--font`）。完整/补字流程与授权限制见 [字体说明](../assets/fonts/README.md)。
- Python 抠图工具需要 Python 3、`numpy`、`Pillow`、`opencv-python`。只在重做素材时安装到独立虚拟环境；检查脚本的输入/输出路径，不使用旧文档里的 `D:/python/python.exe`。
- 只需 PNG → WebP 转码而环境缺少 Pillow／ensurepip 时，可把 `sharp` 安装在任务临时目录，用 `require('<临时目录>/node_modules/sharp')` 调用包入口；不要为离线素材处理改根依赖或锁文件，也不要假定某个版本的 `lib/index.js` 路径。海滨背景已用此方式验证尺寸和输出字节数。
- 音频转码需自行安装 ffmpeg，本仓未捆绑二进制；格式建议见 [音频素材](../assets/audio/README.md)。
- WX 构建：`npm run build:wx -- --minify`；导入及待复测项见 [WX 说明](../apps/wx/README.md)。
