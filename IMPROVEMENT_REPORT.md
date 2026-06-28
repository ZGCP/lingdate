# 灵应用商店 (lingdate) 代码改进报告

## 项目概览

**项目**: lingdate (灵应用商店数据排行 - 液态玻璃版)
**技术栈**: 纯 HTML/CSS/JS 单文件 SPA + Node.js 数据抓取脚本 + GitHub Actions 自动化
**核心文件**: `index.html` (3067→4081 行)、`backend/` (2628 行 TypeScript)、`scripts/`、`README.md`

---

## 一、安全修复（XSS 漏洞）⚠️ 高优先级

### 1.1 问题描述
所有渲染函数（`renderAppCard`、`openAppDetail`、`renderRanking`、`renderDonations`、`renderNotifications`、`renderCollections`、`renderHistory` 等）直接将用户数据（应用名称、描述、用户名、评论内容等）插入 HTML 模板字符串，**未经任何转义处理**。恶意数据源或伪造的 API 返回包含 `<script>` 标签的内容时，会导致 XSS 攻击。

### 1.2 修复内容
- **新增 `escapeHtml()` 函数**: 转义 `&`、`<`、`>`、`"`、`'` 五种危险字符
- **全面应用到所有渲染函数**: 每一处用户数据插入前均使用 `escapeHtml()` 转义
  - `renderAppCard`: 应用名、开发者、描述、版本号、分类名、_id
  - `openAppDetail`: 所有详情字段（包名、版本、来源、架构、设备、描述等）、评论内容、用户名
  - `renderRanking`: 应用名、开发者、_id
  - `renderUserRanking`: 用户名
  - `renderDonations`: 捐赠者名、备注
  - `renderNotifications`: 通知标题、内容
  - `renderCollections`: 合集标题、描述、创建者
  - `renderHistory` / `renderDownloadHistory`: 应用名、_id
  - `loadVersionList`: 版本名、版本号、更新日志
  - `renderCategories`: 分类名、显示名
- **新增 `getFallbackIcon()` / `getFallbackAvatar()`**: 统一占位图标/头像生成，消除各处重复的 SVG 拼接代码，同时确保占位文本也经过安全处理

### 1.3 原因
XSS 是 Web 安全最严重的漏洞类型之一。本项目数据来自第三方 API，无法保证数据安全性。即使 API 数据是安全的，也应遵循「永远不信任外部数据」的原则。

---

## 二、性能优化 ⚡

### 2.1 搜索防抖（debounce）

**问题**: 搜索输入框每次按键都触发 `renderApps()` 重新渲染全部应用列表，在 740+ 应用场景下造成大量不必要的 DOM 操作。

**修复**:
- 新增 `debounce(fn, delay)` 工具函数
- 搜索事件改为 `debouncedRenderApps`（200ms 防抖）
- 常量 `SEARCH_DEBOUNCE_MS = 200` 可调整

### 2.2 应用列表分页渲染

**问题**: `renderApps()` 一次性渲染所有匹配的应用（可能 740+ 个），创建大量 DOM 节点，导致页面卡顿。

**修复**:
- 新增 `currentAppPage` 和 `APPS_PAGE_SIZE = 48` 分页机制
- `renderApps()` 仅渲染前 `currentAppPage × APPS_PAGE_SIZE` 个应用
- 底部显示「加载更多」按钮，显示总数/已展示数
- 筛选条件变化时自动重置分页（`currentAppPage = 1`）

### 2.3 CSS containment

**问题**: 大量 `.app-card` 元素在页面中渲染时，浏览器无法优化布局计算范围。

**修复**: 在 `.app-card` CSS 中添加 `contain: layout style paint`，告知浏览器每个卡片是独立的布局/样式/绘制单元，减少重排计算范围。

### 2.4 排序使用 locale-aware 比较中文

**问题**: `getFilteredApps` 的字符串排序使用默认 `localeCompare()`，对中文字符排序不准确。

**修复**: 改为 `va.localeCompare(vb, 'zh-CN')`，确保中文排序符合用户预期。

---

## 三、潜在 Bug 修复 🐛

