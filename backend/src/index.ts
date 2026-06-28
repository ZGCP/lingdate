// Main entry point with all API routes for LingDate Plus backend
// Using Hono framework

import { Hono } from 'hono';
import type { Env, JWTPayload, AppQueryParams, ApiResponse, PaginatedResponse } from './types';
import { DB } from './db';
import { 
  generateJWT, 
  verifyJWT, 
  hashPassword, 
  verifyPassword, 
  isEmailDomainAllowed, 
  getUserFromRequest, 
  successResponse, 
  errorResponse,
  getPaginationParams,
  getAppQueryParams,
  buildPaginatedResponse,
  isValidEmail,
  isValidUsername,
  isValidPassword,
  generateFileName
} from './utils';
import { 
  authMiddleware, 
  adminMiddleware, 
  emailVerifiedMiddleware,
  getCurrentUser 
} from './middleware';

// Initialize Hono app
const app = new Hono<{ Bindings: Env }>();

// ==================== Health Check ====================
app.get('/health', (c) => {
  return c.json({ 
    success: true, 
    message: 'LingDate Plus Backend is running',
    timestamp: Date.now()
  });
});

// ==================== Auth Routes ====================

// Register
app.post('/api/v1/auth/register', async (c) => {
  try {
    const body = await c.req.json();
    const { username, email, password, nickname } = body;

    // Validation
    if (!username || !email || !password) {
      return errorResponse('Username, email, and password are required', 400);
    }

    if (!isValidEmail(email)) {
      return errorResponse('Invalid email format', 400);
    }

    if (!isValidUsername(username)) {
      return errorResponse('Username must be 3-30 characters and contain only letters, numbers, and underscores', 400);
    }

    if (!isValidPassword(password)) {
      return errorResponse('Password must be 6-128 characters', 400);
    }

    // Check email domain whitelist
    if (!isEmailDomainAllowed(email, c.env.ALLOWED_EMAIL_DOMAINS)) {
      return errorResponse('Email domain not allowed', 403);
    }

    const db = new DB(c.env.DB);

    // Check if user already exists
    const existingEmail = await db.getUserByEmail(email);
    if (existingEmail) {
      return errorResponse('Email already registered', 409);
    }

    const existingUsername = await db.getUserByUsername(username);
    if (existingUsername) {
      return errorResponse('Username already taken', 409);
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await db.createUser({
      username,
      email,
      password_hash: passwordHash,
      nickname
    });

    // Generate JWT
    const token = await generateJWT(
      { userId: user.id, username: user.username, role: user.role },
      c.env
    );

    // Return user without password_hash
    const { password_hash, ...userSafe } = user;

    return c.json(successResponse({ token, user: userSafe }));
  } catch (error) {
    console.error('Register error:', error);
    return errorResponse('Registration failed', 500);
  }
});

// Login
app.post('/api/v1/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      return errorResponse('Email and password are required', 400);
    }

    const db = new DB(c.env.DB);
    const user = await db.getUserByEmail(email);

    if (!user) {
      return errorResponse('Invalid credentials', 401);
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return errorResponse('Invalid credentials', 401);
    }

    // Generate JWT
    const token = await generateJWT(
      { userId: user.id, username: user.username, role: user.role },
      c.env
    );

    // Return user without password_hash
    const { password_hash, ...userSafe } = user;

    return c.json(successResponse({ token, user: userSafe }));
  } catch (error) {
    console.error('Login error:', error);
    return errorResponse('Login failed', 500);
  }
});

// Get profile
app.get('/api/v1/auth/profile', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const db = new DB(c.env.DB);
    const fullUser = await db.getUserSafeById(user.userId);

    if (!fullUser) {
      return errorResponse('User not found', 404);
    }

    return c.json(successResponse(fullUser));
  } catch (error) {
    console.error('Get profile error:', error);
    return errorResponse('Failed to get profile', 500);
  }
});

// ==================== App Routes ====================

// Get apps list with pagination and filtering
app.get('/api/v1/apps', async (c) => {
  try {
    const params = getAppQueryParams(c.req.query());
    const pagination = getPaginationParams(c.req.query());

    const db = new DB(c.env.DB);
    const { apps, total } = await db.getApps({
      ...params,
      page: pagination.page,
      limit: pagination.limit
    });

    return c.json(buildPaginatedResponse(apps, total, pagination));
  } catch (error) {
    console.error('Get apps error:', error);
    return errorResponse('Failed to get apps', 500);
  }
});

