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

export default channel;