### 3.1 `res.ok` 未检查（多处）

**问题**:
- `saveProfile()`: `if (res)` 检查永远为真（`fetch` 总返回 Response），应检查 `res.ok`
- `submitFeedback()`: 同上，且先 `await res.json()` 再检查 `.message`，若返回非 200 会抛错
- `handleAvatarUpload()`: 同上
- `openCollectionDetail()`: 空 catch 块吞掉所有错误

**修复**: 所有 API 响应均先检查 `res && res.ok`，失败时显示具体错误信息而非静默忽略。

### 3.2 除零风险

**问题**: `updateStats()` 中 `(zeroCount / allApps.length) * 100`，当 `allApps.length === 0` 时产生 `NaN`。

**修复**: 添加 `allApps.length > 0` 条件判断，空数据时显示 `0.0%`。

### 3.3 竞态条件（Race Condition）

**问题**: `openAppDetail()` 是异步函数，用户快速点击多个应用时，较早的请求可能在较晚请求之后返回，导致显示错误的应用详情。

**修复**: 引入 `detailRequestId` 递增计数器，每次打开详情时递增，异步操作的每个关键节点检查 `thisRequestId !== detailRequestId` 则放弃更新，确保只有最新请求的结果被渲染。

### 3.4 日期排序 NaN 问题

**问题**: `renderLatest()` 和 `getFilteredApps()` 中 `new Date(dateStr)` 对无效日期返回 `Invalid Date`，`.getTime()` 产生 `NaN`，导致排序结果不可预测。

**修复**: 对所有日期转换结果做 `isNaN()` 检查，回退为 0。

### 3.5 Node.js 脚本 HTTP 状态码未检查

**问题**: `fetch-apps.js` 和 `fetch-detail.js` 的 `fetch()` 函数仅处理 JSON 解析错误和网络错误，不检查 HTTP 状态码（404、500 等被视为成功）。

**修复**:
- 新增 HTTP 状态码检查（`statusCode < 200 || >= 300` 视为失败）
- 新增自动重试机制（最多 3 次，间隔 1 秒）
- 增强数据校验：检查 `data.apps` 是否为数组、`data.pagination` 是否存在
- `fetch-detail.js` 增加读取现有详情数据时的错误容忍（JSON 解析失败时从头开始而非崩溃）
- 添加失败计数统计

---

## 四、代码质量与规范性 📐

### 4.1 常量提取

**问题**: 魔法字符串和数字分散在代码各处（`'lingdate_token'`、`60*60*1000`、`100`、`50` 等），修改时需要逐个查找。

**修复**: 统一提取到顶部 `STORAGE_KEYS`、`CACHE_PREFIX`、`CACHE_TTL`、`SEARCH_DEBOUNCE_MS`、`APPS_PAGE_SIZE`、`MAX_DOWNLOAD_HISTORY`、`RANKING_TOP_N`、`DETAIL_FETCH_DELAY_MS`、`DOWNLOAD_BASE` 等常量，一处修改全局生效。

### 4.2 脆弱的索引映射

**问题**:
- `switchPage()` 通过 nav-link 按钮**索引**映射页面名（`pages[i] === page`），增删按钮会导致映射错误
- `filterZeroDownloads()` 同样依赖按钮**位置索引**

**修复**:
- nav-link 添加 `data-page` 属性，`switchPage` 使用 `btn.dataset.page === page` 匹配
- filter-btn 添加 `data-filter` 属性，`filterZeroDownloads` 使用 `btn.dataset.filter` 匹配
- 无论 HTML 顺序如何变化，功能不受影响

### 4.3 `'use strict'` 模式

**修复**: 在 `<script>` 标签开头添加 `'use strict'`，启用严格模式，帮助捕获隐式全局变量等常见错误。

### 4.4 GitHub Actions 鲁棒性

**问题**: workflow 的 commit 步骤在并发 push 时可能冲突失败。

**修复**:
- commit 前先检查是否有变更（`git diff --staged --quiet`），无变更时跳过
- push 前先 `git pull --rebase` 以减少冲突
- 区分 main/master 分支自动适配

