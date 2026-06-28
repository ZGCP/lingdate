// Middleware for authentication, admin access, and CORS

import { Hono, Context } from 'hono';
import type { Env, JWTPayload } from './types';
import { verifyJWT, getUserFromRequest, errorResponse } from './utils';

// CORS middleware
export const corsMiddleware = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  // Handle preflight requests
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // Set CORS headers for all responses
  await next();
  
  c.res = new Response(c.res.body, {
    status: c.res.status,
    headers: {
      ...Object.fromEntries(c.res.headers.entries()),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
};

// Auth middleware - requires valid JWT token
export const authMiddleware = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  const payload = await getUserFromRequest(c.req.raw, c.env);

  if (!payload) {
    return errorResponse('Unauthorized - Invalid or missing token', 401);
  }

  // Attach user to context
  c.set('user', payload);
  await next();
};

// Admin middleware - requires admin role
export const adminMiddleware = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  const user = c.get('user') as JWTPayload | undefined;

  if (!user) {
    return errorResponse('Unauthorized - Invalid or missing token', 401);
  }

  if (user.role !== 'admin') {
    return errorResponse('Forbidden - Admin access required', 403);
  }

  await next();
};

// Reviewer or Admin middleware - requires reviewer or admin role
export const reviewerMiddleware = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  const user = c.get('user') as JWTPayload | undefined;

  if (!user) {
    return errorResponse('Unauthorized - Invalid or missing token', 401);
  }

  if (user.role !== 'admin' && user.role !== 'reviewer') {
    return errorResponse('Forbidden - Reviewer or Admin access required', 403);
  }

  await next();
};

// Email verified middleware - requires verified email
export const emailVerifiedMiddleware = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  const user = c.get('user') as JWTPayload | undefined;

  if (!user) {
    return errorResponse('Unauthorized - Invalid or missing token', 401);
  }

  // Get full user data to check email_verified
  const db = new (await import('./db')).DB(c.env.DB);
  const fullUser = await db.getUserById(user.userId);

  if (!fullUser || fullUser.email_verified !== 1) {
    return errorResponse('Email verification required', 403);
  }

  await next();
};

// Helper to get current user from context
export const getCurrentUser = (c: Context<{ Bindings: Env }>): JWTPayload | undefined => {
  return c.get('user');
};
