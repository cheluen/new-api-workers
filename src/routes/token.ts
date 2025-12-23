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

// PUT /api/token/?status_only=true - 仅更新状态
token.put('/', async (c) => {
  const statusOnly = c.req.query('status_only') === 'true';

  if (!statusOnly) {
    // 没有status_only参数时使用/:id路由处理
    return c.json({ success: false, message: 'Use PUT /api/token/:id for full updates' }, 400);
  }

  const userId = c.get('userId');
  const body = await c.req.json<{
    id: number;
    status: number;
  }>();

  if (!body.id) {
    return c.json({ success: false, message: 'Token ID is required' }, 400);
  }

  const tokenService = new TokenService(c.env.DB);
  const token = await tokenService.findById(body.id);

  if (!token || token.user_id !== userId) {
    return c.json({ success: false, message: 'Token not found' }, 404);
  }

  const stmt = c.env.DB.prepare(`
    UPDATE tokens SET status = ?, updated_at = datetime("now") WHERE id = ?
  `).bind(body.status, body.id);
  await stmt.run();

  return c.json({ success: true, message: 'Token status updated' });
});

// GET /api/token/search - 搜索令牌
token.get('/search', async (c) => {
  const userId = c.get('userId');
  const keyword = c.req.query('keyword') || '';
  const tokenKey = c.req.query('token') || '';

  try {
    let sql = `
      SELECT id, user_id, key, name, status, quota, used_quota, request_count,
             models, subnet, expired_at, created_at, updated_at
      FROM tokens
      WHERE user_id = ?
    `;
    const params: (string | number)[] = [userId];

    if (keyword) {
      sql += ` AND name LIKE ?`;
      params.push(`%${keyword}%`);
    }
    if (tokenKey) {
      sql += ` AND key LIKE ?`;
      params.push(`%${tokenKey}%`);
    }

    sql += ` ORDER BY id DESC LIMIT 50`;

    const stmt = c.env.DB.prepare(sql).bind(...params);
    const result = await stmt.all();

    const safeTokens = (result.results || []).map((t: Record<string, unknown>) => ({
      ...t,
      key: String(t.key || '').substring(0, 8) + '...',
    }));

    return c.json({
      success: true,
      message: '',
      data: safeTokens,
    });
  } catch (err) {
    console.error('Token search error:', err);
    return c.json({ success: true, message: '', data: [] });
  }
});

// POST /api/token/batch - 批量删除令牌
token.post('/batch', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    ids: number[];
  }>();

  if (!body.ids || body.ids.length === 0) {
    return c.json({ success: false, message: 'No token IDs provided' }, 400);
  }

  try {
    const placeholders = body.ids.map(() => '?').join(',');
    const stmt = c.env.DB.prepare(`
      DELETE FROM tokens WHERE id IN (${placeholders}) AND user_id = ?
    `).bind(...body.ids, userId);

    const result = await stmt.run();

    return c.json({
      success: true,
      message: `Deleted ${result.meta?.changes || 0} tokens`,
      data: { deleted: result.meta?.changes || 0 },
    });
  } catch (err) {
    console.error('Batch delete error:', err);
    return c.json({ success: false, message: 'Failed to delete tokens' }, 500);
  }
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