### 4.5 空 catch 块

**问题**: 多处 `catch {}` 或 `catch(e) {}` 静默吞掉错误，不利于调试。

**修复**: 
- `openCollectionDetail`: catch 中显示 `showToast` 错误提示
- Node.js 脚本: 所有 catch 都打印具体错误信息

### 4.6 `switchLoginTab` 空函数

**问题**: 该函数为空但被 HTML 调用。

**修复**: 添加注释说明预留扩展性（未来可添加注册/忘记密码标签）。

---

## 五、改进前后对比

| 类别 | 改进前 | 改进后 |
|------|--------|--------|
| **XSS 安全** | 用户数据直接插入 HTML | 全部经过 `escapeHtml()` 转义 |
| **搜索性能** | 每次按键触发全量重渲染 | 200ms 防抖，减少无效渲染 |
| **列表渲染** | 一次性渲染 740+ DOM 节点 | 分页渲染（48 个/页），按需加载 |
| **CSS 性能** | 无 containment | `contain: layout style paint` |
| **API 错误处理** | `if (res)` 永真判断 | `if (res && res.ok)` 正确检查 |
| **除零 Bug** | `NaN%` 显示 | `0.0%` 兜底 |
| **竞态条件** | 快速点击显示错误详情 | 请求 ID 机制防止 |
| **日期排序** | NaN 导致不可预测排序 | isNaN 检查回退 0 |
| **Node.js 脚本** | 不检查 HTTP 状态码 | 状态码检查 + 自动重试 + 数据校验 |
| **常量管理** | 魔法字符串分散 | 集中定义，一处修改 |
| **页面映射** | 基于按钮索引 | 基于 `data-page` 属性 |
| **GitHub Actions** | 可能 push 冲突失败 | 先 rebase 再 push |
| **代码规范** | 无严格模式 | `'use strict'` |

---

## 七、第二轮改进（基于 API 测试结果与深度扫描）

### 7.1 虚假 API 端点修复 🚫

**问题**: API 演示页列出"忘记密码"和"重置密码"端点，但后端并未实现这两个接口，对用户造成误导。

**修复**:
- 移除"忘记密码"和"重置密码"条目
- 替换为实际存在的"用户注册（需白名单邮箱域名）"和"用户登录"端点
- 添加 `.api-note` 提示区块，明确标注不可用的端点

### 7.2 注册 UX 改进 🔑

**问题**: 登录弹窗的注册提示仅显示"请在灵应用商店官网注册账号"，缺少官网链接和白名单邮箱说明。

**修复**:
- 将纯文本改为带超链接的提示："需先在灵应用商店官网注册账号（仅支持白名单邮箱域名验证）"
- 密码字段添加显示/隐藏切换按钮（`.password-toggle`），提升移动端输入体验
- `<label>` 添加 `for` 属性与输入字段关联，提升无障碍性

### 7.3 基础无障碍支持 ♿

**问题**: 整个项目零 ARIA 属性、无键盘导航支持（除截图灯箱外）、模态框无焦点管理。

**修复**:
- 所有模态框添加 `role="dialog"` + `aria-modal="true"` + `aria-label`
- 所有关闭按钮添加 `aria-label="关闭"`
- 搜索输入框添加 `<label>` + `aria-label`（`.sr-only` 隐藏标签类）
- 评分星级添加 `tabindex="0"` + `role="button"` + `aria-label`
- 全局 Escape 键关闭所有模态框（统一处理，而非仅截图灯箱）
- 添加 `@media (prefers-reduced-motion: reduce)` 保护前庭疾病用户

### 7.4 空 catch 块全面清理 🔍

**问题**: 12+ 处空 catch 块静默吞掉错误，不利于调试和用户感知。

**修复**: 所有空 catch 块改为输出 `console.warn` 或显示 `showToast` 错误提示：
- 推荐应用加载失败 → console.warn + 本地排序回退
- 分类/截图/评论获取失败 → console.warn + 空数组回退
- 用户资料/版本历史获取失败 → console.warn + null 回退
- 通知标记失败 → console.warn
- 缓存读写失败 → console.warn
- 登录网络错误 → 区分在线/离线显示不同提示

