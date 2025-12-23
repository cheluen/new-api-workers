import { Hono } from 'hono';
import type { CloudflareBindings, JwtPayload } from '../types';
import { UserService, OptionService } from '../db';
import { signJwt } from '../utils';
import { jwtAuth } from '../middleware';

type Variables = {
  jwtPayload: JwtPayload;
  userId: number;
  userRole: number;
};

const user = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

user.post('/register', async (c) => {
  const optionService = new OptionService(c.env.DB);
  const registerEnabled = await optionService.getBool('register_enabled', true);

  if (!registerEnabled) {
    return c.json({ success: false, message: 'Registration is disabled' }, 403);
  }

  const body = await c.req.json<{
    username: string;
    password: string;
    email?: string;
  }>();

  if (!body.username || !body.password) {
    return c.json({ success: false, message: 'Username and password are required' }, 400);
  }

  if (body.username.length < 3 || body.username.length > 32) {
    return c.json({ success: false, message: 'Username must be 3-32 characters' }, 400);
  }

  if (body.password.length < 6) {
    return c.json({ success: false, message: 'Password must be at least 6 characters' }, 400);
  }

  const userService = new UserService(c.env.DB);
  const existing = await userService.findByUsername(body.username);

  if (existing) {
    return c.json({ success: false, message: 'Username already exists' }, 409);
  }

  const defaultQuota = await optionService.getInt('default_quota', 0);

  try {
    const userId = await userService.create({
      username: body.username,
      password: body.password,
      email: body.email,
      quota: defaultQuota,
    });

    return c.json({
      success: true,
      message: 'Registration successful',
      data: { user_id: userId },
    });
  } catch (err) {
    console.error('Registration error:', err);
    return c.json({ success: false, message: 'Registration failed' }, 500);
  }
});

user.post('/login', async (c) => {
  const body = await c.req.json<{
    username: string;
    password: string;
  }>();

  if (!body.username || !body.password) {
    return c.json({ success: false, message: 'Username and password are required' }, 400);
  }

  const userService = new UserService(c.env.DB);
  const user = await userService.verifyCredentials(body.username, body.password);

  if (!user) {
    return c.json({ success: false, message: 'Invalid username or password' }, 401);
  }

  const expiryHours = parseInt(c.env.TOKEN_EXPIRY_HOURS || '24', 10);
  const token = await signJwt(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
    },
    c.env.JWT_SECRET,
    expiryHours
  );

  // 返回用户对象，token 嵌入其中（前端期望 data 直接是用户对象，含 token 字段）
  return c.json({
    success: true,
    message: '',
    data: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      status: user.status || 1,
      group: user.group || 'default',
      quota: user.quota,
      used_quota: user.used_quota,
      token,  // JWT token 嵌入用户对象
    },
  });
});

user.get('/self', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env.DB);
  const user = await userService.findById(userId);

  if (!user) {
    return c.json({ success: false, message: 'User not found' }, 404);
  }

  return c.json({
    success: true,
    data: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      status: user.status || 1,
      group: user.group || 'default',
      quota: user.quota,
      used_quota: user.used_quota,
      request_count: user.request_count,
      created_at: user.created_at,
      sidebar_modules: user.sidebar_modules || null,  // 用户侧边栏配置
    },
  });
});

user.put('/self', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    display_name?: string;
    email?: string;
    password?: string;
    current_password?: string;
  }>();

  const userService = new UserService(c.env.DB);
  const user = await userService.findById(userId);

  if (!user) {
    return c.json({ success: false, message: 'User not found' }, 404);
  }

  if (body.password) {
    if (!body.current_password) {
      return c.json({ success: false, message: 'Current password is required' }, 400);
    }

    const verifiedUser = await userService.verifyCredentials(user.username, body.current_password);
    if (!verifiedUser) {
      return c.json({ success: false, message: 'Current password is incorrect' }, 401);
    }

    if (body.password.length < 6) {
      return c.json({ success: false, message: 'New password must be at least 6 characters' }, 400);
    }

    await userService.updatePassword(userId, body.password);
  }

  if (body.display_name || body.email) {
    const stmt = c.env.DB.prepare(
      `UPDATE users SET display_name = COALESCE(?, display_name), email = COALESCE(?, email),
       updated_at = datetime("now") WHERE id = ?`
    ).bind(body.display_name || null, body.email || null, userId);
    await stmt.run();
  }

  return c.json({ success: true, message: 'Profile updated' });
});

// GET /api/user/logout - 用户登出
user.get('/logout', async (c) => {
  // JWT是无状态的，前端只需清除本地存储的token
  // 服务端返回成功即可
  return c.json({ success: true, message: '' });
});

// GET /api/user/models - 获取用户可用模型列表
user.get('/models', jwtAuth(), async (c) => {
  const { ChannelService } = await import('../db');
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

// GET /api/user/groups - 获取用户组列表 (公开端点)
user.get('/groups', async (c) => {
  // Workers版本简化实现，返回默认分组
  return c.json({
    success: true,
    message: '',
    data: ['default'],
  });
});

// GET /api/user/self/groups - 获取当前用户分组
user.get('/self/groups', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env.DB);
  const user = await userService.findById(userId);

  return c.json({
    success: true,
    message: '',
    data: user?.group ? [user.group] : ['default'],
  });
});

export default user;