// Get recommended apps
app.get('/api/v1/apps/recommended', async (c) => {
  try {
    const db = new DB(c.env.DB);
    const apps = await db.getRecommendedApps(8);

    return c.json(successResponse(apps));
  } catch (error) {
    console.error('Get recommended apps error:', error);
    return errorResponse('Failed to get recommended apps', 500);
  }
});

// Get app details
app.get('/api/v1/apps/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    const app = await db.getAppById(id);

    if (!app) {
      return errorResponse('App not found', 404);
    }

    // Increment view count
    await db.incrementAppViews(id);

    // Get screenshots
    const screenshots = await db.getAppScreenshots(id);

    // Get variants
    const variants = await db.getAppVariantsByAppId(id);

    return c.json(successResponse({ 
      ...app, 
      screenshots: screenshots.map(s => s.screenshot_url),
      variants 
    }));
  } catch (error) {
    console.error('Get app details error:', error);
    return errorResponse('Failed to get app details', 500);
  }
});

// Upload new app
app.post('/api/v1/apps', authMiddleware, emailVerifiedMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await c.req.json();
    const { 
      name, 
      package_name, 
      developer, 
      description, 
      category,
      version_name,
      version_code,
      source,
      min_sdk,
      target_sdk,
      is_wear_os,
      r2_key,
      size
    } = body;

    if (!name || !package_name || !developer) {
      return errorResponse('Name, package_name, and developer are required', 400);
    }

    const db = new DB(c.env.DB);

    // Check if package name already exists
    const existingApp = await db.getAppByPackageName(package_name);
    if (existingApp) {
      return errorResponse('Package name already exists', 409);
    }

    // Create app
    const app = await db.createApp({
      name,
      package_name,
      developer,
      description,
      category,
      version_name,
      version_code: version_code ? parseInt(version_code) : undefined,
      source,
      min_sdk: min_sdk ? parseInt(min_sdk) : undefined,
      target_sdk: target_sdk ? parseInt(target_sdk) : undefined,
      is_wear_os: is_wear_os ? 1 : 0,
      uploader_id: user.userId,
      r2_key,
      size: size ? parseInt(size) : undefined,
      status: 'pending' // Requires admin approval
    });

    return c.json(successResponse(app, 'App submitted successfully. Waiting for approval.'), 201);
  } catch (error) {
    console.error('Upload app error:', error);
    return errorResponse('Failed to upload app', 500);
  }
});

// Get app comments
app.get('/api/v1/apps/:id/comments', async (c) => {
  try {
    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const pagination = getPaginationParams(c.req.query());
    const db = new DB(c.env.DB);
    const { comments, total } = await db.getCommentsByAppId(appId, pagination.page, pagination.limit);

    return c.json(buildPaginatedResponse(comments, total, pagination));
  } catch (error) {
    console.error('Get comments error:', error);
    return errorResponse('Failed to get comments', 500);
  }
});

// Add comment
app.post('/api/v1/apps/:id/comments', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const body = await c.req.json();
    const { content } = body;

    if (!content || content.trim().length === 0) {
      return errorResponse('Comment content is required', 400);
    }

    const db = new DB(c.env.DB);
    const comment = await db.addComment(appId, user.userId, content.trim());

    return c.json(successResponse(comment, 'Comment added successfully'), 201);
  } catch (error) {
    console.error('Add comment error:', error);
    return errorResponse('Failed to add comment', 500);
  }
});

// Rate app
app.post('/api/v1/apps/:id/rate', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const body = await c.req.json();
    const { rating } = body;

    if (!rating || rating < 1 || rating > 5) {
      return errorResponse('Rating must be between 1 and 5', 400);
    }

    const db = new DB(c.env.DB);
    await db.rateApp(appId, user.userId, rating);

    // Get updated app to return new rating
    const app = await db.getAppById(appId);

    return c.json(successResponse({ rating, app }, 'Rating submitted successfully'));
  } catch (error) {
    console.error('Rate app error:', error);
    return errorResponse('Failed to rate app', 500);
  }
});

// Get app versions
app.get('/api/v1/apps/:id/versions', async (c) => {
  try {
    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    const variants = await db.getAppVariantsByAppId(appId);

    return c.json(successResponse(variants));
  } catch (error) {
    console.error('Get app versions error:', error);
    return errorResponse('Failed to get app versions', 500);
  }
});