### 7.5 离线检测 + 前端重试 🌐

**问题**: 前端不检测网络状态，网络恢复时无自动提示；API 失败无重试机制。

**修复**:
- `apiFetch` 改为带重试的异步函数（网络失败或非 200 响应自动重试 1 次）
- 添加 `navigator.onLine` 检测，网络不可用时直接抛出明确错误
- 监听 `online`/`offline` 事件：
  - 离线时显示橙色顶部横幅（"网络不可用，部分功能受限"）
  - 上线时自动隐藏横幅 + showToast("网络已恢复")

### 7.6 CSS 组织优化 🎨

**修复**:
- 新增 `.glass-card` 基类，统一 12+ 个组件的背景/模糊/边框/悬停样式
- 新增字体大小变量 `--text-xs` 到 `--text-3xl`（8级字号体系）
- 新增玻璃模糊预设变量 `--glass-blur-sm/md/lg`，减少 20+ 处重复 backdrop-filter 定义
- 新增 `.login-prompt-banner` CSS 类替代内联样式
- 新增 `.api-note` 样式（橙色提示区）
- 修复移动端 340px 最小宽度溢出 → `minmax(min(340px, 100%), 1fr)`

### 7.7 `openAppDetail` 大函数重构 🏗️

**问题**: 原函数 113 行，混合竞态管理、未登录渲染、已登录渲染、评论、评分、下载等所有逻辑。

**修复**: 拆分为 5 个独立子函数：
- `renderLoginPrompt()` — 登录提示横幅
- `renderDetailHeader(app)` — 详情头部（图标+名称+统计）
- `renderBasicInfo(app, catName, sizeMB, fields)` — 基本信息网格（动态字段列表）
- `renderCommentsSection(appId, comments)` — 评论区渲染
- `renderRatingSection(appId)` — 评分区渲染

主函数 `openAppDetail` 变为清晰的流程控制器（约 60 行），各子函数独立可测试。

---

## 八、改进前后对比（完整版）

| 类别 | 改进前 | 改进后 |
|------|--------|--------|
| **XSS 安全** | 用户数据直接插入 HTML | 全部经过 `escapeHtml()` 转义 |
| **搜索性能** | 每次按键触发全量重渲染 | 200ms 防抖，减少无效渲染 |
| **列表渲染** | 一次性渲染 740+ DOM 节点 | 分页渲染（48 个/页），按需加载 |
| **CSS 性能** | 无 containment | `contain: layout style paint` |
| **API 错误处理** | `if (res)` 永真判断 | `res && res.ok` + 自动重试 |
| **除零 Bug** | `NaN%` 显示 | `0.0%` 兜底 |
| **竞态条件** | 快速点击显示错误详情 | 请求 ID 机制防止 |
| **日期排序** | NaN 导致不可预测排序 | isNaN 检查回退 0 |
| **Node.js 脚本** | 不检查 HTTP 状态码 | 状态码检查 + 自动重试 + 数据校验 |
| **常量管理** | 魔法字符串分散 | 集中定义，一处修改 |
| **页面映射** | 基于按钮索引 | 基于 `data-page` 属性 |
| **GitHub Actions** | 可能 push 冲突失败 | 先 rebase 再 push |
| **代码规范** | 无严格模式 | `'use strict'` |
| **虚假 API 端点** | 列出后端不存在的接口 | 移除+标注不可用端点 |
| **注册 UX** | 无链接无说明 | 官网链接+白名单邮箱说明 |
| **密码输入** | 无显示/隐藏切换 | 添加密码可见性切换按钮 |
| **无障碍** | 零 ARIA 属性 | dialog+aria-modal+aria-label+label |
| **键盘导航** | 仅截图灯箱支持 Escape | 全局 Escape 关闭所有模态框 |
| **空 catch 块** | 12+ 处静默吞掉错误 | console.warn + showToast 提示 |
| **离线检测** | 无 | 离线横幅+上线提示+apiFetch 重试 |
| **CSS 变量** | 硬编码字号/模糊值 | 8级字号变量+3级模糊预设 |
| **CSS 基类** | 12个组件重复玻璃卡片样式 | `.glass-card` 基类 |
| **内联样式** | 登录提示横幅 60+ 字内联CSS | `.login-prompt-banner` 类 |
| **移动端溢出** | 340px 最小宽度可能溢出 | `min(340px, 100%)` 自适应 |
| **大函数** | openAppDetail 113行 | 拆为5个子函数，主函数60行 |
| **前庭保护** | 无 prefers-reduced-motion | 全局禁用动画 |

