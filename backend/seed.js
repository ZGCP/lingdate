#!/usr/bin/env node

/**
 * Seed script to populate D1 database with initial data
 * Usage: node seed.js
 * 
 * This script reads data from ../data/*.json files and inserts into D1
 * Make sure to run 'wrangler d1 create lingdate-plus-db' first
 * And update wrangler.toml with the correct database_id
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Data directory
const dataDir = path.join(__dirname, '..', 'data');

// Read JSON file
function readJSON(filename) {
  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filename} not found, skipping...`);
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// Generate SQL for inserting apps
// Maps from original API JSON field names to D1 schema field names
function generateAppsSQL(apps) {
  if (!apps || !Array.isArray(apps)) return '';

  let sql = '-- Seed apps data\n';
  
  apps.forEach(app => {
    const values = [
      app.id || 'NULL',
      escapeSQL(app.name),
      escapeSQL(app.packageName || app.package_name), // API uses packageName
      escapeSQL(app.developer),
      escapeSQL(app.description || null),
      escapeSQL(app.iconUrl || app.icon_url || null),  // API uses iconUrl
      escapeSQL(app.category || null),
      escapeSQL(app.versionName || app.version_name || null), // API uses versionName
      app.versionCode || app.version_code || 'NULL',    // API uses versionCode
      app.size || app.apkSize || 'NULL',                // API uses apkSize sometimes
      app.downloads || 0,
      app.rating || app.ratingAvg || app.rating_avg || 0, // API uses rating or ratingAvg
      app.ratingCount || app.rating_count || 0,
      app.viewCount || app.view_count || 0,
      escapeSQL(app.status || 'approved'),
      escapeSQL(app.source || null),
      app.minSdk || app.min_sdk || 'NULL',
      app.targetSdk || app.target_sdk || 'NULL',
      app.isWearOS || app.is_wear_os ? 1 : 0,
      app.uploader?.id || app.uploader_id || 'NULL',    // API uses uploader._id
      escapeSQL(app.r2_key || app.apkUrl || null),      // Fallback: use apkUrl as external link
      escapeSQL(app.apkUrl || app.apk_url || null)
    ];

    sql += `INSERT OR IGNORE INTO apps (
      id, name, package_name, developer, description, icon_url, category,
      version_name, version_code, size, downloads, rating_avg, rating_count,
      view_count, status, source, min_sdk, target_sdk, is_wear_os,
      uploader_id, r2_key, apk_url
    ) VALUES (${values.join(', ')});\n`;
  });

  return sql;
}

// Generate SQL for inserting categories
// Maps from original API JSON field names to D1 schema field names
function generateCategoriesSQL(categories) {
  if (!categories || !Array.isArray(categories)) return '';

  let sql = '-- Seed categories data\n';
  
  categories.forEach(cat => {
    const values = [
      cat.id || cat._id || 'NULL',  // API uses _id
      escapeSQL(cat.name),
      escapeSQL(cat.displayName || cat.display_name), // API uses displayName
      escapeSQL(cat.description || null),
      escapeSQL(cat.icon || null),
      cat.order || 0,
      cat.isActive !== undefined ? (cat.isActive ? 1 : 0) : (cat.is_active !== undefined ? (cat.is_active ? 1 : 0) : 1)
    ];

    sql += `INSERT OR IGNORE INTO categories (
      id, name, display_name, description, icon, "order", is_active
    ) VALUES (${values.join(', ')});\n`;
  });

  return sql;
}

// Generate SQL for inserting users
function generateUsersSQL(users) {
  if (!users || !Array.isArray(users)) return '';

  let sql = '-- Seed users data\n';
  
  users.forEach(user => {
    const values = [
      user.id || 'NULL',
      escapeSQL(user.username),
      escapeSQL(user.email),
      escapeSQL(user.password_hash),
      escapeSQL(user.nickname || null),
      escapeSQL(user.avatar_url || null),
      escapeSQL(user.role || 'user'),
      user.email_verified ? 1 : 0
    ];

    sql += `INSERT OR IGNORE INTO users (
      id, username, email, password_hash, nickname, avatar_url, role, email_verified
    ) VALUES (${values.join(', ')});\n`;
  });

  return sql;
}

// Escape SQL string
function escapeSQL(str) {
  if (str === null || str === undefined) return 'NULL';
  if (typeof str === 'number') return str.toString();
  return "'" + str.replace(/'/g, "''") + "'";
}

// Main function
async function main() {
  console.log('🌱 Starting seed process...');

  // Read data files
  console.log('📖 Reading data files...');
  const apps = readJSON('apps.json');
  const categories = readJSON('categories.json');
  const users = readJSON('users.json');

  // Generate SQL
  console.log('📝 Generating SQL...');
  let sql = `-- LingDate Plus Seed Data\n`;
  sql += `-- Generated at: ${new Date().toISOString()}\n\n`;

  if (categories) {
    sql += generateCategoriesSQL(categories);
    sql += '\n';
  }

  if (users) {
    sql += generateUsersSQL(users);
    sql += '\n';
  }

  if (apps) {
    sql += generateAppsSQL(apps);
    sql += '\n';
  }

  // Write SQL to temp file
  const tempSQLFile = path.join(__dirname, 'seed-temp.sql');
  fs.writeFileSync(tempSQLFile, sql, 'utf-8');
  console.log(`💾 SQL written to ${tempSQLFile}`);

  // Execute SQL using wrangler
  try {
    console.log('🚀 Executing SQL on D1 database...');
    execSync(`wrangler d1 execute lingdate-plus-db --file=${tempSQLFile}`, {
      cwd: __dirname,
      stdio: 'inherit'
    });
    console.log('✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Error executing SQL:', error.message);
    process.exit(1);
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempSQLFile)) {
      fs.unlinkSync(tempSQLFile);
      console.log('🧹 Cleaned up temp file');
    }
  }
}

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { generateAppsSQL, generateCategoriesSQL, generateUsersSQL };
