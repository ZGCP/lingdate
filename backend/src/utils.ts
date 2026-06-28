// Utility functions for JWT, password hashing, responses, and validation

import type { JWTPayload, PaginationParams, ApiResponse, AppQueryParams, Env } from './types';

// JWT Secret key - should be set in wrangler.toml as environment variable
const getJWTSecret = (env: Env): string => {
  return env.JWT_SECRET || 'default-secret-change-in-production';
};

// Base64 URL encode/decode helpers
const base64UrlEncode = (data: string): string => {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const base64UrlDecode = (data: string): string => {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
};

// Generate JWT token using Web Crypto API
export const generateJWT = async (payload: Omit<JWTPayload, 'exp'>, env: Env): Promise<string> => {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 7 * 24 * 60 * 60 // 7 days expiration
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await signData(data, env);

  return `${data}.${signature}`;
};

// Verify JWT token
export const verifyJWT = async (token: string, env: Env): Promise<JWTPayload | null> => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const data = `${encodedHeader}.${encodedPayload}`;

    // Verify signature
    const expectedSignature = await signData(data, env);
    if (signature !== expectedSignature) return null;

    // Decode payload
    const payload: JWTPayload = JSON.parse(base64UrlDecode(encodedPayload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch (error) {
    return null;
  }
};

// Sign data with HMAC SHA-256
const signData = async (data: string, env: Env): Promise<string> => {
  const secret = getJWTSecret(env);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const dataToSign = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataToSign);
  const signatureArray = new Uint8Array(signature);
  
  // Convert to base64 URL safe
  let binary = '';
  for (let i = 0; i < signatureArray.length; i++) {
    binary += String.fromCharCode(signatureArray[i]);
  }
  
  return base64UrlEncode(binary);
};

// Hash password using SHA-256 with salt
export const hashPassword = async (password: string, salt?: string): Promise<string> => {
  const actualSalt = salt || crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(password + actualSalt);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  
  let hashHex = '';
  for (let i = 0; i < hashArray.length; i++) {
    hashHex += hashArray[i].toString(16).padStart(2, '0');
  }
  
  // Return salt:hash format
  return `${actualSalt}:${hashHex}`;
};

// Verify password
export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  
  const computedHash = await hashPassword(password, salt);
  const [, computedHashOnly] = computedHash.split(':');
  
  return computedHashOnly === hash;
};

// Validate email domain
export const isEmailDomainAllowed = (email: string, allowedDomains: string): boolean => {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  
  const domains = allowedDomains.split(',').map(d => d.trim().toLowerCase());
  return domains.includes(domain);
};

// Parse pagination parameters
export const getPaginationParams = (searchParams: URLSearchParams): PaginationParams => {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '48')));
  const offset = (page - 1) * limit;
  
  return { page, limit, offset };
};

// Parse app query parameters
export const getAppQueryParams = (searchParams: URLSearchParams): AppQueryParams => {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '48')));
  const category = searchParams.get('category') || null;
  const search = searchParams.get('search') || null;
  const sort = searchParams.get('sort') || 'downloads-desc';
  const zeroOnly = searchParams.get('zeroOnly') === 'true';
  
  return { page, limit, category, search, sort, zeroOnly };
};

// Build pagination response
export const buildPaginatedResponse = <T>(
  data: T[],
  total: number,
  params: PaginationParams
): ApiResponse<PaginatedResponse<T>> => {
  const totalPages = Math.ceil(total / params.limit);
  
  return {
    success: true,
    data: {
      data,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages
      }
    }
  };
};

// Success response helper
export const successResponse = <T>(data: T, message?: string): ApiResponse<T> => {
  return {
    success: true,
    data,
    message
  };
};

// Error response helper
export const errorResponse = (message: string, status: number = 400): Response => {
  return new Response(
    JSON.stringify({
      success: false,
      error: message
    } as ApiResponse),
    {
      status,
      headers: { 'Content-Type': 'application/json' }
    }
  );
};

// Validation helpers
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidUsername = (username: string): boolean => {
  return username.length >= 3 && username.length <= 30 && /^[a-zA-Z0-9_]+$/.test(username);
};

export const isValidPassword = (password: string): boolean => {
  return password.length >= 6 && password.length <= 128;
};

export const isValidPackageName = (packageName: string): boolean => {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName);
};

// Get user from request (extract JWT from Authorization header)
export const getUserFromRequest = async (request: Request, env: Env): Promise<JWTPayload | null> => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  return await verifyJWT(token, env);
};

// Generate unique filename for uploads
export const generateFileName = (originalName: string, userId: number): string => {
  const ext = originalName.split('.').pop();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${userId}/${timestamp}_${random}.${ext}`;
};

// Sanitize HTML (basic)
export const sanitizeHtml = (html: string): string => {
  return html
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// Format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Get sort clause for SQL
export const getSortClause = (sort: string): string => {
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
};
