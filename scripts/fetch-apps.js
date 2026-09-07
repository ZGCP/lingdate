const fs = require('fs');
const path = require('path');

/**
 * 应用列表抓取脚本
 *
 * 设计要点：
 * 1. 多线路回退：依次尝试多个 API 源，取「条数最多」的一份，避免因单条代理异常导致数据残缺
 * 2. 分页健壮：按 _id 去重、空页即停、pages 字段异常时用 total 兜底、限制最大页数防死循环
 * 3. 写入保护：新数据条数明显少于仓库现有数据时拒绝覆盖，防止用残缺数据污染仓库
 */

// 线路列表：可通过环境变量 API_BASE 指定首选线路
const SOURCES = [
    process.env.API_BASE,
    'https://market.ziling.xin/api/v3',
    'https://plus.tszxzy.dpdns.org/api/v3',
    'https://date.tszxzy.dpdns.org/api/v3',
    'https://ultra.tszxzy.dpdns.org/api/v3'
].filter(Boolean);

// 去重后的唯一线路（保持顺序）
const UNIQUE_SOURCES = [...new Set(SOURCES.map(s => s.replace(/\/+$/, '')))];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const PAGE_LIMIT = 100;      // 代理只接受 limit=100，其它值返回空
const MAX_PAGES = 60;        // 死循环保护
const MAX_EMPTY_STREAK = 3;  // 连续 3 页无新增才停止（代理分页经常偶发返回重复页）
const REQUEST_TIMEOUT_MS = 30000;
const SAFE_RATIO = 0.8;      // 新数据少于现有数据的 80% 时拒绝覆盖
const MIN_ACCEPT = 100;      // 少于该条数一律视为异常

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function httpGetJson(url, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error(`JSON 解析失败: ${text.slice(0, 80)}`);
            }
        } catch (err) {
            clearTimeout(timer);
            if (attempt === retries) throw err;
            console.warn(`  ⚠️ ${err.message}，重试 (${attempt + 1}/${retries})...`);
            await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
    }
}

// 修复图标URL
function fixIconUrl(url) {
    if (!url) return '';
    return url.replace('http://market.ziling.xin:443', 'https://market.ziling.xin');
}

/**
 * 从单个源拉取全量应用（带去重与死循环保护）
 */
async function fetchAllFrom(base) {
    const seen = new Set();
    const apps = [];
    let total = null;
    let emptyStreak = 0;   // 连续「无新增」页数，容忍代理偶发返回重复/空页

    for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await httpGetJson(`${base}/apps?page=${page}&limit=${PAGE_LIMIT}`);
        const list = Array.isArray(data.apps) ? data.apps : (Array.isArray(data.data) ? data.data : null);
        if (!list) throw new Error(`第 ${page} 页返回格式异常：缺少 apps 数组`);

        if (page === 1 && data.pagination && typeof data.pagination.total === 'number') {
            total = data.pagination.total;
        }

        let added = 0;
        for (const app of list) {
            const key = app._id || app.packageName || `${app.name}-${app.versionCode}`;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            apps.push(app);
            added++;
        }

        // 本页无新增（全是重复或空页）：连续多页如此才判定数据已取完
        if (added === 0) {
            emptyStreak++;
            if (emptyStreak >= MAX_EMPTY_STREAK) break;
        } else {
            emptyStreak = 0;
        }

        // 已达上游声明的总数 → 提前结束
        if (total !== null && apps.length >= total) break;

        // 分页信息缺失或异常 → 以本页是否有数据为准，继续探一页
        const pages = data.pagination && data.pagination.pages;
        if (typeof pages === 'number' && pages > 0 && page >= pages) break;
    }

    return apps.map(app => ({
        ...app,
        iconUrl: fixIconUrl(app.iconUrl),
        logoUrl: fixIconUrl(app.logoUrl)
    }));
}

/**
 * 多线路尝试，返回条数最多的一份
 */
async function fetchBestApps() {
    const results = [];
    for (const base of UNIQUE_SOURCES) {
        console.log(`\n▶ 尝试线路：${base}`);
        try {
            const apps = await fetchAllFrom(base);
            console.log(`  获取 ${apps.length} 个应用`);
            results.push({ base, apps });
            // 已经拿到足够多的数据就不必再试其它线路
            if (apps.length >= 500) break;
        } catch (err) {
            console.warn(`  ✗ 线路失败：${err.message}`);
        }
    }

    if (results.length === 0) {
        throw new Error('所有线路均获取失败，放弃本次更新');
    }

    results.sort((a, b) => b.apps.length - a.apps.length);
    console.log(`\n✅ 选用线路：${results[0].base}（${results[0].apps.length} 个应用）`);
    return results[0].apps;
}

// 获取分类列表（同样多线路回退）
async function fetchCategories() {
    for (const base of UNIQUE_SOURCES) {
        try {
            const data = await httpGetJson(`${base}/categories`);
            const list = Array.isArray(data) ? data : (data.categories || data.data);
            if (Array.isArray(list) && list.length > 0) {
                console.log(`分类列表获取成功：${list.length} 个（${base}）`);
                return list;
            }
        } catch (err) {
            console.warn(`  分类获取失败（${base}）：${err.message}`);
        }
    }
    throw new Error('所有线路的分类列表均获取失败');
}

async function main() {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const appsPath = path.join(dataDir, 'apps.json');
    const catPath = path.join(dataDir, 'categories.json');
    const metaPath = path.join(dataDir, 'meta.json');

    // 记录仓库现有数据量，用于写入保护
    let currentCount = 0;
    if (fs.existsSync(appsPath)) {
        try {
            currentCount = JSON.parse(fs.readFileSync(appsPath, 'utf-8')).length;
        } catch (e) { currentCount = 0; }
    }
    console.log(`仓库现有应用数：${currentCount}`);

    try {
        const apps = await fetchBestApps();

        // ── 写入保护：拒绝用残缺数据覆盖完整数据 ──
        if (apps.length < MIN_ACCEPT) {
            throw new Error(`仅获取 ${apps.length} 个应用（< ${MIN_ACCEPT}），疑似上游接口异常，放弃本次更新`);
        }
        if (currentCount > 0 && apps.length < currentCount * SAFE_RATIO) {
            throw new Error(
                `新数据 ${apps.length} 条 < 现有 ${currentCount} 条的 ${Math.round(SAFE_RATIO * 100)}%` +
                `（阈值 ${Math.ceil(currentCount * SAFE_RATIO)}），判定为上游异常，放弃本次更新以保住现有数据`
            );
        }

        fs.writeFileSync(appsPath, JSON.stringify(apps, null, 2), 'utf-8');
        console.log(`应用列表已保存：${apps.length} 条`);

        let categories = null;
        try {
            categories = await fetchCategories();
            fs.writeFileSync(catPath, JSON.stringify(categories, null, 2), 'utf-8');
        } catch (err) {
            console.warn(`分类列表未更新：${err.message}`);
        }

        let prev = {};
        if (fs.existsSync(metaPath)) {
            try { prev = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) { prev = {}; }
        }
        fs.writeFileSync(metaPath, JSON.stringify({
            updatedAt: new Date().toISOString(),
            totalApps: apps.length,
            totalCategories: categories ? categories.length : (prev.totalCategories || 0)
        }, null, 2), 'utf-8');

        console.log('✅ 数据抓取完成！');
    } catch (err) {
        console.error('❌ 抓取失败:', err.message);
        process.exit(1);
    }
}

main();