// Get app screenshots
app.get('/api/v1/apps/:id/screenshots', async (c) => {
  try {
    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    const screenshots = await db.getAppScreenshots(appId);

    return c.json(successResponse(screenshots));
  } catch (error) {
    console.error('Get screenshots error:', error);
    return errorResponse('Failed to get screenshots', 500);
  }
});

// ==================== Category Routes ====================

// Get all categories
app.get('/api/v1/categories', async (c) => {
  try {
    const db = new DB(c.env.DB);
    const categories = await db.getCategories();

    return c.json(successResponse(categories));
  } catch (error) {
    console.error('Get categories error:', error);
    return errorResponse('Failed to get categories', 500);
  }
});

// ==================== Collection Routes ====================

// Get all collections
app.get('/api/v1/collections', async (c) => {
  try {
    const db = new DB(c.env.DB);
    const collections = await db.getCollections();

    return c.json(successResponse(collections));
  } catch (error) {
    console.error('Get collections error:', error);
    return errorResponse('Failed to get collections', 500);
  }
});

// Get collection detail with apps
app.get('/api/v1/collections/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) {
      return errorResponse('Invalid collection ID', 400);
    }

    const db = new DB(c.env.DB);
    const collection = await db.getCollectionById(id);

    if (!collection) {
      return errorResponse('Collection not found', 404);
    }

    const apps = await db.getCollectionApps(id);

    return c.json(successResponse({ ...collection, apps }));
  } catch (error) {
    console.error('Get collection error:', error);
    return errorResponse('Failed to get collection', 500);
  }
});

// ==================== Donation Routes ====================

// Get donations list
app.get('/api/v1/donations', async (c) => {
  try {
    const db = new DB(c.env.DB);
    const donations = await db.getDonations();

    return c.json(successResponse(donations));
  } catch (error) {
    console.error('Get donations error:', error);
    return errorResponse('Failed to get donations', 500);
  }
});

// ==================== Notification Routes ====================

// Get user notifications
app.get('/api/v1/notifications', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const pagination = getPaginationParams(c.req.query());
    const db = new DB(c.env.DB);
    const { notifications, total } = await db.getNotifications(user.userId, pagination.page, pagination.limit);

    return c.json(buildPaginatedResponse(notifications, total, pagination));
  } catch (error) {
    console.error('Get notifications error:', error);
    return errorResponse('Failed to get notifications', 500);
  }
});

// Mark notification as read
app.post('/api/v1/notifications/:id/read', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const notificationId = parseInt(c.req.param('id'));
    if (isNaN(notificationId)) {
      return errorResponse('Invalid notification ID', 400);
    }

    const db = new DB(c.env.DB);
    await db.markNotificationAsRead(notificationId, user.userId);

    return c.json(successResponse(null, 'Notification marked as read'));
  } catch (error) {
    console.error('Mark notification error:', error);
    return errorResponse('Failed to mark notification as read', 500);
  }
});

// ==================== User Routes ====================

// Update user profile
app.put('/api/v1/users/profile', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await c.req.json();
    const { nickname } = body;

    if (!nickname || nickname.trim().length === 0) {
      return errorResponse('Nickname is required', 400);
    }

    const db = new DB(c.env.DB);
    await db.updateUser(user.userId, { nickname: nickname.trim() });

    const updatedUser = await db.getUserSafeById(user.userId);

    return c.json(successResponse(updatedUser, 'Profile updated successfully'));
  } catch (error) {
    console.error('Update profile error:', error);
    return errorResponse('Failed to update profile', 500);
  }
});

// Upload avatar
app.post('/api/v1/users/avatar', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const formData = await c.req.formData();
    const file = formData.get('avatar') as File;

    if (!file) {
      return errorResponse('Avatar file is required', 400);
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return errorResponse('File must be an image', 400);
    }

    // Generate unique filename
    const fileName = generateFileName(file.name, user.userId);
    const fileBuffer = await file.arrayBuffer();

    // Upload to R2
    await c.env.STORAGE.put(`avatars/${fileName}`, fileBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    });

    // Update user avatar URL
    const avatarUrl = `/api/v1/storage/avatars/${fileName}`;
    const db = new DB(c.env.DB);
    await db.updateUser(user.userId, { avatar_url: avatarUrl });

    const updatedUser = await db.getUserSafeById(user.userId);

    return c.json(successResponse(updatedUser, 'Avatar uploaded successfully'));
  } catch (error) {
    console.error('Upload avatar error:', error);
    return errorResponse('Failed to upload avatar', 500);
  }
});

