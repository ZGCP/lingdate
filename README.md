# 灵应用商店数据排行 - 第三方拓展版

![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Deployed-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
![Version](https://img.shields.io/badge/Version-2.0.0-orange?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)

> ⚠️ **非官方 · 第三方拓展版** · 数据来源：[ziling.xin](https://ziling.xin) · 仅供技术学习与交流

基于 [TSZX-zg/lingstore](https://github.com/TSZX-zg/lingstore) 开源项目拓展开发的第三方灵应用商店数据排行网站。

**在线演示：** https://tszx-zg.github.io/lingstore-plus/

---

## ✨ 功能特点

### 基础功能
- 📊 **全量数据**：展示全部 740+ 个应用，不只是前 100 个
- 🔍 **智能搜索**：支持应用名称、包名、开发者搜索（防抖优化）
- 📁 **分类筛选**：22 个分类，精准查找
- 📈 **多种排序**：下载量、名称、大小、上架时间（升序/降序）
- 🏆 **排行榜**：下载量排行、评分排行、大小排行、上传量排行
- 💝 **捐赠榜单**：展示项目捐赠者
- 📜 **法律声明**：完整的合规声明
- 🎨 **深色主题**：护眼的液态玻璃界面设计
- 📱 **移动端适配**：支持手机端浏览
- 📄 **分页渲染**：每页 48 个应用，避免一次性渲染过多 DOM

### 拓展功能（Plus 版新增）
- 🔐 **登录功能**：支持账号登录，Token 本地存储
- ⭐ **应用评分**：登录后可对应用进行 5 星评分
- 💬 **评论功能**：登录后可发表评论、查看评论列表
- 📥 **APK 下载**：登录后可下载应用 APK
- 📋 **版本历史**：登录后可查看应用的历史版本列表
- 🔄 **双视图切换**：网格视图 / 列表视图
- 🔍 **零下载筛选**：可筛选出 0 下载的应用
- ⚡ **缓存降级机制**：优先加载缓存，失败自动降级为实时 API

### v2.0.0 新增功能
- 🔔 **通知中心**：系统通知列表，支持标记已读
- 📚 **应用合集**：浏览官方和用户创建的应用合集
- 👤 **个人资料**：支持修改昵称、上传头像
- ⭐ **我的收藏**：查看收藏的应用列表
- 📜 **浏览历史**：查看应用浏览历史记录
- 📥 **下载历史**：前端记录下载历史，最多保存 100 条
- 💬 **意见反馈**：支持提交 Bug 反馈、功能建议等
- 📤 **应用上传**：登录并验证邮箱后可上传应用 APK
- 🛡️ **管理面板**：管理员可审核应用、管理用户、发送通知
- 🔒 **XSS 安全防护**：所有用户数据经过 HTML 转义
- ♿ **无障碍支持**：ARIA 属性、键盘导航、减弱动画偏好
- 🌐 **离线检测**：自动检测网络状态，断网时显示提示
- 🔁 **API 重试**：网络请求自动重试 1 次
- ⚡ **性能优化**：CSS containment、分页渲染、搜索防抖

---

## 🏗️ 后端部署（Cloudflare Workers）

本项目提供完整的 Cloudflare Workers 后端，免费部署。

### 1. 安装依赖
```bash
cd backend
npm install
```

### 2. 创建 D1 数据库
```bash
wrangler d1 create lingdate-plus-db
```
将返回的 `database_id` 填入 `backend/wrangler.toml` 中。

### 3. 初始化数据库
```bash
wrangler d1 execute lingdate-plus-db --file=src/schema.sql
```

### 4. 创建 R2 存储桶
在 Cloudflare Dashboard 中创建名为 `lingdate-plus-storage` 的 R2 存储桶，或修改 `wrangler.toml` 中的 `bucket_name`。

### 5. 配置密钥
编辑 `backend/wrangler.toml`，修改 `JWT_SECRET` 为一个强密钥：
```toml
[vars]
JWT_SECRET = "你的强密钥"
ALLOWED_EMAIL_DOMAINS = "qq.com,163.com,gmail.com,outlook.com,hotmail.com,icloud.com,ziling.xin"
```

### 6. 种子数据（可选）
从 `data/` 目录的 JSON 文件导入初始数据到 D1：
```bash
node seed.js
```

### 7. 本地开发
```bash
npm run dev
```

### 8. 部署到 Cloudflare
```bash
npm run deploy
```

### 9. 配置前端 API 地址
部署完成后，编辑 `index.html` 中的 `API_BASE` 常量和下载地址：
```javascript
const API_BASE = 'https://你的worker域名.workers.dev/api/v1';
// 下载地址也需要修改（handleDownload 函数中）
```

如果使用 Cloudflare Workers 后端，请同时修改 `index.html` 中 `handleDownload` 函数里的下载地址。

### 默认管理员账号
- 用户名：`admin`
- 密码：`admin123`
- ⚠️ **请在部署后立即修改密码和 JWT_SECRET！**

---

## 📦 前端部署

### 1. 上传到 GitHub 仓库
将所有文件（不含 `backend/` 目录）上传到你的 GitHub 仓库。

### 2. 开启 GitHub Pages
1. 进入仓库 Settings → Pages
2. Source 选择 "Deploy from a branch"
3. Branch 选择 main / root
4. 点击 Save

### 3. 配置 GitHub Actions 权限（重要！）
1. 进入仓库 Settings → Actions → General
2. 找到 "Workflow permissions"
3. 选择 "Read and write permissions"
4. 点击 Save

### 4. 可选：配置 API 地址
如需使用自定义后端，在仓库 Settings → Secrets 中添加 `API_BASE` secret。

### 5. 手动触发第一次更新
1. 进入仓库 Actions
2. 选择 "Update Apps Data"
3. 点击 "Run workflow"

---

## 🚀 缓存机制

### 应用列表更新
- **频率**：每天 5 次
- **时间**：北京时间 00:00 / 06:00 / 12:00 / 18:00 / 22:00

### 应用详情更新
- **频率**：每天 1 次
- **周期**：90 天滚动更新

### 降级机制
- 优先加载静态缓存数据
- 如果缓存不可用，自动降级为实时 API 调用

---

## 📁 文件结构

```
lingstore-plus/
├── index.html              # 主页面（单文件，包含 CSS 和 JS）
├── README.md               # 说明文档
├── data/                   # 数据目录（由脚本生成）
│   ├── apps.json           # 应用列表数据
│   ├── categories.json     # 分类数据
│   ├── meta.json           # 元数据
│   └── apps-detail.json    # 应用详情数据
├── scripts/                # 脚本目录
│   ├── fetch-apps.js       # 应用列表抓取脚本
│   └── fetch-detail.js     # 应用详情抓取脚本
├── backend/                # 后端目录（Cloudflare Workers）
│   ├── wrangler.toml       # Workers 配置
│   ├── package.json        # 依赖配置
│   ├── src/                # 源代码
│   │   ├── index.ts        # API 路由入口
│   │   ├── db.ts           # 数据库操作
│   │   ├── middleware.ts    # 认证/权限中间件
│   │   ├── types.ts        # 类型定义
│   │   ├── utils.ts        # JWT/密码/验证工具
│   │   └── schema.sql      # 数据库 Schema
│   └── seed.js             # 数据种子脚本
└── .github/
    └── workflows/          # GitHub Actions 配置
        ├── update-apps.yml
        └── update-detail.yml
```

---

## 💻 本地运行

### 本地抓取数据
```bash
# 使用默认源站
node scripts/fetch-apps.js

# 使用自定义后端
API_BASE=https://your-api.example.com/api/v1 node scripts/fetch-apps.js

# 抓取详情（需要先有应用列表）
node scripts/fetch-detail.js
```

### 本地预览网站
```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

### 本地运行后端
```bash
cd backend
npm install
npm run dev
```

---

## 🛠️ 技术栈

- **前端**：纯 HTML/CSS/JavaScript，无框架依赖
- **后端**：Cloudflare Workers + Hono + D1 + R2
- **数据**：灵应用商店公开 API
- **部署**：GitHub Pages（前端）+ Cloudflare Workers（后端）
- **自动化**：GitHub Actions

---

## 📜 法律声明与合规

### 非官方声明
本项目系由个人开发者独立维护的开源技术演示项目，为灵应用商店的**第三方拓展版**，与灵应用商店官方团队（ziling.xin）无任何隶属、合作或关联关系。

### 数据来源
所有应用元数据均来自灵应用商店官方公开 API（ziling.xin）。本项目**仅缓存公开元数据用于展示**。

### 隐私保护
- 登录凭据仅存储于浏览器本地（localStorage）
- 后端不记录用户个人数据
- 上传的 APK 文件存储于 Cloudflare R2，不对外公开下载链接

---

## ⚠️ 免责声明

本项目仅供技术交流与学习研究之用。所有应用的知识产权归其 respective 所有者所有。

---

## 📄 开源协议

MIT License

---

## 🙏 致谢

- 感谢 [TSZX-zg/lingstore](https://github.com/TSZX-zg/lingstore) 提供的基础项目
- 感谢 [灵应用商店 ziling.xin](https://ziling.xin) 提供的公开 API
- 感谢所有捐赠者的支持
