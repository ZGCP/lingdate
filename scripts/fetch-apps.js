const fs = require('fs');
const path = require('path');

/**
 * 应用列表抓取脚本
 *
 * 背景：代理/上游接口目前极不稳定 —— 同一个 URL 有时返回 100 条、有时 10 条、有时 0 条，
 * 分页字段（pages/total）也会互相矛盾，且会把失败结果缓存下来。
 *
 * 因此本脚本采用「合并更新」策略，而不是简单覆盖：
 *   1. 多线路（Plus / 源站 / Date / Ultra）全部尝试，结果去重合并
 *   2. 每页多次重试 + 请求间隔，尽量绕开上游的间歇性失败
 *   3. 与仓库现有数据合并：新数据覆盖同 _id 的旧数据，新出现的补进去，旧的一律不删
 *      —— 上游正常时是完整更新；上游抽风时至少不丢数据
 */

const SOURCES = [
    process.env.API_BASE,
    'https://plus.tszxzy.dpdns.org/api/v3',
    'https://market.ziling.xin/api/v3',
    'https://date.tszxzy.dpdns.org/api/v3',
    'https://ultra.tszxzy.dpdns.org/api/v3'
].filter(Boolean);
const UNIQUE_SOURCES = [...new Set(SOURCES.map(s => s.replace(/\/+$/, '')))];

const PAGE_LIMIT = 100;          // 代理只接受 limit=100
const MAX_PAGES = 60;            // 死循环保护
const PAGE_RETRIES = 5;          // 每页重试次数（上游间歇性失败，需要多试几次）
const PAGE_RETRY_DELAY = 2000;   // 重试基础间隔（ms），实际按 2s/4s/6s/8s 递增
const PAGE_INTERVAL = 1200;      // 页与页之间的间隔（ms），避免触发限流
const REQUEST_TIMEOUT_MS = 30000;
const REPLACE_RATIO = 0.8;       // 新数据 >= 现有 80% 时判定上游正常，直接替换
const HEALTHY_COUNT = 500;       // 或新数据条数达到该值，也判定为完整
const MIN_FRESH = 20;            // 少于该条数视为线路异常，不参与合并

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function httpGetJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        try { return JSON.parse(text); } catch (e) { throw new Error('JSON 解析失败: ' + text.slice(0, 80)); }
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

function fixIconUrl(url) {
    if (!url) return '';
    return url.replace('http://market.ziling.xin:443', 'https://market.ziling.xin');
}

const keyOf = a => a._id || a.packageName || `${a.name}-${a.versionCode}`;

/**
 * 抓取单页：两种参数顺序都试（代理对参数顺序敏感），多次重试取条数最多的一次
 */
async function fetchPage(base, page) {
    const urls = [
        `${base}/apps?limit=${PAGE_LIMIT}&page=${page}`,
        `${base}/apps?page=${page}&limit=${PAGE_LIMIT}`
    ];
    let best = { list: [], pagination: null };
    for (let attempt = 0; attempt < PAGE_RETRIES; attempt++) {
        for (const url of urls) {
            try {
                const data = await httpGetJson(url);
                const list = Array.isArray(data.apps) ? data.apps : (Array.isArray(data.data) ? data.data : []);
                if (list.length > best.list.length) best = { list, pagination: data.pagination || null };
                if (best.list.length >= PAGE_LIMIT) return best;   // 拿满，直接返回
            } catch (e) { /* 忽略，继续重试 */ }
        }
        if (attempt < PAGE_RETRIES - 1) await sleep(PAGE_RETRY_DELAY * (attempt + 1));  // 指数退避，等缓存失效
    }
    return best;
}

/**
 * 从单个源拉取（带去重与容错）
 */
async function fetchFromSource(base) {
    const seen = new Set();
    const apps = [];
    let pagesHint = 1;
    let consecutiveFail = 0;
    let total = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
        const { list, pagination } = await fetchPage(base, page);

        if (pagination && typeof pagination.pages === 'number' && pagination.pages > pagesHint) {
            pagesHint = Math.min(pagination.pages, MAX_PAGES);
        }
        if (pagination && typeof pagination.total === 'number') total = pagination.total;

        let added = 0;
        for (const app of list) {
            const k = keyOf(app);
            if (!k || seen.has(k)) continue;
            seen.add(k);
            apps.push(app);
            added++;
        }

        if (added === 0) {
            consecutiveFail++;
            console.log(`    第 ${page} 页无新增（返回 ${list.length} 条）`);
            if (consecutiveFail >= 3) break;   // 连续 3 页无收获，判定该线路已取完/不可用
        } else {
            consecutiveFail = 0;
            console.log(`    第 ${page} 页 +${added}（累计 ${apps.length}）`);
        }

        if (total && apps.length >= total) break;
        if (page >= pagesHint) break;
        await sleep(PAGE_INTERVAL);
    }

    return apps.map(app => ({
        ...app,
        iconUrl: fixIconUrl(app.iconUrl),
        logoUrl: fixIconUrl(app.logoUrl)
    }));
}

