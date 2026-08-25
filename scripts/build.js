/**
 * build.js — 生成可部署前端（将占位符替换为真实地址）
 *
 * 用途：
 *  - GitHub Actions 构建时注入（Secrets 提供地址，仓库源码不出现代理地址）
 *  - 本地使用：API_BASE="https://your-api.example.com/api/v3" HANKMI_URL="https://..." node scripts/build.js
 *
 * 环境变量：
 *  - API_BASE      必填：主站 API 地址（index.html）
 *  - HANKMI_URL    必填：Source 数据页（hankmi-source 仓库）部署地址，导航「Source 数据」按钮跳转用
 *
 * 输出：dist/index.html（单文件自包含，可直接上传部署）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const API_BASE = (process.env.API_BASE || '').trim();
const HANKMI_URL = (process.env.HANKMI_URL || '').trim();

const PLACEHOLDER_API = '__LINGDATE_API_BASE__';
const PLACEHOLDER_HANKMI = '__LINGDATE_HANKMI_URL__';

if (!API_BASE) {
  console.error('[build] 错误：缺少环境变量 API_BASE。');
  console.error('[build] 示例：API_BASE="https://your-api.example.com/api/v3" node scripts/build.js');
  process.exit(1);
}
if (!/^https?:\/\//.test(API_BASE)) {
  console.error(`[build] 错误：API_BASE 不是合法地址：${API_BASE}`);
  process.exit(1);
}
if (!HANKMI_URL) {
  console.error('[build] 错误：缺少环境变量 HANKMI_URL（Source 数据页部署地址，导航按钮跳转用）。');
  console.error('[build] 示例：HANKMI_URL="https://your-source-viewer.example.com/hankmi.html"');
  process.exit(1);
}
if (!/^https?:\/\//.test(HANKMI_URL)) {
  console.error(`[build] 错误：HANKMI_URL 不是合法地址：${HANKMI_URL}`);
  process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });

let failed = false;

const file = path.join(root, 'index.html');
if (!fs.existsSync(file)) {
  console.error(`[build] 错误：找不到 ${file}`);
  process.exit(1);
}

let content = fs.readFileSync(file, 'utf8');
const placeholders = [
  [PLACEHOLDER_API, API_BASE],
  [PLACEHOLDER_HANKMI, HANKMI_URL],
];
for (const [placeholder, value] of placeholders) {
  if (!content.includes(placeholder)) {
    console.warn(`[build] 警告：index.html 中未找到占位符 ${placeholder}（已忽略该替换）`);
  } else {
    content = content.split(placeholder).join(value);
    console.log(`[build] index.html: ${placeholder} -> ${value}`);
  }
}

if (content.includes('__LINGDATE_')) {
  const leftovers = [...new Set(content.match(/__LINGDATE_[A-Z_]+/g))];
  console.error(`[build] 错误：index.html 仍有未替换占位符: ${leftovers.join(', ')}`);
  failed = true;
}

const out = path.join(dist, 'index.html');
fs.writeFileSync(out, content, 'utf8');
console.log(`[build] 已生成: ${out} (${fs.statSync(out).size} bytes)`);

if (failed) {
  console.error('[build] 构建失败：存在未替换的占位符。');
  process.exit(1);
}
console.log('[build] 构建完成。dist/index.html 可直接上传部署。');
