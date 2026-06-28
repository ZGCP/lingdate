const https = require('https');
const fs = require('fs');
const path = require('path');

// API 地址：默认从灵应用商店源站获取，可通过环境变量覆盖
const API_BASE = process.env.API_BASE || 'https://market.ziling.xin/api/v1';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * 封装 fetch 函数，增加 HTTP 状态码检查和重试机制
 * @param {string} url - 请求地址
 * @param {number} retries - 重试次数
 * @returns {Promise<object>} 解析后的 JSON 数据
 */
function fetch(url, retries = MAX_RETRIES) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            https.get(url, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const err = new Error(`HTTP ${res.statusCode}: ${url}`);
                    if (n > 0) {
                        console.warn(`  ⚠️ HTTP ${res.statusCode}, 重试 (${n}/${MAX_RETRIES})...`);
                        setTimeout(() => attempt(n - 1), RETRY_DELAY_MS);
                        res.resume(); // 丢弃响应体
                        return;
                    }
                    reject(err);
                    res.resume();
                    return;
                }
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`JSON 解析失败 (${url}): ${e.message}`));
                    }
                });
            }).on('error', (err) => {
                if (n > 0) {
                    console.warn(`  ⚠️ 网络错误: ${err.message}, 重试 (${n}/${MAX_RETRIES})...`);
                    setTimeout(() => attempt(n - 1), RETRY_DELAY_MS);
                } else {
                    reject(err);
                }
            });
        };
        attempt(retries);
    });
}

// 修复图标URL
function fixIconUrl(url) {
    if (!url) return '';
    return url.replace('http://market.ziling.xin:443', 'https://market.ziling.xin');
}

// 全量获取应用列表
async function fetchAllApps() {
    let page = 1;
    let apps = [];
    while (true) {
        console.log(`正在获取第 ${page} 页...`);
        const data = await fetch(`${API_BASE}/apps?page=${page}&limit=100`);
        if (!data.apps || !Array.isArray(data.apps)) {
            throw new Error(`第 ${page} 页返回数据格式异常：缺少 apps 数组`);
        }
        apps = apps.concat(data.apps);
        // 安全处理分页信息缺失的情况
        if (!data.pagination || !data.pagination.pages) {
            console.warn('  ⚠️ 分页信息缺失，单页获取结束');
            break;
        }
        if (page >= data.pagination.pages) break;
        page++;
    }
    // 修复所有应用的图标URL
    apps = apps.map(app => ({
        ...app,
        iconUrl: fixIconUrl(app.iconUrl),
        logoUrl: fixIconUrl(app.logoUrl)
    }));
    console.log(`共获取 ${apps.length} 个应用`);
    return apps;
}

// 获取分类列表
async function fetchCategories() {
    console.log('正在获取分类列表...');
    const categories = await fetch(`${API_BASE}/categories`);
    if (!Array.isArray(categories)) {
        throw new Error('分类列表返回数据格式异常：非数组类型');
    }
    console.log(`共获取 ${categories.length} 个分类`);
    return categories;
}

// 主函数
async function main() {
    try {
        const dataDir = path.join(__dirname, '..', 'data');

        // 确保数据目录存在
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // 获取应用列表
        const apps = await fetchAllApps();
        fs.writeFileSync(
            path.join(dataDir, 'apps.json'),
            JSON.stringify(apps, null, 2),
            'utf-8'
        );
        console.log('应用列表已保存到 data/apps.json');

        // 获取分类列表
        const categories = await fetchCategories();
        fs.writeFileSync(
            path.join(dataDir, 'categories.json'),
            JSON.stringify(categories, null, 2),
            'utf-8'
        );
        console.log('分类列表已保存到 data/categories.json');

        // 保存更新时间
        const meta = {
            updatedAt: new Date().toISOString(),
            totalApps: apps.length,
            totalCategories: categories.length
        };
        fs.writeFileSync(
            path.join(dataDir, 'meta.json'),
            JSON.stringify(meta, null, 2),
            'utf-8'
        );
        console.log('元数据已保存到 data/meta.json');

        console.log('✅ 数据抓取完成！');
    } catch (err) {
        console.error('❌ 抓取失败:', err.message);
        process.exit(1);
    }
}

main();
