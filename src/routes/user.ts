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

  // 从请求头中获取当前使用的token并返回，确保前端刷新用户数据时不会丢失token
  const authHeader = c.req.header('Authorization');
  const currentToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

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
      sidebar_modules: user.sidebar_modules || null,
      token: currentToken,  // 返回当前使用的token，防止前端刷新时丢失
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

// GET /api/user/2fa/status - 获取2FA状态 (Workers版本不支持2FA，返回未启用)
user.get('/2fa/status', jwtAuth(), async (c) => {
  return c.json({
    success: true,
    message: '',
    data: {
      enabled: false,
      has_backup_codes: false,
    },
  });
});

// GET /api/user/passkey - 获取Passkey状态 (Workers版本不支持Passkey)
user.get('/passkey', jwtAuth(), async (c) => {
  return c.json({
    success: true,
    message: '',
    data: {
      enabled: false,
      credentials: [],
    },
  });
});

// GET /api/user/token - 生成访问令牌
user.get('/token', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env.DB);
  const user = await userService.findById(userId);

  if (!user) {
    return c.json({ success: false, message: 'User not found' }, 404);
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

  return c.json({
    success: true,
    message: '',
    data: token,
  });
});

// PUT /api/user/setting - 更新用户设置
user.put('/setting', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ sidebar_modules?: string }>();

  if (body.sidebar_modules !== undefined) {
    const stmt = c.env.DB.prepare(
      `UPDATE users SET sidebar_modules = ?, updated_at = datetime("now") WHERE id = ?`
    ).bind(body.sidebar_modules, userId);
    await stmt.run();
  }

  return c.json({ success: true, message: 'Settings updated' });
});

// GET /api/user/aff - 获取用户推广信息
user.get('/aff', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env.DB);
  const user = await userService.findById(userId);

  if (!user) {
    return c.json({ success: false, message: 'User not found' }, 404);
  }

  // Workers版本简化实现，返回基本推广数据
  return c.json({
    success: true,
    message: '',
    data: {
      aff_code: user.aff_code || `aff_${userId}`,
      aff_count: user.aff_count || 0,
      aff_quota: user.aff_quota || 0,
      aff_history_quota: user.aff_history_quota || 0,
    },
  });
});

// GET /api/user/topup/info - 获取充值配置信息
user.get('/topup/info', jwtAuth(), async (c) => {
  // Workers版本简化实现，返回基本充值配置
  return c.json({
    success: true,
    message: '',
    data: {
      min_topup: 1,
      topup_group_ratio: {},
      enable_online_topup: false,
      payment_address: '',
      topup_ratio: 1,
    },
  });
});

// GET /api/user/topup - 获取充值记录列表
user.get('/topup', jwtAuth(), async (c) => {
  // Workers版本简化实现，返回空列表
  const page = parseInt(c.req.query('p') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);

  return c.json({
    success: true,
    message: '',
    data: {
      items: [],
      total: 0,
      page,
      page_size: pageSize,
    },
  });
});

// POST /api/user/topup - 创建充值订单 (Workers版本不支持)
user.post('/topup', jwtAuth(), async (c) => {
  return c.json({
    success: false,
    message: 'Online topup is not supported in Workers version',
  }, 501);
});

// GET /api/user/amount - 获取用户余额金额信息
user.get('/amount', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const userService = new UserService(c.env.DB);
  const user = await userService.findById(userId);

  if (!user) {
    return c.json({ success: false, message: 'User not found' }, 404);
  }

  // 返回用户额度信息
  return c.json({
    success: true,
    message: '',
    data: {
      balance: user.quota || 0,
      used_amount: user.used_quota || 0,
      currency: 'quota',
    },
  });
});

// POST /api/user/amount - 计算充值金额
user.post('/amount', jwtAuth(), async (c) => {
  const body = await c.req.json<{ amount: number }>();
  const amount = body.amount || 0;

  if (amount <= 0) {
    return c.json({ message: 'success', data: 0 });
  }

  const optionService = new OptionService(c.env.DB);
  const price = await optionService.getFloat('price', 1);

  const totalAmount = amount * price;

  return c.json({
    message: 'success',
    data: totalAmount,
  });
});

// GET /api/user/ - 获取用户列表 (���理员)
user.get('/', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const page = parseInt(c.req.query('p') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);
  const offset = (page - 1) * pageSize;

  try {
    // 获取用户列表
    const stmt = c.env.DB.prepare(`
      SELECT id, username, display_name, email, role, status, quota, used_quota,
             request_count, created_at, \`group\`
      FROM users
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).bind(pageSize, offset);

    const result = await stmt.all();

    // 获取总数
    const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM users').first<{total: number}>();
    const total = countResult?.total || 0;

    return c.json({
      success: true,
      message: '',
      data: {
        items: result.results || [],
        page: page,
        total: total,
      },
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    return c.json({ success: true, message: '', data: { items: [], page: 1, total: 0 } });
  }
});

// POST /api/user/manage - 管理用户 (管理员)
user.post('/manage', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const body = await c.req.json<{
    id: number;
    action: string;
    value?: number | string;
  }>();

  const { id, action, value } = body;

  try {
    switch (action) {
      case 'delete':
        await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
        break;
      case 'status':
        await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(value, id).run();
        break;
      case 'role':
        await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(value, id).run();
        break;
      case 'quota':
        await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(value, id).run();
        break;
      default:
        return c.json({ success: false, message: 'Unknown action' }, 400);
    }

    return c.json({ success: true, message: 'User updated' });
  } catch (err) {
    console.error('Error managing user:', err);
    return c.json({ success: false, message: 'Failed to manage user' }, 500);
  }
});

// DELETE /api/user/:id - 删除用户 (管理员)
user.delete('/:id', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const targetId = parseInt(c.req.param('id'), 10);
  const currentUserId = c.get('userId');

  if (targetId === currentUserId) {
    return c.json({ success: false, message: 'Cannot delete yourself' }, 400);
  }

  try {
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
    return c.json({ success: true, message: 'User deleted' });
  } catch (err) {
    console.error('Error deleting user:', err);
    return c.json({ success: false, message: 'Failed to delete user' }, 500);
  }
});

export default user;