/**
 * 遍历所有线路，合并去重
 */
async function fetchMergedApps() {
    const merged = new Map();
    const perSource = [];

    for (const base of UNIQUE_SOURCES) {
        console.log(`\n▶ 线路：${base}`);
        try {
            const apps = await fetchFromSource(base);
            console.log(`  本线路获取 ${apps.length} 个应用`);
            perSource.push({ base, count: apps.length });
            if (apps.length >= MIN_FRESH) {
                for (const a of apps) {
                    const k = keyOf(a);
                    if (!k) continue;
                    const exist = merged.get(k);
                    // 同一应用取字段更完整的一份
                    if (!exist || Object.keys(a).length > Object.keys(exist).length) merged.set(k, a);
                }
            } else {
                console.log(`  ⚠️ 条数过少（< ${MIN_FRESH}），不参与合并`);
            }
        } catch (err) {
            console.warn(`  ✗ 线路失败：${err.message}`);
        }
    }

    return { fresh: [...merged.values()], perSource };
}

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
    return null;
}

async function main() {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const appsPath = path.join(dataDir, 'apps.json');
    const catPath = path.join(dataDir, 'categories.json');
    const metaPath = path.join(dataDir, 'meta.json');

    // 读取仓库现有数据，作为合并基底
    let currentApps = [];
    if (fs.existsSync(appsPath)) {
        try {
            currentApps = JSON.parse(fs.readFileSync(appsPath, 'utf-8'));
            if (!Array.isArray(currentApps)) currentApps = [];
        } catch (e) { currentApps = []; }
    }
    console.log(`仓库现有应用数：${currentApps.length}`);

    let fresh = [];
    try {
        const r = await fetchMergedApps();
        fresh = r.fresh;
        console.log('\n各线路结果：' + r.perSource.map(x => `${x.count}`).join(' / '));
    } catch (err) {
        console.warn('抓取过程异常：' + err.message);
    }
    console.log(`\n本次共获取（多线路合并去重）：${fresh.length} 个应用`);

    let finalApps, mode;
    if (fresh.length === 0) {
        // 一条都没抓到：原样保留，不算构建失败
        if (currentApps.length === 0) {
            console.error('❌ 上游无数据且仓库也没有历史数据，无法继续');
            process.exit(1);
        }
        finalApps = currentApps;
        mode = 'skipped';
        console.log('⚠️ 上游本次完全无响应，保留现有数据（不视为失败）');
    } else if (currentApps.length === 0 || fresh.length >= HEALTHY_COUNT || fresh.length >= currentApps.length * REPLACE_RATIO) {
        // 上游正常：直接替换
        finalApps = fresh;
        mode = 'replaced';
        console.log(`✅ 上游数据完整（${fresh.length} 条），替换现有 ${currentApps.length} 条`);
    } else {
        // 上游残缺：与现有数据合并，保住历史数据
        const map = new Map();
        for (const a of currentApps) { const k = keyOf(a); if (k) map.set(k, a); }
        let updated = 0, added = 0;
        for (const a of fresh) {
            const k = keyOf(a);
            if (!k) continue;
            if (map.has(k)) updated++; else added++;
            map.set(k, a);
        }
        finalApps = [...map.values()];
        mode = 'merged';
        console.log(`⚠️ 上游数据残缺（仅 ${fresh.length} 条 < 现有 ${currentApps.length} 条的 ${Math.round(REPLACE_RATIO * 100)}%）`);
        console.log(`   采用合并模式：更新 ${updated} 条、新增 ${added} 条、保留 ${currentApps.length - updated} 条 → 最终 ${finalApps.length} 条`);
    }

    // 按更新时间倒序，保证列表顺序稳定
    finalApps.sort((a, b) => new Date(b.updatedAt || b.latestVersionAt || 0) - new Date(a.updatedAt || a.latestVersionAt || 0));

    fs.writeFileSync(appsPath, JSON.stringify(finalApps, null, 2), 'utf-8');
    console.log(`\n应用列表已保存：${finalApps.length} 条`);

    let prev = {};
    if (fs.existsSync(metaPath)) {
        try { prev = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) { prev = {}; }
    }
    let categories = null;
    if (mode !== 'skipped') categories = await fetchCategories();
    if (categories) {
        fs.writeFileSync(catPath, JSON.stringify(categories, null, 2), 'utf-8');
    } else {
        console.warn('分类列表本次未更新，沿用旧值');
    }

    fs.writeFileSync(metaPath, JSON.stringify({
        updatedAt: new Date().toISOString(),
        totalApps: finalApps.length,
        totalCategories: categories ? categories.length : (prev.totalCategories || 0),
        lastSyncMode: mode,
        lastFreshCount: fresh.length
    }, null, 2), 'utf-8');

    console.log('✅ 完成（模式：' + mode + '）');
    process.exit(0);
}

main();
