-- LingDate Plus App Store Database Schema for Cloudflare D1

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin', 'reviewer')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Apps table
CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    package_name TEXT NOT NULL UNIQUE,
    developer TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    category TEXT,
    version_name TEXT,
    version_code INTEGER,
    size INTEGER,
    downloads INTEGER NOT NULL DEFAULT 0,
    rating_avg REAL NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'banned', 'rejected')),
    source TEXT,
    min_sdk INTEGER,
    target_sdk INTEGER,
    is_wear_os INTEGER NOT NULL DEFAULT 0,
    uploader_id INTEGER,
    r2_key TEXT,
    apk_url TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (uploader_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_apps_status ON apps(status);
CREATE INDEX IF NOT EXISTS idx_apps_category ON apps(category);
CREATE INDEX IF NOT EXISTS idx_apps_package_name ON apps(package_name);
CREATE INDEX IF NOT EXISTS idx_apps_uploader_id ON apps(uploader_id);
CREATE INDEX IF NOT EXISTS idx_apps_downloads ON apps(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_apps_rating_avg ON apps(rating_avg DESC);

-- App variants table (for multiple versions)
CREATE TABLE IF NOT EXISTS app_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    variant_key TEXT NOT NULL,
    version_name TEXT NOT NULL,
    version_code INTEGER NOT NULL,
    size INTEGER,
    r2_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_variants_app_id ON app_variants(app_id);

-- App screenshots table
CREATE TABLE IF NOT EXISTS app_screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    screenshot_url TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_screenshots_app_id ON app_screenshots(app_id);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_app_id ON comments(app_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);

-- Ratings table (one rating per user per app)
CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(app_id, user_id),
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_app_id ON ratings(app_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_id ON ratings(user_id);

-- Favorites table (bookmarks)
CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, app_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_app_id ON favorites(app_id);

-- Collections table
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    creator_id INTEGER NOT NULL,
    app_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (creator_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_collections_creator_id ON collections(creator_id);

-- Collection apps table (many-to-many)
CREATE TABLE IF NOT EXISTS collection_apps (
    collection_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (collection_id, app_id),
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collection_apps_collection_id ON collection_apps(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_apps_app_id ON collection_apps(app_id);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'warning', 'error', 'success')),
    user_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_published_at ON notifications(published_at DESC);

-- Donations table
CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donor_id INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    note TEXT,
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (donor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations(created_at DESC);

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other' CHECK(type IN ('bug', 'feature', 'other')),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'closed')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);

-- View history table
CREATE TABLE IF NOT EXISTS view_history (
    user_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    viewed_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, app_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_view_history_user_id ON view_history(user_id);
CREATE INDEX IF NOT EXISTS idx_view_history_app_id ON view_history(app_id);
CREATE INDEX IF NOT EXISTS idx_view_history_viewed_at ON view_history(viewed_at DESC);

-- Download history table
CREATE TABLE IF NOT EXISTS download_history (
    user_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    downloaded_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, app_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_download_history_user_id ON download_history(user_id);
CREATE INDEX IF NOT EXISTS idx_download_history_app_id ON download_history(app_id);
CREATE INDEX IF NOT EXISTS idx_download_history_downloaded_at ON download_history(downloaded_at DESC);

-- Insert default admin user (password: admin123)
-- Password hash is SHA-256 of 'admin123' with salt 'adminsalt'
INSERT OR IGNORE INTO users (username, email, password_hash, nickname, role, email_verified) 
VALUES ('admin', 'admin@lingdate.plus', 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', 'Admin', 'admin', 1);

-- Insert default categories
INSERT OR IGNORE INTO categories (name, display_name, description, icon, "order", is_active) VALUES
('all', '全部应用', '所有应用', 'grid', 0, 1),
('productivity', '效率办公', '办公和生产力工具', 'briefcase', 1, 1),
('communication', '社交通讯', '社交和通讯应用', 'message-circle', 2, 1),
('entertainment', '影音娱乐', '娱乐和媒体应用', 'play-circle', 3, 1),
('games', '游戏', '游戏应用', 'gamepad-2', 4, 1),
('tools', '系统工具', '工具和实用程序', 'tool', 5, 1),
('lifestyle', '生活时尚', '生活和时尚应用', 'heart', 6, 1),
('education', '教育学习', '教育和学习应用', 'book-open', 7, 1),
('finance', '金融理财', '金融和理财应用', 'dollar-sign', 8, 1),
('health', '健康运动', '健康和运动应用', 'activity', 9, 1),
('photography', '摄影图像', '摄影和图像应用', 'camera', 10, 1),
('music', '音乐音频', '音乐和音频应用', 'music', 11, 1),
('news', '新闻阅读', '新闻和阅读应用', 'newspaper', 12, 1),
('shopping', '购物优惠', '购物和优惠应用', 'shopping-bag', 13, 1),
('travel', '旅游出行', '旅游和出行应用', 'map', 14, 1),
('wearos', 'WearOS', 'WearOS 手表应用', 'watch', 15, 1);
