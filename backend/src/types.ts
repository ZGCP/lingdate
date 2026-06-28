// TypeScript types for LingDate Plus backend

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  JWT_SECRET: string;
  ALLOWED_EMAIL_DOMAINS: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  nickname: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin' | 'reviewer';
  email_verified: number;
  created_at: number;
  updated_at: number;
}

export interface UserSafe {
  id: number;
  username: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin' | 'reviewer';
  email_verified: number;
  created_at: number;
}

export interface App {
  id: number;
  name: string;
  package_name: string;
  developer: string;
  description: string | null;
  icon_url: string | null;
  category: string | null;
  version_name: string | null;
  version_code: number | null;
  size: number | null;
  downloads: number;
  rating_avg: number;
  rating_count: number;
  view_count: number;
  status: 'pending' | 'approved' | 'banned' | 'rejected';
  source: string | null;
  min_sdk: number | null;
  target_sdk: number | null;
  is_wear_os: number;
  uploader_id: number | null;
  r2_key: string | null;
  apk_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface AppWithUploader extends App {
  uploader_username?: string;
  uploader_nickname?: string;
}

export interface AppVariant {
  id: number;
  app_id: number;
  variant_key: string;
  version_name: string;
  version_code: number;
  size: number | null;
  r2_key: string | null;
  created_at: number;
}

export interface AppScreenshot {
  id: number;
  app_id: number;
  screenshot_url: string;
  order: number;
  created_at: number;
}

export interface Category {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  order: number;
  is_active: number;
  created_at: number;
}

export interface Comment {
  id: number;
  app_id: number;
  user_id: number;
  content: string;
  created_at: number;
  username?: string;
  nickname?: string;
  avatar_url?: string;
}

export interface Rating {
  id: number;
  app_id: number;
  user_id: number;
  rating: number;
  created_at: number;
}

export interface Favorite {
  id: number;
  user_id: number;
  app_id: number;
  created_at: number;
}

export interface Collection {
  id: number;
  title: string;
  description: string | null;
  creator_id: number;
  app_count: number;
  created_at: number;
  updated_at: number;
  creator_username?: string;
  creator_nickname?: string;
}

export interface CollectionApp {
  collection_id: number;
  app_id: number;
  added_at: number;
}

export interface Notification {
  id: number;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'error' | 'success';
  user_id: number | null;
  is_read: number;
  published_at: number;
}

export interface Donation {
  id: number;
  donor_id: number;
  amount_cents: number;
  note: string | null;
  is_anonymous: number;
  created_at: number;
  donor_username?: string;
  donor_nickname?: string;
}

export interface Feedback {
  id: number;
  user_id: number;
  title: string;
  content: string;
  type: 'bug' | 'feature' | 'other';
  status: 'open' | 'resolved' | 'closed';
  created_at: number;
  username?: string;
  nickname?: string;
}

export interface ViewHistory {
  user_id: number;
  app_id: number;
  viewed_at: number;
}

export interface DownloadHistory {
  user_id: number;
  app_id: number;
  downloaded_at: number;
}

export interface JWTPayload {
  userId: number;
  username: string;
  role: string;
  exp: number;
}

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface AppQueryParams {
  page: number;
  limit: number;
  category: string | null;
  search: string | null;
  sort: string;
  zeroOnly: boolean;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  nickname?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateAppRequest {
  name: string;
  package_name: string;
  developer: string;
  description?: string;
  category?: string;
  version_name?: string;
  version_code?: number;
  source?: string;
  min_sdk?: number;
  target_sdk?: number;
  is_wear_os?: boolean;
}

export interface UpdateAppRequest {
  name?: string;
  developer?: string;
  description?: string;
  category?: string;
  version_name?: string;
  version_code?: number;
  source?: string;
  min_sdk?: number;
  target_sdk?: number;
  is_wear_os?: boolean;
  status?: string;
}

export interface CreateNotificationRequest {
  title: string;
  content: string;
  level: 'info' | 'warning' | 'error' | 'success';
  user_id?: number | null;
}

export interface SubmitFeedbackRequest {
  title: string;
  content: string;
  type: 'bug' | 'feature' | 'other';
}

export interface RateAppRequest {
  rating: number;
}

export interface UpdateProfileRequest {
  nickname?: string;
}

export interface UpdateUserRequest {
  role?: 'user' | 'admin' | 'reviewer';
  email_verified?: number;
}
