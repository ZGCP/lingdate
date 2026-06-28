const https = require('https');
const fs = require('fs');
const path = require('path');

// API 地址：默认从灵应用商店源站获取，可通过环境变量覆盖
const API_BASE = process.env.API_BASE || 'https://market.ziling.xin/api/v1';
const CYCLE_DAYS = 90;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_DELAY_MS = 200; // 请求间隔，避免过快

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
                        res.resume();
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

// 计算今天是周期中的第几天
function getDayOfCycle() {
    // 用一个固定的起始日期（2026-01-01）
    const startDate = new Date('2026-01-01T00:00:00Z');
    const today = new Date();
    const diffTime = today - startDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays % CYCLE_DAYS;
}

// 获取今天要更新的应用索引范围
function getTodayAppRange(totalApps) {
    const dayOfCycle = getDayOfCycle();
    const appsPerDay = Math.ceil(totalApps / CYCLE_DAYS);
    const startIndex = dayOfCycle * appsPerDay;
    const endIndex = Math.min(startIndex + appsPerDay, totalApps);
    return { startIndex, endIndex, dayOfCycle, appsPerDay };
}

// 延迟函数，避免请求太快
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 主函数
async function main() {
    try {
        const dataDir = path.join(__dirname, '..', 'data');
        const appsPath = path.join(dataDir, 'apps.json');
        const detailPath = path.join(dataDir, 'apps-detail.json');

        // 读取应用列表
        if (!fs.existsSync(appsPath)) {
            console.error('❌ 请先运行 fetch-apps.js 获取应用列表');
            process.exit(1);
        }
        const apps = JSON.parse(fs.readFileSync(appsPath, 'utf-8'));
        if (!Array.isArray(apps) || apps.length === 0) {
            console.error('❌ 应用列表数据为空或格式异常');
            process.exit(1);
        }
        console.log(`应用总数: ${apps.length}`);

        // 读取现有详情数据
        let detailData = {};
        if (fs.existsSync(detailPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(detailPath, 'utf-8'));
                detailData = existing.apps || {};
                console.log(`已有详情数据: ${Object.keys(detailData).length} 个应用`);
            } catch (e) {
                console.warn(`  ⚠️ 读取现有详情数据失败: ${e.message}，将从头开始`);
                detailData = {};
            }
        }

        // 计算今天要更新的应用
        const { startIndex, endIndex, dayOfCycle, appsPerDay } = getTodayAppRange(apps.length);
        const appsToUpdate = apps.slice(startIndex, endIndex);
        console.log(`周期第 ${dayOfCycle + 1}/${CYCLE_DAYS} 天，今天更新第 ${startIndex + 1} - ${endIndex} 个应用（共 ${appsToUpdate.length} 个）`);

        // 抓取应用详情
        let successCount = 0;
        let failCount = 0;
        for (let i = 0; i < appsToUpdate.length; i++) {
            const app = appsToUpdate[i];
            try {
                console.log(`[${i + 1}/${appsToUpdate.length}] 正在获取: ${app.name}...`);
                const detail = await fetch(`${API_BASE}/apps/${app._id}`);

                // 修复图标URL
                detail.iconUrl = fixIconUrl(detail.iconUrl);
                detail.logoUrl = fixIconUrl(detail.logoUrl);
                if (detail.uploader) {
                    detail.uploader.avatarUrl = fixIconUrl(detail.uploader.avatarUrl);
                }

                detailData[app._id] = detail;
                successCount++;

                // 延迟，避免请求太快
                await sleep(REQUEST_DELAY_MS);
            } catch (err) {
                console.warn(`  ⚠️ 获取失败: ${app.name} - ${err.message}`);
                failCount++;
            }
        }

        // 保存详情数据
        const output = {
            updatedAt: new Date().toISOString(),
            totalApps: apps.length,
            detailCount: Object.keys(detailData).length,
            cycleDay: dayOfCycle,
            apps: detailData
        };
        fs.writeFileSync(detailPath, JSON.stringify(output, null, 2), 'utf-8');

        console.log(`\n✅ 详情更新完成！`);
        console.log(`   成功: ${successCount}/${appsToUpdate.length} 个`);
        if (failCount > 0) console.log(`   失败: ${failCount}/${appsToUpdate.length} 个`);
        console.log(`   详情总数: ${Object.keys(detailData).length} 个`);
        console.log(`   已保存到: data/apps-detail.json`);

    } catch (err) {
        console.error('❌ 详情更新失败:', err.message);
        process.exit(1);
    }
}

main();