---

## 九、后端搭建（Cloudflare Workers + D1 + R2）

### 9.1 概述
为项目新增完整的后端服务，使用 Cloudflare Workers 免费部署。

### 9.2 架构
- **框架**: Hono（轻量级 Workers 框架）
- **数据库**: D1 (SQLite)
- **文件存储**: R2 (APK/图标/截图)
- **认证**: JWT (Web Crypto API)
- **密码**: SHA-256 + salt

### 9.3 API 端点（40+ 个）

| 类别 | 端点 | 数量 |
|------|------|------|
| 认证 | register, login, profile | 3 |
| 应用 | list, detail, upload, recommended, comments, rate, versions, screenshots | 8 |
| 分类 | list | 1 |
| 合集 | list, detail | 2 |
| 捐赠 | leaderboard | 1 |
| 通知 | list, read | 2 |
| 用户 | profile update, avatar, favorites CRUD | 5 |
| 反馈 | submit | 1 |
| 下载 | APK download (auth) | 1 |
| 上传 | APK, icon | 2 |
| 管理员 | stats, apps(pending/approve/ban/edit/delete), users, notifications, rankings | 10+ |

### 9.4 数据库 Schema
16 个表：users, apps, app_variants, app_screenshots, categories, comments, ratings, favorites, collections, collection_apps, notifications, donations, feedback, view_history, download_history

### 9.5 安全特性
- 邮箱域名白名单注册
- JWT Token 认证
- 管理员角色权限中间件
- 邮箱验证中间件（上传功能前置条件）
- CORS 跨域支持
- 默认管理员账号（部署后需改密码）

---

## 十、前端新增功能

### 10.1 应用上传页面
- 三种状态：未登录→登录提示 / 未验证邮箱→验证提示 / 已验证→上传表单
- 上传表单包含：APK文件、图标、应用名、包名、分类、描述、版本信息等
- FormData 提交到 `/api/v1/apps`

### 10.2 管理员面板
- 三种状态：未登录→登录提示 / 非管理员→权限拒绝 / 管理员→面板
- 4 个子页面：概览（统计+最近待审核）、待审核列表（通过/封禁）、用户管理（角色变更）、发送通知
- 使用 `isAdmin()` 检查用户角色

### 10.3 API 地址保留原始代理
- 恢复原始代理 URL（代码中 `API_BASE` 常量直接使用代理地址），确保下载功能正常
- 源码压缩包版本中替换为占位符，用户自行填入自己的代理地址
- GitHub Actions 自动化同步使用官方 API（market.ziling.xin），不使用代理

### 10.4 文档更新
- README 完全重写，移除代理 URL
- 添加后端部署完整步骤
- 添加文件结构更新（含 backend/）
- 版本号更新为 v2.0.0

---

*报告更新时间: 2026-06-28 (第三轮：后端 + 上传/管理 + 文档)*

---

## 第四轮改进（2026-06-28）

### 11. 恢复代码中的代理URL
- `CONFIG` 对象恢复为原始 `API_BASE = 'https://api.tszxzy.dpdns.org/api/v1'` 常量
- 下载链接恢复为原始代理地址 `https://api.tszxzy.dpdns.org/download/...`
- 确保下载功能正常工作

### 12. 下载提示（移动端/电脑端）
- 移动端：提示"部分浏览器可能拦截APK下载（403），如遇拦截请更换浏览器或使用电脑端下载"
- 电脑端：提示"下载可能被浏览器拦截，如弹出警告请点击'保留'继续下载"

