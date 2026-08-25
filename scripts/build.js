/**
 * build.js — 生成可部署前端（将占位符替换为真实 API 地址）
 *
 * 用途：
 *  - GitHub Actions 构建时注入（Secrets 提供地址，仓库源码不出现代理地址）
 *  - 本地使用：API_BASE="https://your-api.example.com/api/v3" node scripts/build.js
 *
 * 环境变量：
 *  - API_BASE         必填：主站 API 地址（index.html）
 *  - SOURCE_DATE_URL  可选：Source 数据页 Date 代理线路（hankmi.html）；缺失时该线路降级为不可用
 *
 * 输出：dist/index.html、dist/hankmi.html（单文件自包含，可直接上传部署）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const API_BASE = (process.env.API_BASE || '').trim();
const SOURCE_DATE_URL = (process.env.SOURCE_DATE_URL || '').trim();

const PLACEHOLDER_API = '__LINGDATE_API_BASE__';
const PLACEHOLDER_DATE = '__LINGDATE_SOURCE_DATE__';

if (!API_BASE) {
  console.error('[build] 错误：缺少环境变量 API_BASE。');
  console.error('[build] 示例：API_BASE="https://your-api.example.com/api/v3" node scripts/build.js');
  process.exit(1);
}
if (!/^https?:\/\//.test(API_BASE)) {
  console.error(`[build] 错误：API_BASE 不是合法地址：${API_BASE}`);
  process.exit(1);
}
if (!SOURCE_DATE_URL) {
  console.warn('[build] 警告：未设置 SOURCE_DATE_URL，hankmi.html 的 Date 代理线路将不可用（页面会自动落到官方线路）。');
}

const targets = [
  { src: 'index.html', placeholders: { [PLACEHOLDER_API]: API_BASE } },
  { src: 'hankmi.html', placeholders: SOURCE_DATE_URL ? { [PLACEHOLDER_DATE]: SOURCE_DATE_URL } : {} },
];

fs.mkdirSync(dist, { recursive: true });

let failed = false;
for (const target of targets) {
  const file = path.join(root, target.src);
  if (!fs.existsSync(file)) {
    console.log(`[build] 跳过（文件不存在）: ${target.src}`);
    continue;
  }
  let content = fs.readFileSync(file, 'utf8');
  for (const [placeholder, value] of Object.entries(target.placeholders)) {
    if (!content.includes(placeholder)) {
      console.warn(`[build] 警告：${target.src} 中未找到占位符 ${placeholder}（已忽略该替换）`);
    } else {
      content = content.split(placeholder).join(value);
      console.log(`[build] ${target.src}: ${placeholder} -> ${value}`);
    }
  }
  if (content.includes('__LINGDATE_')) {
    const leftovers = [...new Set(content.match(/__LINGDATE_[A-Z_]+/g))];
    console.error(`[build] 错误：${target.src} 仍有未替换占位符: ${leftovers.join(', ')}`);
    failed = true;
  }
  const out = path.join(dist, target.src);
  fs.writeFileSync(out, content, 'utf8');
  console.log(`[build] 已生成: ${out} (${fs.statSync(out).size} bytes)`);
}

if (failed) {
  console.error('[build] 构建失败：存在未替换的占位符。');
  process.exit(1);
}
console.log('[build] 构建完成。dist/ 下的 index.html、hankmi.html 可直接上传部署。');
