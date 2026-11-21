/**
 * 配置校验命令行工具。
 * 用法：node tools/validate-config.mjs [配置目录]
 * 复用 core 的同一份校验器（编译产物 packages/game/dist/core/**），保证「CI 校验」与「运行时校验」逻辑一致。
 * 附加两道 schema 闸（审查 T-3/T-6，零依赖实现，不引 ajv）：
 *   1. 轻量 JSON Schema 走查（type/enum/required/properties/items/最小最大值/additionalProperties=false）；
 *   2. schema 的 primitive 枚举 ↔ buffEngine PRIMITIVES 注册表双向比对，两份清单漂移即红。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFile, validateRefs } from '../packages/game/dist/core/config/configValidator.js';
import { PRIMITIVES, isPrimitiveSupported } from '../packages/game/dist/core/effects/buffEngine.js';

const dir = process.argv[2] ?? fileURLToPath(new URL('../config', import.meta.url));
const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../schema/config.schema.json', import.meta.url)), 'utf8'));
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
const content = {};
let errors = [];

/** 解析 '#/$defs/x' 或 '#/file/properties/...' 形态的引用 */
function resolveRef(ref) {
  let node = schema;
  for (const seg of ref.replace(/^#\//, '').split('/')) node = node?.[seg];
  if (!node) throw new Error(`schema 内部引用无法解析: ${ref}`);
  return node;
}

function checkNode(node, data, path, errors) {
  if (node?.$ref) node = resolveRef(node.$ref);
  if (!node) return;
  if (node.type) {
    const wanted = Array.isArray(node.type) ? node.type : [node.type];
    const actual = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
    const ok = wanted.includes(actual)
      || (wanted.includes('integer') && actual === 'number' && Number.isInteger(data));
    if (!ok) {
      errors.push(`${path}: 类型应为 ${wanted.join('|')}（得到 ${actual}）`);
      return;
    }
  }
  if (node.enum && !node.enum.includes(data)) {
    errors.push(`${path}: 应为枚举之一 ${JSON.stringify(node.enum)}（得到 ${JSON.stringify(data)})`);
  }
  if (typeof data === 'number' && (node.type === 'number' || node.type === 'integer')) {
    if (node.minimum !== undefined && data < node.minimum) errors.push(`${path}: ${data} < minimum ${node.minimum}`);
    if (node.maximum !== undefined && data > node.maximum) errors.push(`${path}: ${data} > maximum ${node.maximum}`);
  }
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      if (node.items && typeof node.items === 'object') {
        data.forEach((item, i) => checkNode(node.items, item, `${path}[${i}]`, errors));
      }
    } else {
      if (Array.isArray(node.required)) {
        for (const key of node.required) if (!(key in data)) errors.push(`${path}: 缺少 required 字段 ${key}`);
      }
      if (node.properties) {
        for (const [key, val] of Object.entries(data)) {
          if (node.properties[key]) checkNode(node.properties[key], val, `${path}.${key}`, errors);
          else if (node.additionalProperties === false) errors.push(`${path}.${key}: schema 未声明该字段（additionalProperties=false）`);
        }
      }
    }
  }
}

for (const f of files) {
  const name = f.replace(/\.json$/, '');
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch (e) {
    errors.push(`${name}: JSON 解析失败 ${e.message}`);
    continue;
  }
  content[name] = data;
  errors.push(...validateFile(name, data));
  // schema 走查：每个配置文件在 schema/config.schema.json 都有同名段
  if (schema[name]) checkNode(schema[name], data, name, errors);
  else errors.push(`schema: 缺少 ${name} 段（schema/config.schema.json 与 config/ 不同步）`);
}
// 全部文件齐备才能做跨文件引用检查
const missing = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy', 'achievements'].filter(n => !content[n]);
for (const m of missing) errors.push(`缺少配置文件: ${m}.json`);
if (missing.length === 0) errors.push(...validateRefs(content));

// primitive 双清单比对：schema 枚举 ↔ 引擎注册表（漂移即红，审查 T-3）
const schemaPrims = resolveRef('#/$defs/effect').properties.primitive.enum;
for (const p of schemaPrims) {
  if (!isPrimitiveSupported(p)) errors.push(`schema primitive '${p}' 未在 buffEngine 注册（两份清单漂移）`);
}
for (const p of Object.keys(PRIMITIVES)) {
  if (!schemaPrims.includes(p)) errors.push(`buffEngine primitive '${p}' 未写进 schema 枚举（两份清单漂移）`);
}

if (errors.length) {
  console.error('配置校验失败：');
  for (const e of errors) console.error('  ✗', e);
  process.exit(1);
}
console.log(`配置校验通过（${files.length} 个文件 + schema 走查 + primitive 双清单比对）`);
