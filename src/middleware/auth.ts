import { Context, Next } from 'hono';
import type { CloudflareBindings, JwtPayload } from '../types';
import { verifyJwt, parseAuthHeader } from '../utils';
import { TokenService, UserService } from '../db';
import { UserRole } from '../types';

type Variables = {
  jwtPayload: JwtPayload;
  userId: number;
  userRole: number;
};

export const jwtAuth = () => {
  return async (c: Context<{ Bindings: CloudflareBindings; Variables: Variables }>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const token = parseAuthHeader(authHeader);

    if (!token) {
      return c.json({ success: false, message: 'Missing authorization header' }, 401);
    }

    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (!payload) {
      return c.json({ success: false, message: 'Invalid or expired token' }, 401);
    }

    c.set('jwtPayload', payload);
    c.set('userId', payload.sub);
    c.set('userRole', payload.role);

    await next();
  };
};

export const requireAdmin = () => {
  return async (c: Context<{ Bindings: CloudflareBindings; Variables: Variables }>, next: Next) => {
    const role = c.get('userRole');
    if (role < UserRole.ADMIN) {
      return c.json({ success: false, message: 'Admin access required' }, 403);
    }
    await next();
  };
};

export const requireRoot = () => {
  return async (c: Context<{ Bindings: CloudflareBindings; Variables: Variables }>, next: Next) => {
    const role = c.get('userRole');
    if (role < UserRole.ROOT) {
      return c.json({ success: false, message: 'Root access required' }, 403);
    }
    await next();
  };
};

type ApiKeyVariables = {
  tokenId: number;
  userId: number;
  tokenModels: string;
};

export const apiKeyAuth = () => {
  return async (
    c: Context<{ Bindings: CloudflareBindings; Variables: ApiKeyVariables }>,
    next: Next
  ) => {
    const authHeader = c.req.header('Authorization');
    const key = parseAuthHeader(authHeader);

    if (!key) {
      return c.json(
        {
          error: {
            message: 'Missing API key in Authorization header',
            type: 'invalid_request_error',
            code: 'missing_api_key',
          },
        },
        401
      );
    }

    const tokenService = new TokenService(c.env.DB);
    const token = await tokenService.validateAndGet(key);

    if (!token) {
      return c.json(
        {
          error: {
            message: 'Invalid or expired API key',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
        401
      );
    }

    const userService = new UserService(c.env.DB);
    const user = await userService.findById(token.user_id);

    if (!user || user.status !== 1) {
      return c.json(
        {
          error: {
            message: 'User account is disabled',
            type: 'invalid_request_error',
            code: 'user_disabled',
          },
        },
        403
      );
    }

    c.set('tokenId', token.id);
    c.set('userId', token.user_id);
    c.set('tokenModels', token.models);

    await next();
  };
};
