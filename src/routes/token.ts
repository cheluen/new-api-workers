import { Hono } from 'hono';
import type { CloudflareBindings, JwtPayload } from '../types';
import { TokenService } from '../db';
import { jwtAuth } from '../middleware';
import { generateApiKey } from '../utils';

type Variables = {
  jwtPayload: JwtPayload;
  userId: number;
  userRole: number;
};

const token = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

token.use('/*', jwtAuth());

token.get('/', async (c) => {
  const userId = c.get('userId');
  const tokenService = new TokenService(c.env.DB);
  const tokens = await tokenService.findByUserId(userId);

  const safeTokens = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    key: t.key.substring(0, 8) + '...',
    status: t.status,
    quota: t.quota,
    used_quota: t.used_quota,
    request_count: t.request_count,
    models: t.models,
    expired_at: t.expired_at,
    created_at: t.created_at,
  }));

  return c.json({ success: true, data: safeTokens });
});

token.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    name: string;
    quota?: number;
    models?: string;
    expired_at?: string;
  }>();

  if (!body.name) {
    return c.json({ success: false, message: 'Token name is required' }, 400);
  }

  const key = generateApiKey('sk');
  const tokenService = new TokenService(c.env.DB);

  try {
    const tokenId = await tokenService.create({
      userId,
      key,
      name: body.name,
      quota: body.quota,
      models: body.models,
      expiredAt: body.expired_at,
    });

    return c.json({
      success: true,
      message: 'Token created',
      data: { id: tokenId, key },
    });
  } catch (err) {
    console.error('Token creation error:', err);
    return c.json({ success: false, message: 'Failed to create token' }, 500);
  }
});

token.get('/:id', async (c) => {
  const userId = c.get('userId');
  const tokenId = parseInt(c.req.param('id'), 10);

  const tokenService = new TokenService(c.env.DB);
  const token = await tokenService.findById(tokenId);

  if (!token || token.user_id !== userId) {
    return c.json({ success: false, message: 'Token not found' }, 404);
  }

  return c.json({
    success: true,
    data: {
      id: token.id,
      name: token.name,
      key: token.key,
      status: token.status,
      quota: token.quota,
      used_quota: token.used_quota,
      request_count: token.request_count,
      models: token.models,
      subnet: token.subnet,
      expired_at: token.expired_at,
      created_at: token.created_at,
      updated_at: token.updated_at,
    },
  });
});

token.put('/:id', async (c) => {
  const userId = c.get('userId');
  const tokenId = parseInt(c.req.param('id'), 10);

  const tokenService = new TokenService(c.env.DB);
  const token = await tokenService.findById(tokenId);

  if (!token || token.user_id !== userId) {
    return c.json({ success: false, message: 'Token not found' }, 404);
  }

  const body = await c.req.json<{
    name?: string;
    status?: number;
    quota?: number;
    models?: string;
    expired_at?: string | null;
  }>();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    fields.push('name = ?');
    values.push(body.name);
  }
  if (body.status !== undefined) {
    fields.push('status = ?');
    values.push(body.status);
  }
  if (body.quota !== undefined) {
    fields.push('quota = ?');
    values.push(body.quota);
  }
  if (body.models !== undefined) {
    fields.push('models = ?');
    values.push(body.models);
  }
  if (body.expired_at !== undefined) {
    fields.push('expired_at = ?');
    values.push(body.expired_at);
  }

  if (fields.length > 0) {
    fields.push('updated_at = datetime("now")');
    values.push(tokenId);
    const sql = `UPDATE tokens SET ${fields.join(', ')} WHERE id = ?`;
    await c.env.DB.prepare(sql).bind(...values).run();
  }

  return c.json({ success: true, message: 'Token updated' });
});

token.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const tokenId = parseInt(c.req.param('id'), 10);

  const tokenService = new TokenService(c.env.DB);
  const token = await tokenService.findById(tokenId);

  if (!token || token.user_id !== userId) {
    return c.json({ success: false, message: 'Token not found' }, 404);
  }

  await tokenService.delete(tokenId);
  return c.json({ success: true, message: 'Token deleted' });
});

export default token;
