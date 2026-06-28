// Database helper functions for D1

import type { D1Database } from '@cloudflare/workers-types';
import type {
  User,
  UserSafe,
  App,
  AppWithUploader,
  AppVariant,
  AppScreenshot,
  Category,
  Comment,
  Rating,
  Favorite,
  Collection,
  Notification,
  Donation,
  Feedback,
  PaginatedResponse
} from './types';

export class DB {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // ==================== User Operations ====================

  async createUser(userData: {
    username: string;
    email: string;
    password_hash: string;
    nickname?: string;
  }): Promise<User> {
    const result = await this.db.prepare(
      `INSERT INTO users (username, email, password_hash, nickname, email_verified) 
       VALUES (?, ?, ?, ?, 0)`
    )
      .bind(userData.username, userData.email, userData.password_hash, userData.nickname || null)
      .run();

    return await this.getUserById(result.meta.last_row_id as number) as User;
  }

  async getUserById(id: number): Promise<User | null> {
    const result = await this.db.prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<User>();
    return result || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.db.prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<User>();
    return result || null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const result = await this.db.prepare('SELECT * FROM users WHERE username = ?')
      .bind(username)
      .first<User>();
    return result || null;
  }

  async updateUser(id: number, data: Partial<User>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    fields.push('updated_at = unixepoch()');
    values.push(id);

    await this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  async getUserSafeById(id: number): Promise<UserSafe | null> {
    const result = await this.db.prepare(
      `SELECT id, username, email, nickname, avatar_url, role, email_verified, created_at 
       FROM users WHERE id = ?`
    )
      .bind(id)
      .first<UserSafe>();
    return result || null;
  }

  // ==================== App Operations ====================

  async createApp(appData: Partial<App>): Promise<App> {
    const result = await this.db.prepare(
      `INSERT INTO apps (
        name, package_name, developer, description, icon_url, category,
        version_name, version_code, size, source, min_sdk, target_sdk,
        is_wear_os, uploader_id, r2_key, apk_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        appData.name,
        appData.package_name,
        appData.developer,
        appData.description || null,
        appData.icon_url || null,
        appData.category || null,
        appData.version_name || null,
        appData.version_code || null,
        appData.size || null,
        appData.source || null,
        appData.min_sdk || null,
        appData.target_sdk || null,
        appData.is_wear_os || 0,
        appData.uploader_id || null,
        appData.r2_key || null,
        appData.apk_url || null,
        appData.status || 'pending'
      )
      .run();

    return await this.getAppById(result.meta.last_row_id as number) as App;
  }

  async getAppById(id: number): Promise<AppWithUploader | null> {
    const result = await this.db.prepare(
      `SELECT a.*, u.username as uploader_username, u.nickname as uploader_nickname
       FROM apps a
       LEFT JOIN users u ON a.uploader_id = u.id
       WHERE a.id = ?`
    )
      .bind(id)
      .first<AppWithUploader>();
    return result || null;
  }

  async getAppByPackageName(packageName: string): Promise<App | null> {
    const result = await this.db.prepare('SELECT * FROM apps WHERE package_name = ?')
      .bind(packageName)
      .first<App>();
    return result || null;
  }

  async updateApp(id: number, data: Partial<App>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && key !== 'uploader_username' && key !== 'uploader_nickname') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    fields.push('updated_at = unixepoch()');
    values.push(id);

    await this.db.prepare(`UPDATE apps SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  async deleteApp(id: number): Promise<void> {
    await this.db.prepare('DELETE FROM apps WHERE id = ?')
      .bind(id)
      .run();
  }

  async getApps(params: {
    page: number;
    limit: number;
    category?: string | null;
    search?: string | null;
    sort?: string;
    zeroOnly?: boolean;
    status?: string;
  }): Promise<{ apps: AppWithUploader[]; total: number }> {
    let whereClause = 'WHERE 1=1';
    const queryParams: any[] = [];

    if (params.status) {
      whereClause += ' AND a.status = ?';
      queryParams.push(params.status);
    } else {
      whereClause += ' AND a.status = "approved"';
    }

    if (params.category && params.category !== 'all') {
      whereClause += ' AND a.category = ?';
      queryParams.push(params.category);
    }

    if (params.search) {
      whereClause += ' AND (a.name LIKE ? OR a.developer LIKE ? OR a.description LIKE ?)';
      const searchPattern = `%${params.search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    if (params.zeroOnly) {
      whereClause += ' AND a.downloads = 0';
    }

    const sortClause = this.getSortClause(params.sort || 'downloads-desc');

    // Get total count
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM apps a ${whereClause}`
    )
      .bind(...queryParams)
      .first<{ total: number }>();

    const total = countResult?.total || 0;

    // Get paginated results
    const offset = (params.page - 1) * params.limit;
    const apps = await this.db.prepare(
      `SELECT a.*, u.username as uploader_username, u.nickname as uploader_nickname
       FROM apps a
       LEFT JOIN users u ON a.uploader_id = u.id
       ${whereClause}
       ORDER BY a.${sortClause}
       LIMIT ? OFFSET ?`
    )
      .bind(...queryParams, params.limit, offset)
      .all<AppWithUploader>();

    return { apps: apps.results || [], total };
  }

  async getRecommendedApps(limit: number = 8): Promise<AppWithUploader[]> {
    const result = await this.db.prepare(
      `SELECT a.*, u.username as uploader_username, u.nickname as uploader_nickname
       FROM apps a
       LEFT JOIN users u ON a.uploader_id = u.id
       WHERE a.status = 'approved'
       ORDER BY a.downloads DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<AppWithUploader>();

    return result.results || [];
  }

  async incrementAppDownloads(id: number): Promise<void> {
    await this.db.prepare('UPDATE apps SET downloads = downloads + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  async incrementAppViews(id: number): Promise<void> {
    await this.db.prepare('UPDATE apps SET view_count = view_count + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  async updateAppRating(id: number): Promise<void> {
    const result = await this.db.prepare(
      `SELECT AVG(rating) as avg_rating, COUNT(*) as count_rating
       FROM ratings
       WHERE app_id = ?`
    )
      .bind(id)
      .first<{ avg_rating: number; count_rating: number }>();

    if (result) {
      await this.db.prepare(
        'UPDATE apps SET rating_avg = ?, rating_count = ? WHERE id = ?'
      )
        .bind(result.avg_rating || 0, result.count_rating || 0, id)
        .run();
    }
  }

  // ==================== App Variants Operations ====================

  async createAppVariant(variantData: Partial<AppVariant>): Promise<AppVariant> {
    const result = await this.db.prepare(
      `INSERT INTO app_variants (app_id, variant_key, version_name, version_code, size, r2_key)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        variantData.app_id,
        variantData.variant_key,
        variantData.version_name,
        variantData.version_code,
        variantData.size || null,
        variantData.r2_key || null
      )
      .run();

    return await this.getAppVariantById(result.meta.last_row_id as number) as AppVariant;
  }

  async getAppVariantById(id: number): Promise<AppVariant | null> {
    const result = await this.db.prepare('SELECT * FROM app_variants WHERE id = ?')
      .bind(id)
      .first<AppVariant>();
    return result || null;
  }

  async getAppVariantsByAppId(appId: number): Promise<AppVariant[]> {
    const result = await this.db.prepare(
      'SELECT * FROM app_variants WHERE app_id = ? ORDER BY version_code DESC'
    )
      .bind(appId)
      .all<AppVariant>();

    return result.results || [];
  }

  // ==================== App Screenshots Operations ====================

  async addAppScreenshot(appId: number, screenshotUrl: string, order: number = 0): Promise<void> {
    await this.db.prepare(
      'INSERT INTO app_screenshots (app_id, screenshot_url, "order") VALUES (?, ?, ?)'
    )
      .bind(appId, screenshotUrl, order)
      .run();
  }

  async getAppScreenshots(appId: number): Promise<AppScreenshot[]> {
    const result = await this.db.prepare(
      'SELECT * FROM app_screenshots WHERE app_id = ? ORDER BY "order" ASC'
    )
      .bind(appId)
      .all<AppScreenshot>();

    return result.results || [];
  }

  async deleteAppScreenshots(appId: number): Promise<void> {
    await this.db.prepare('DELETE FROM app_screenshots WHERE app_id = ?')
      .bind(appId)
      .run();
  }

  // ==================== Category Operations ====================

  async getCategories(): Promise<Category[]> {
    const result = await this.db.prepare(
      'SELECT * FROM categories WHERE is_active = 1 ORDER BY "order" ASC'
    )
      .all<Category>();

    return result.results || [];
  }

  async getCategoryByName(name: string): Promise<Category | null> {
    const result = await this.db.prepare('SELECT * FROM categories WHERE name = ?')
      .bind(name)
      .first<Category>();
    return result || null;
  }

  // ==================== Comment Operations ====================

  async addComment(appId: number, userId: number, content: string): Promise<Comment> {
    const result = await this.db.prepare(
      'INSERT INTO comments (app_id, user_id, content) VALUES (?, ?, ?)'
    )
      .bind(appId, userId, content)
      .run();

    return await this.getCommentById(result.meta.last_row_id as number) as Comment;
  }

  async getCommentsByAppId(appId: number, page: number = 1, limit: number = 20): Promise<{ comments: Comment[]; total: number }> {
    const offset = (page - 1) * limit;

    const countResult = await this.db.prepare('SELECT COUNT(*) as total FROM comments WHERE app_id = ?')
      .bind(appId)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    const result = await this.db.prepare(
      `SELECT c.*, u.username, u.nickname, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.app_id = ?
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`
    )
      .bind(appId, limit, offset)
      .all<Comment>();

    return { comments: result.results || [], total };
  }

  async getCommentById(id: number): Promise<Comment | null> {
    const result = await this.db.prepare(
      `SELECT c.*, u.username, u.nickname, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`
    )
      .bind(id)
      .first<Comment>();
    return result || null;
  }

  // ==================== Rating Operations ====================

  async rateApp(appId: number, userId: number, rating: number): Promise<void> {
    const existing = await this.db.prepare(
      'SELECT * FROM ratings WHERE app_id = ? AND user_id = ?'
    )
      .bind(appId, userId)
      .first();

    if (existing) {
      await this.db.prepare(
        'UPDATE ratings SET rating = ?, created_at = unixepoch() WHERE app_id = ? AND user_id = ?'
      )
        .bind(rating, appId, userId)
        .run();
    } else {
      await this.db.prepare(
        'INSERT INTO ratings (app_id, user_id, rating) VALUES (?, ?, ?)'
      )
        .bind(appId, userId, rating)
        .run();
    }

    // Update app rating average
    await this.updateAppRating(appId);
  }

  async getUserRating(appId: number, userId: number): Promise<number | null> {
    const result = await this.db.prepare(
      'SELECT rating FROM ratings WHERE app_id = ? AND user_id = ?'
    )
      .bind(appId, userId)
      .first<{ rating: number }>();

    return result?.rating || null;
  }

  // ==================== Favorite Operations ====================

  async addFavorite(userId: number, appId: number): Promise<void> {
    await this.db.prepare(
      'INSERT OR IGNORE INTO favorites (user_id, app_id) VALUES (?, ?)'
    )
      .bind(userId, appId)
      .run();
  }

  async removeFavorite(userId: number, appId: number): Promise<void> {
    await this.db.prepare(
      'DELETE FROM favorites WHERE user_id = ? AND app_id = ?'
    )
      .bind(userId, appId)
      .run();
  }

  async isFavorite(userId: number, appId: number): Promise<boolean> {
    const result = await this.db.prepare(
      'SELECT id FROM favorites WHERE user_id = ? AND app_id = ?'
    )
      .bind(userId, appId)
      .first();

    return result !== null;
  }

  async getUserFavorites(userId: number, page: number = 1, limit: number = 20): Promise<{ apps: AppWithUploader[]; total: number }> {
    const offset = (page - 1) * limit;

    const countResult = await this.db.prepare(
      'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?'
    )
      .bind(userId)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    const result = await this.db.prepare(
      `SELECT a.*, u.username as uploader_username, u.nickname as uploader_nickname
       FROM favorites f
       JOIN apps a ON f.app_id = a.id
       LEFT JOIN users u ON a.uploader_id = u.id
       WHERE f.user_id = ? AND a.status = 'approved'
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`
    )
      .bind(userId, limit, offset)
      .all<AppWithUploader>();

    return { apps: result.results || [], total };
  }

  // ==================== Collection Operations ====================

  async getCollections(): Promise<Collection[]> {
    const result = await this.db.prepare(
      `SELECT c.*, u.username as creator_username, u.nickname as creator_nickname
       FROM collections c
       JOIN users u ON c.creator_id = u.id
       ORDER BY c.created_at DESC`
    )
      .all<Collection>();

    return result.results || [];
  }

  async getCollectionById(id: number): Promise<Collection | null> {
    const result = await this.db.prepare(
      `SELECT c.*, u.username as creator_username, u.nickname as creator_nickname
       FROM collections c
       JOIN users u ON c.creator_id = u.id
       WHERE c.id = ?`
    )
      .bind(id)
      .first<Collection>();

    return result || null;
  }

  async getCollectionApps(collectionId: number): Promise<AppWithUploader[]> {
    const result = await this.db.prepare(
      `SELECT a.*, u.username as uploader_username, u.nickname as uploader_nickname
       FROM collection_apps ca
       JOIN apps a ON ca.app_id = a.id
       LEFT JOIN users u ON a.uploader_id = u.id
       WHERE ca.collection_id = ? AND a.status = 'approved'
       ORDER BY ca.added_at DESC`
    )
      .bind(collectionId)
      .all<AppWithUploader>();

    return result.results || [];
  }

  // ==================== Notification Operations ====================

  async createNotification(data: {
    title: string;
    content: string;
    level: string;
    userId?: number | null;
  }): Promise<Notification> {
    const result = await this.db.prepare(
      `INSERT INTO notifications (title, content, level, user_id, published_at)
       VALUES (?, ?, ?, ?, unixepoch())`
    )
      .bind(data.title, data.content, data.level, data.userId || null)
      .run();

    return await this.getNotificationById(result.meta.last_row_id as number) as Notification;
  }

  async getNotifications(userId: number, page: number = 1, limit: number = 20): Promise<{ notifications: Notification[]; total: number }> {
    const offset = (page - 1) * limit;

    const countResult = await this.db.prepare(
      'SELECT COUNT(*) as total FROM notifications WHERE user_id = ? OR user_id IS NULL'
    )
      .bind(userId)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    const result = await this.db.prepare(
      `SELECT * FROM notifications 
       WHERE user_id = ? OR user_id IS NULL
       ORDER BY published_at DESC
       LIMIT ? OFFSET ?`
    )
      .bind(userId, limit, offset)
      .all<Notification>();

    return { notifications: result.results || [], total };
  }

  async markNotificationAsRead(id: number, userId: number): Promise<void> {
    await this.db.prepare(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
    )
      .bind(id, userId)
      .run();
  }

  async getNotificationById(id: number): Promise<Notification | null> {
    const result = await this.db.prepare('SELECT * FROM notifications WHERE id = ?')
      .bind(id)
      .first<Notification>();
    return result || null;
  }

  // ==================== Donation Operations ====================

  async getDonations(limit: number = 50): Promise<Donation[]> {
    const result = await this.db.prepare(
      `SELECT d.*, u.username as donor_username, u.nickname as donor_nickname
       FROM donations d
       JOIN users u ON d.donor_id = u.id
       ORDER BY d.created_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<Donation>();

    return result.results || [];
  }

  async createDonation(data: {
    donorId: number;
    amountCents: number;
    note?: string;
    isAnonymous?: boolean;
  }): Promise<Donation> {
    const result = await this.db.prepare(
      `INSERT INTO donations (donor_id, amount_cents, note, is_anonymous)
       VALUES (?, ?, ?, ?)`
    )
      .bind(data.donorId, data.amountCents, data.note || null, data.isAnonymous ? 1 : 0)
      .run();

    return await this.getDonationById(result.meta.last_row_id as number) as Donation;
  }

  async getDonationById(id: number): Promise<Donation | null> {
    const result = await this.db.prepare(
      `SELECT d.*, u.username as donor_username, u.nickname as donor_nickname
       FROM donations d
       JOIN users u ON d.donor_id = u.id
       WHERE d.id = ?`
    )
      .bind(id)
      .first<Donation>();

    return result || null;
  }

  // ==================== Feedback Operations ====================

  async createFeedback(data: {
    userId: number;
    title: string;
    content: string;
    type: string;
  }): Promise<Feedback> {
    const result = await this.db.prepare(
      `INSERT INTO feedback (user_id, title, content, type)
       VALUES (?, ?, ?, ?)`
    )
      .bind(data.userId, data.title, data.content, data.type)
      .run();

    return await this.getFeedbackById(result.meta.last_row_id as number) as Feedback;
  }

  async getFeedbackById(id: number): Promise<Feedback | null> {
    const result = await this.db.prepare(
      `SELECT f.*, u.username, u.nickname
       FROM feedback f
       JOIN users u ON f.user_id = u.id
       WHERE f.id = ?`
    )
      .bind(id)
      .first<Feedback>();

    return result || null;
  }

  // ==================== View History Operations ====================

  async addViewHistory(userId: number, appId: number): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO view_history (user_id, app_id, viewed_at)
       VALUES (?, ?, unixepoch())`
    )
      .bind(userId, appId)
      .run();
  }

  // ==================== Download History Operations ====================

  async addDownloadHistory(userId: number, appId: number): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO download_history (user_id, app_id, downloaded_at)
       VALUES (?, ?, unixepoch())`
    )
      .bind(userId, appId)
      .run();
  }

  // ==================== Admin Operations ====================

  async getAdminStats(): Promise<{
    totalApps: number;
    pendingApps: number;
    bannedApps: number;
    totalUsers: number;
    totalDownloads: number;
  }> {
    const [totalApps, pendingApps, bannedApps, totalUsers, totalDownloads] = await Promise.all([
      this.db.prepare('SELECT COUNT(*) as count FROM apps').first<{ count: number }>(),
      this.db.prepare('SELECT COUNT(*) as count FROM apps WHERE status = "pending"').first<{ count: number }>(),
      this.db.prepare('SELECT COUNT(*) as count FROM apps WHERE status = "banned"').first<{ count: number }>(),
      this.db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
      this.db.prepare('SELECT SUM(downloads) as total FROM apps').first<{ total: number | null }>()
    ]);

    return {
      totalApps: totalApps?.count || 0,
      pendingApps: pendingApps?.count || 0,
      bannedApps: bannedApps?.count || 0,
      totalUsers: totalUsers?.count || 0,
      totalDownloads: totalDownloads?.total || 0
    };
  }

  async getUploaderRanking(limit: number = 10): Promise<Array<{ username: string; nickname: string | null; appCount: number; totalDownloads: number }>> {
    const result = await this.db.prepare(
      `SELECT u.username, u.nickname, 
              COUNT(a.id) as app_count,
              SUM(a.downloads) as total_downloads
       FROM users u
       JOIN apps a ON u.id = a.uploader_id
       WHERE a.status = 'approved'
       GROUP BY u.id
       ORDER BY total_downloads DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<{ username: string; nickname: string | null; app_count: number; total_downloads: number }>();

    return result.results || [];
  }

  async getReviewerRanking(limit: number = 10): Promise<Array<{ username: string; nickname: string | null; reviewCount: number }>> {
    const result = await this.db.prepare(
      `SELECT u.username, u.nickname,
              COUNT(r.id) as review_count
       FROM users u
       JOIN ratings r ON u.id = r.user_id
       GROUP BY u.id
       ORDER BY review_count DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<{ username: string; nickname: string | null; review_count: number }>();

    return result.results || [];
  }

  async getAllUsers(page: number = 1, limit: number = 20): Promise<{ users: User[]; total: number }> {
    const offset = (page - 1) * limit;

    const countResult = await this.db.prepare('SELECT COUNT(*) as total FROM users')
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    const result = await this.db.prepare(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
    )
      .bind(limit, offset)
      .all<User>();

    return { users: result.results || [], total };
  }

  // ==================== Helper Methods ====================

  private getSortClause(sort: string): string {
    const sortMap: Record<string, string> = {
      'downloads-desc': 'downloads DESC',
      'downloads-asc': 'downloads ASC',
      'rating-desc': 'rating_avg DESC',
      'rating-asc': 'rating_avg ASC',
      'name-asc': 'name ASC',
      'name-desc': 'name DESC',
      'date-desc': 'created_at DESC',
      'date-asc': 'created_at ASC',
      'size-desc': 'size DESC',
      'size-asc': 'size ASC',
      'views-desc': 'view_count DESC',
      'views-asc': 'view_count ASC'
    };

    return sortMap[sort] || 'downloads DESC';
  }
}