// Get user favorites
app.get('/api/v1/users/favorites', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const pagination = getPaginationParams(c.req.query());
    const db = new DB(c.env.DB);
    const { apps, total } = await db.getUserFavorites(user.userId, pagination.page, pagination.limit);

    return c.json(buildPaginatedResponse(apps, total, pagination));
  } catch (error) {
    console.error('Get favorites error:', error);
    return errorResponse('Failed to get favorites', 500);
  }
});

// Add favorite
app.post('/api/v1/users/favorites/:appId', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const appId = parseInt(c.req.param('appId'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    await db.addFavorite(user.userId, appId);

    return c.json(successResponse(null, 'App added to favorites'));
  } catch (error) {
    console.error('Add favorite error:', error);
    return errorResponse('Failed to add favorite', 500);
  }
});

// Remove favorite
app.delete('/api/v1/users/favorites/:appId', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const appId = parseInt(c.req.param('appId'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    await db.removeFavorite(user.userId, appId);

    return c.json(successResponse(null, 'App removed from favorites'));
  } catch (error) {
    console.error('Remove favorite error:', error);
    return errorResponse('Failed to remove favorite', 500);
  }
});

// ==================== Feedback Routes ====================

// Submit feedback
app.post('/api/v1/feedback', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await c.req.json();
    const { title, content, type } = body;

    if (!title || !content) {
      return errorResponse('Title and content are required', 400);
    }

    const db = new DB(c.env.DB);
    const feedback = await db.createFeedback({
      userId: user.userId,
      title,
      content,
      type: type || 'other'
    });

    return c.json(successResponse(feedback, 'Feedback submitted successfully'), 201);
  } catch (error) {
    console.error('Submit feedback error:', error);
    return errorResponse('Failed to submit feedback', 500);
  }
});

// ==================== Download Route ====================

// Download app
app.get('/api/v1/download/:id', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    const app = await db.getAppById(appId);

    if (!app) {
      return errorResponse('App not found', 404);
    }

    if (app.status !== 'approved') {
      return errorResponse('App is not available for download', 403);
    }

    // Add to download history
    await db.addDownloadHistory(user.userId, appId);

    // Increment download count
    await db.incrementAppDownloads(appId);

    // If APK is in R2, redirect to R2 URL
    if (app.r2_key) {
      const r2Object = await c.env.STORAGE.get(app.r2_key);
      if (r2Object) {
        // Return R2 object as response
        return new Response(r2Object.body, {
          headers: {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': `attachment; filename="${app.package_name}.apk"`,
            'Content-Length': r2Object.size.toString()
          }
        });
      }
    }

    // If external URL, redirect
    if (app.apk_url) {
      return c.redirect(app.apk_url);
    }

    return errorResponse('Download source not found', 404);
  } catch (error) {
    console.error('Download error:', error);
    return errorResponse('Failed to download app', 500);
  }
});

// ==================== Upload Routes ====================

// Upload APK file to R2
app.post('/api/v1/upload', authMiddleware, emailVerifiedMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return errorResponse('File is required', 400);
    }

    // Validate file type (APK)
    if (!file.name.endsWith('.apk')) {
      return errorResponse('File must be an APK', 400);
    }

    // Generate unique filename
    const fileName = generateFileName(file.name, user.userId);
    const fileBuffer = await file.arrayBuffer();

    // Upload to R2
    const r2Key = `apks/${fileName}`;
    await c.env.STORAGE.put(r2Key, fileBuffer, {
      httpMetadata: {
        contentType: 'application/vnd.android.package-archive'
      }
    });

    return c.json(successResponse({ 
      r2_key: r2Key,
      size: file.size,
      filename: file.name
    }, 'File uploaded successfully'));
  } catch (error) {
    console.error('Upload APK error:', error);
    return errorResponse('Failed to upload APK', 500);
  }
});

