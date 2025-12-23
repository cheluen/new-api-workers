import { Hono } from 'hono';
import type { CloudflareBindings, JwtPayload } from '../types';
import { ChannelService } from '../db';
import { jwtAuth, requireAdmin } from '../middleware';
import { ChannelType, UserRole } from '../types';

type Variables = {
  jwtPayload: JwtPayload;
  userId: number;
  userRole: number;
};

const channel = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

channel.use('/*', jwtAuth());
channel.use('/*', requireAdmin());

channel.get('/', async (c) => {
  const channelService = new ChannelService(c.env.DB);
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const channels = await channelService.list(limit, offset);
  const userRole = c.get('userRole');

  const safeChannels = channels.map((ch) => ({
    id: ch.id,
    name: ch.name,
    type: ch.type,
    key: userRole >= UserRole.ROOT ? ch.key : ch.key.substring(0, 8) + '...',
    base_url: ch.base_url,
    models: ch.models,
    model_mapping: ch.model_mapping,
    status: ch.status,
    priority: ch.priority,
    weight: ch.weight,
    created_at: ch.created_at,
    updated_at: ch.updated_at,
  }));

  return c.json({ success: true, data: safeChannels });
});

channel.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    type: number;
    key: string;
    base_url: string;
    models?: string;
    model_mapping?: string;
    priority?: number;
    weight?: number;
  }>();

  if (!body.name || !body.key || !body.base_url) {
    return c.json({ success: false, message: 'Name, key, and base_url are required' }, 400);
  }

  const channelService = new ChannelService(c.env.DB);

  try {
    const channelId = await channelService.create({
      name: body.name,
      type: body.type || ChannelType.OPENAI,
      key: body.key,
      baseUrl: body.base_url,
      models: body.models,
      modelMapping: body.model_mapping,
      priority: body.priority,
      weight: body.weight,
    });

    return c.json({
      success: true,
      message: 'Channel created',
      data: { id: channelId },
    });
  } catch (err) {
    console.error('Channel creation error:', err);
    return c.json({ success: false, message: 'Failed to create channel' }, 500);
  }
});

// 静态路由必须在动态路由 /:id 之前定义
channel.get('/types/list', async (c) => {
  return c.json({
    success: true,
    data: [
      { id: ChannelType.OPENAI, name: 'OpenAI' },
      { id: ChannelType.AZURE, name: 'Azure OpenAI' },
      { id: ChannelType.ANTHROPIC, name: 'Anthropic Claude' },
      { id: ChannelType.GOOGLE, name: 'Google Gemini' },
      { id: ChannelType.CUSTOM, name: 'Custom' },
    ],
  });
});

// GET /api/channel/models_enabled - 获取已启用渠道的模型列表
channel.get('/models_enabled', async (c) => {
  const channelService = new ChannelService(c.env.DB);
  const channels = await channelService.findEnabled();

  const modelsSet = new Set<string>();
  for (const ch of channels) {
    if (ch.models) {
      const models = ch.models.split(',').map((m: string) => m.trim());
      for (const model of models) {
        if (model && model !== '*') {
          modelsSet.add(model);
        }
      }
    }
  }

  return c.json({
    success: true,
    message: '',
    data: Array.from(modelsSet),
  });
});

// GET /api/channel/models - 别名, 获取已启用渠道的模型列表
channel.get('/models', async (c) => {
  const channelService = new ChannelService(c.env.DB);
  const channels = await channelService.findEnabled();

  const modelsSet = new Set<string>();
  for (const ch of channels) {
    if (ch.models) {
      const models = ch.models.split(',').map((m: string) => m.trim());
      for (const model of models) {
        if (model && model !== '*') {
          modelsSet.add(model);
        }
      }
    }
  }

  return c.json({
    success: true,
    message: '',
    data: Array.from(modelsSet),
  });
});

// GET /api/channel/test/:id - 测试渠道连通性
channel.get('/test/:id', async (c) => {
  const channelId = parseInt(c.req.param('id'), 10);
  const model = c.req.query('model') || '';
  const channelService = new ChannelService(c.env.DB);
  const ch = await channelService.findById(channelId);

  if (!ch) {
    return c.json({ success: false, message: 'Channel not found' }, 404);
  }

  // 简化的渠道测试：尝试向渠道发送一个简单请求
  try {
    const testModel = model || (ch.models ? ch.models.split(',')[0].trim() : 'gpt-3.5-turbo');
    const baseUrl = ch.base_url.replace(/\/$/, '');

    // 根据渠道类型构建测试请求
    const testUrl = `${baseUrl}/v1/models`;
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ch.key}`,
        'Content-Type': 'application/json',
      },
    });

    const latency = 0; // 简化版本不计算延迟

    if (response.ok) {
      return c.json({
        success: true,
        message: 'Channel test passed',
        data: {
          latency,
          model: testModel,
        },
      });
    } else {
      return c.json({
        success: false,
        message: `Channel test failed: HTTP ${response.status}`,
      });
    }
  } catch (err) {
    console.error('Channel test error:', err);
    return c.json({
      success: false,
      message: `Channel test failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
});

