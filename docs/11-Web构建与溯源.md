# 11 Web 构建与溯源

本文档说明如何用 **Cocos Creator 3.8.8** 生成可溯源的 Web 构建产物，以及如何核对产物来源。

## 1. 前置条件

| 项 | 说明 |
| --- | --- |
| Cocos Creator | 3.8.8，默认路径 `F:\Cocos\Editor\3.8.8\CocosCreator.exe` |
| 自定义路径 | `--creator <路径>` 或环境变量 `COCOS_CREATOR` |
| Node | >= 18（脚本仅用内置模块） |

## 2. 构建命令

```bash
npm run build:web          # debug 构建，输出 build/web-desktop
npm run build:web:zip      # 构建并打包 dist/<name>-web-<shortSha>.zip（含 .sha256）
node scripts/build-web-desktop.mjs --release --zip   # release + 打包
```

成功后 `build/web-desktop/BUILD-MANIFEST.json` 记录构建来源；打包模式额外生成：

- `dist/leiting-kupao-web-<shortSha>[-dirty].zip`
- `dist/leiting-kupao-web-<shortSha>[-dirty].zip.sha256`（`<hex>  <文件名>` 格式，可 `sha256sum -c` 校验）

> Cocos CLI 约定成功退出码为 **36**（个别版本为 0），脚本两者均视为成功并把实际退出码写入清单。

## 3. BUILD-MANIFEST.json 结构

```json
{
  "schemaVersion": 1,
  "project": "leiting-kupao",
  "platform": "web-desktop",
  "debug": true,
  "engine": { "name": "Cocos Creator", "version": "3.8.8", "executable": "...", "exitCode": 36 },
  "source": {
    "commit": "<完整 git sha>",
    "commitShort": "<7位>",
    "branch": "main",
    "dirty": false,
    "describe": "<git describe --always --dirty>"
  },
  "builtAt": "2026-10-06T...",
  "builder": "scripts/build-web-desktop.mjs"
}
```

## 4. 溯源核对流程

```bash
# 1) 解压产物（或直接用 build/web-desktop）
cat BUILD-MANIFEST.json

# 2) 在源码仓库中核对 commit 是否存在、是否为期望提交
git cat-file -t <source.commit>
git log -1 --format='%H %s' <source.commit>

# 3) 严谨核对：用同一提交重建并比对关键产物（hash 前缀一致性视构建确定性而定）
git checkout <source.commit> && npm run build:web:zip
```

约定：**先提交、后构建**。提交 `A` 之后运行脚本，产物的 `source.commit` 即为 `A`；若工作区有未提交改动（`dirty=true`），清单会明确标注，可信度降低。

## 5. CI 用法（示例）

```yaml
- run: npm ci
- run: npm run build:web:zip
- uses: actions/upload-artifact@v4
  with: { name: web-build, path: dist/ }
```
