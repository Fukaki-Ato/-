#!/usr/bin/env node
'use strict';

/**
 * 把 cloudfunctions/common 同步到各云函数目录下的 common/。
 * 用法（进入 cloudfunctions 目录）：node sync-common.js
 * 原因：微信开发者工具上传云函数时只包含函数自身目录，公共代码需随函数一起上传。
 */

const fs = require('fs');
const path = require('path');

const root = __dirname;
const source = path.join(root, 'common');
const targets = ['login', 'syncSave', 'submitScore', 'getLeaderboard'];

if (!fs.existsSync(source)) {
  console.error('[sync-common] 未找到 cloudfunctions/common');
  process.exit(1);
}

let synced = 0;
for (const name of targets) {
  const fnDir = path.join(root, name);
  if (!fs.existsSync(fnDir)) {
    console.warn(`[sync-common] 跳过不存在的函数目录：${name}`);
    continue;
  }
  fs.cpSync(source, path.join(fnDir, 'common'), { recursive: true });
  synced += 1;
  console.log(`[sync-common] ${name}/common 已更新`);
}
console.log(`[sync-common] 完成：${synced} 个云函数。请在微信开发者工具中右键云函数 → 上传并部署。`);