// Upload icon image to R2
app.post('/api/v1/upload/icon', authMiddleware, async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const formData = await c.req.formData();
    const file = formData.get('icon') as File;

    if (!file) {
      return errorResponse('Icon file is required', 400);
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return errorResponse('File must be an image', 400);
    }

    // Generate unique filename
    const fileName = generateFileName(file.name, user.userId);
    const fileBuffer = await file.arrayBuffer();

    // Upload to R2
    const r2Key = `icons/${fileName}`;
    await c.env.STORAGE.put(r2Key, fileBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    });

    const iconUrl = `/api/v1/storage/icons/${fileName}`;

    return c.json(successResponse({ 
      icon_url: iconUrl,
      r2_key: r2Key
    }, 'Icon uploaded successfully'));
  } catch (error) {
    console.error('Upload icon error:', error);
    return errorResponse('Failed to upload icon', 500);
  }
});

// ==================== Admin Routes ====================

// Get pending apps
app.get('/api/v1/admin/apps', authMiddleware, adminMiddleware, async (c) => {
  try {
    const status = c.req.query('status') || 'pending';
    const pagination = getPaginationParams(c.req.query());

    const db = new DB(c.env.DB);
    const { apps, total } = await db.getApps({
      status,
      page: pagination.page,
      limit: pagination.limit
    });

    return c.json(buildPaginatedResponse(apps, total, pagination));
  } catch (error) {
    console.error('Admin get apps error:', error);
    return errorResponse('Failed to get apps', 500);
  }
});

// Approve app
app.put('/api/v1/admin/apps/:id/approve', authMiddleware, adminMiddleware, async (c) => {
  try {
    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    const app = await db.getAppById(appId);

    if (!app) {
      return errorResponse('App not found', 404);
    }

    await db.updateApp(appId, { status: 'approved' });

    // Send notification to uploader
    if (app.uploader_id) {
      await db.createNotification({
        title: 'App Approved',
        content: `Your app "${app.name}" has been approved and is now available for download.`,
        level: 'success',
        userId: app.uploader_id
      });
    }

    return c.json(successResponse(null, 'App approved successfully'));
  } catch (error) {
    console.error('Approve app error:', error);
    return errorResponse('Failed to approve app', 500);
  }
});

// Ban app
app.put('/api/v1/admin/apps/:id/ban', authMiddleware, adminMiddleware, async (c) => {
  try {
    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    const app = await db.getAppById(appId);

    if (!app) {
      return errorResponse('App not found', 404);
    }

    await db.updateApp(appId, { status: 'banned' });

    // Send notification to uploader
    if (app.uploader_id) {
      await db.createNotification({
        title: 'App Banned',
        content: `Your app "${app.name}" has been banned. Please contact support for more information.`,
        level: 'error',
        userId: app.uploader_id
      });
    }

    return c.json(successResponse(null, 'App banned successfully'));
  } catch (error) {
    console.error('Ban app error:', error);
    return errorResponse('Failed to ban app', 500);
  }
});

// Edit app
app.put('/api/v1/admin/apps/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const body = await c.req.json();
    const { 
      name, 
      developer, 
      description, 
      category,
      version_name,
      version_code,
      source,
      min_sdk,
      target_sdk,
      is_wear_os,
      status 
    } = body;

    const db = new DB(c.env.DB);
    const app = await db.getAppById(appId);

    if (!app) {
      return errorResponse('App not found', 404);
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (developer !== undefined) updateData.developer = developer;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (version_name !== undefined) updateData.version_name = version_name;
    if (version_code !== undefined) updateData.version_code = parseInt(version_code);
    if (source !== undefined) updateData.source = source;
    if (min_sdk !== undefined) updateData.min_sdk = parseInt(min_sdk);
    if (target_sdk !== undefined) updateData.target_sdk = parseInt(target_sdk);
    if (is_wear_os !== undefined) updateData.is_wear_os = is_wear_os ? 1 : 0;
    if (status !== undefined) updateData.status = status;

    await db.updateApp(appId, updateData);

    const updatedApp = await db.getAppById(appId);

    return c.json(successResponse(updatedApp, 'App updated successfully'));
  } catch (error) {
    console.error('Edit app error:', error);
    return errorResponse('Failed to edit app', 500);
  }
});