// GET /api/channel/update_balance/:id - 更新渠道余额
channel.get('/update_balance/:id', async (c) => {
  const channelId = parseInt(c.req.param('id'), 10);
  const channelService = new ChannelService(c.env.DB);
  const ch = await channelService.findById(channelId);

  if (!ch) {
    return c.json({ success: false, message: 'Channel not found' }, 404);
  }

  // Workers版本简化实现：返回当前余额状态
  // 实际的余额查询需要根据不同渠道类型调用不同的API
  return c.json({
    success: true,
    message: 'Balance check not supported in Workers version',
    data: {
      balance: 0,
      balance_updated_at: new Date().toISOString(),
    },
  });
});

// GET /api/channel/search - 搜索渠道
channel.get('/search', async (c) => {
  const keyword = c.req.query('keyword') || '';

  try {
    const stmt = c.env.DB.prepare(`
      SELECT * FROM channels
      WHERE name LIKE ? OR models LIKE ?
      ORDER BY priority DESC, id DESC
      LIMIT 50
    `).bind(`%${keyword}%`, `%${keyword}%`);

    const result = await stmt.all();

    const userRole = c.get('userRole');
    const safeChannels = (result.results || []).map((ch: Record<string, unknown>) => ({
      ...ch,
      key: userRole >= UserRole.ROOT ? ch.key : String(ch.key || '').substring(0, 8) + '...',
    }));

    return c.json({ success: true, data: safeChannels });
  } catch (err) {
    console.error('Channel search error:', err);
    return c.json({ success: true, data: [] });
  }
});

// 动态路由放在静态路由之后
channel.get('/:id', async (c) => {
  const channelId = parseInt(c.req.param('id'), 10);
  const channelService = new ChannelService(c.env.DB);
  const channel = await channelService.findById(channelId);

  if (!channel) {
    return c.json({ success: false, message: 'Channel not found' }, 404);
  }

  const userRole = c.get('userRole');

  return c.json({
    success: true,
    data: {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      key: userRole >= UserRole.ROOT ? channel.key : channel.key.substring(0, 8) + '...',
      base_url: channel.base_url,
      models: channel.models,
      model_mapping: channel.model_mapping,
      status: channel.status,
      priority: channel.priority,
      weight: channel.weight,
      created_at: channel.created_at,
      updated_at: channel.updated_at,
    },
  });
});

channel.put('/:id', async (c) => {
  const channelId = parseInt(c.req.param('id'), 10);
  const channelService = new ChannelService(c.env.DB);
  const channel = await channelService.findById(channelId);

  if (!channel) {
    return c.json({ success: false, message: 'Channel not found' }, 404);
  }

  const body = await c.req.json<{
    name?: string;
    type?: number;
    key?: string;
    base_url?: string;
    models?: string;
    model_mapping?: string;
    status?: number;
    priority?: number;
    weight?: number;
  }>();

  try {
    await channelService.update(channelId, {
      name: body.name,
      type: body.type,
      key: body.key,
      baseUrl: body.base_url,
      models: body.models,
      modelMapping: body.model_mapping,
      status: body.status,
      priority: body.priority,
      weight: body.weight,
    });

    return c.json({ success: true, message: 'Channel updated' });
  } catch (err) {
    console.error('Channel update error:', err);
    return c.json({ success: false, message: 'Failed to update channel' }, 500);
  }
});

channel.delete('/:id', async (c) => {
  const channelId = parseInt(c.req.param('id'), 10);
  const channelService = new ChannelService(c.env.DB);
  const channel = await channelService.findById(channelId);

  if (!channel) {
    return c.json({ success: false, message: 'Channel not found' }, 404);
  }

  await channelService.delete(channelId);
  return c.json({ success: true, message: 'Channel deleted' });
});

// PUT /api/channel/ - 更新渠道 (不带ID，从body获取)
channel.put('/', async (c) => {
  const body = await c.req.json<{
    id: number;
    name?: string;
    type?: number;
    key?: string;
    base_url?: string;
    models?: string;
    model_mapping?: string;
    status?: number;
    priority?: number;
    weight?: number;
  }>();

  if (!body.id) {
    return c.json({ success: false, message: 'Channel ID is required' }, 400);
  }

  const channelService = new ChannelService(c.env.DB);
  const channel = await channelService.findById(body.id);

  if (!channel) {
    return c.json({ success: false, message: 'Channel not found' }, 404);
  }

  try {
    await channelService.update(body.id, {
      name: body.name,
      type: body.type,
      key: body.key,
      baseUrl: body.base_url,
      models: body.models,
      modelMapping: body.model_mapping,
      status: body.status,
      priority: body.priority,
      weight: body.weight,
    });

    return c.json({ success: true, message: 'Channel updated' });
  } catch (err) {
    console.error('Channel update error:', err);
    return c.json({ success: false, message: 'Failed to update channel' }, 500);
  }
});

export default channel;