### 13. GitHub Actions 使用官方API
- 移除 `secrets.API_BASE` 环境变量配置
- 脚本默认使用 `https://market.ziling.xin/api/v1` 官方源站
- 不使用代理地址进行自动化同步

### 14. 排行榜/捐赠榜头像修复
- 排行榜：没有头像的用户显示昵称首字（而非固定"U"）
- 捐赠榜：非匿名用户显示昵称首字，匿名用户显示"匿"字
- 评论区：同样显示昵称首字/首字母而非"U"
- 所有 `onerror` 处理增加 `this.onerror=null` 防止无限循环

### 15. 开源授权文件
- 添加 MIT License 文件

### 16. 源码压缩包（不含代理URL）
- 打包不含代理URL的源码压缩文件
- 代理地址替换为占位符 `https://your-api-proxy.example.com/api/v1`
- 添加配置提示注释，告知用户需要自行填入代理地址

---

## 第五轮修复（2026-06-28）

### 17. 用户排行榜头像彻底修复
- **根本原因**：`getFallbackAvatar(name)` 在 `.map()` 回调外部调用，此时 `name` 变量未定义（undefined），fallback SVG 始终显示 "U"
- **修复方案**：将 fallback 生成移入 `.map()` 内部，每个用户独立生成
- 捐赠榜不受影响（其 fallback 本来就在 map 内部正确生成）

### 18. GitHub Actions 修复
- Node.js 版本从 20 升级到 22（解决 deprecated 警告）
- 添加 `permissions: contents: write` 显式声明写权限
- 使用 `${GITHUB_REF#refs/heads/}` 动态获取分支名，替代硬编码 main/master
- git pull 失败时不中断流程

---

## 第六轮修复（2026-06-28）

### 19. 邮箱验证校验 Bug 修复
- **根本原因**：前端检查 `user.emailVerified`（驼峰命名），但后端/原始API可能返回 `email_verified`（蛇形命名），字段名不匹配导致永远为 `undefined`，上传页始终提示"未验证邮箱"
- **修复方案**：
  - 新增 `isEmailVerified()` 兼容函数，同时检查 `emailVerified`/`email_verified`/`isEmailVerified`/`is_email_verified` 四种字段名
  - `fetchUserProfile()` 兼容多种响应格式（直接返回/`data`包装/`user`包装），且合并已有用户数据而非覆盖
  - `doLogin()` 同时发送 `username` 和 `email` 字段，兼容原始API和 Cloudflare 后端
  - 登录后始终刷新一次 profile 获取最新验证状态
  - 当验证状态字段不存在时不阻断上传（交由后端校验），避免API字段缺失导致功能不可用

### 20. 项目名称更新
- 移除所有 `-plus` / `Plus` 后缀，统一改为 `lingdate`
- 更新文件：wrangler.toml、package.json、seed.js、index.ts、types.ts、schema.sql、README.md、IMPROVEMENT_REPORT.md、index.html 页脚和仓库链接

### 21. 法律声明合规性修订（多模型合作）
- 使用 reasoning 模型进行合规缺口分析，识别出 8 项缺失法律条款
- 法律声明从 2 条扩展为 10 条完整条款：
  1. 网站性质与定位
  2. 数据来源与缓存机制
  3. **隐私政策与个人信息保护**（PIPL合规：信息收集/使用/存储/跨境传输/用户权利/本地存储）
  4. **用户协议与行为规范**（账号管理/禁止行为/违规处置）
  5. **用户生成内容与知识产权**（内容规范/许可/通知-删除机制/反通知）
  6. **APK下载与上传安全责任**（下载提示/上传者责任/安全举报）
  7. **知识产权与开源许可**（MIT License/第三方IP/致谢）
  8. **免责声明与责任限制**（服务可用性/间接损失/第三方链接）
  9. **法律适用与争议解决**（中国法律/管辖法院）
  10. **声明变更与联系方式**（变更生效/GitHub Issues联系）
- README 法律声明部分同步更新
- 添加"本声明仅供参考，不构成正式法律意见"提示

---

*报告更新时间: 2026-06-28 (第六轮：邮箱验证Bug + 项目改名 + 法律合规修订)*