// Delete app
app.delete('/api/v1/admin/apps/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const appId = parseInt(c.req.param('id'));
    if (isNaN(appId)) {
      return errorResponse('Invalid app ID', 400);
    }

    const db = new DB(c.env.DB);
    const app = await db.getAppById(appId);

    if (!app) {
      return errorResponse('App not found', 404);
    }

    // Delete APK from R2 if exists
    if (app.r2_key) {
      await c.env.STORAGE.delete(app.r2_key);
    }

    // Delete app from database (cascade will delete related records)
    await db.deleteApp(appId);

    return c.json(successResponse(null, 'App deleted successfully'));
  } catch (error) {
    console.error('Delete app error:', error);
    return errorResponse('Failed to delete app', 500);
  }
});

// Get all users (admin)
app.get('/api/v1/admin/users', authMiddleware, adminMiddleware, async (c) => {
  try {
    const pagination = getPaginationParams(c.req.query());
    const db = new DB(c.env.DB);
    const { users, total } = await db.getAllUsers(pagination.page, pagination.limit);

    // Remove password_hash from response
    const safeUsers = users.map(({ password_hash, ...user }) => user);

    return c.json(buildPaginatedResponse(safeUsers, total, pagination));
  } catch (error) {
    console.error('Admin get users error:', error);
    return errorResponse('Failed to get users', 500);
  }
});

// Edit user (admin)
app.put('/api/v1/admin/users/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const userId = parseInt(c.req.param('id'));
    if (isNaN(userId)) {
      return errorResponse('Invalid user ID', 400);
    }

    const body = await c.req.json();
    const { role, email_verified } = body;

    const db = new DB(c.env.DB);
    const user = await db.getUserById(userId);

    if (!user) {
      return errorResponse('User not found', 404);
    }

    const updateData: any = {};
    if (role !== undefined) updateData.role = role;
    if (email_verified !== undefined) updateData.email_verified = email_verified ? 1 : 0;

    await db.updateUser(userId, updateData);

    const updatedUser = await db.getUserSafeById(userId);

    return c.json(successResponse(updatedUser, 'User updated successfully'));
  } catch (error) {
    console.error('Edit user error:', error);
    return errorResponse('Failed to edit user', 500);
  }
});

// Create global notification (admin)
app.post('/api/v1/admin/notifications', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { title, content, level, user_id } = body;

    if (!title || !content) {
      return errorResponse('Title and content are required', 400);
    }

    const db = new DB(c.env.DB);
    const notification = await db.createNotification({
      title,
      content,
      level: level || 'info',
      userId: user_id || null // null means global notification
    });

    return c.json(successResponse(notification, 'Notification created successfully'), 201);
  } catch (error) {
    console.error('Create notification error:', error);
    return errorResponse('Failed to create notification', 500);
  }
});

// Get admin stats
app.get('/api/v1/admin/stats', authMiddleware, adminMiddleware, async (c) => {
  try {
    const db = new DB(c.env.DB);
    const stats = await db.getAdminStats();

    return c.json(successResponse(stats));
  } catch (error) {
    console.error('Get admin stats error:', error);
    return errorResponse('Failed to get stats', 500);
  }
});

// Get uploader ranking
app.get('/api/v1/admin/ranking/uploaders', authMiddleware, adminMiddleware, async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    const db = new DB(c.env.DB);
    const ranking = await db.getUploaderRanking(limit);

    return c.json(successResponse(ranking));
  } catch (error) {
    console.error('Get uploader ranking error:', error);
    return errorResponse('Failed to get uploader ranking', 500);
  }
});

// Get reviewer ranking
app.get('/api/v1/admin/ranking/reviewers', authMiddleware, adminMiddleware, async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    const db = new DB(c.env.DB);
    const ranking = await db.getReviewerRanking(limit);

    return c.json(successResponse(ranking));
  } catch (error) {
    console.error('Get reviewer ranking error:', error);
    return errorResponse('Failed to get reviewer ranking', 500);
  }
});

// ==================== Storage Routes ====================

// Serve files from R2 (avatars, icons, screenshots)
app.get('/api/v1/storage/:type/:filename', async (c) => {
  try {
    const type = c.req.param('type');
    const filename = c.req.param('filename');
    
    // Reconstruct the full path
    const path = `${type}/${filename}`;
    
    const r2Object = await c.env.STORAGE.get(path);
    
    if (!r2Object) {
      return errorResponse('File not found', 404);
    }

    return new Response(r2Object.body, {
      headers: {
        'Content-Type': r2Object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
      }
    });
  } catch (error) {
    console.error('Storage error:', error);
    return errorResponse('Failed to retrieve file', 500);
  }
});

// ==================== Export ====================

export default app;
