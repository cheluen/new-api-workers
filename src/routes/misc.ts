import { Hono } from 'hono';
import type { CloudflareBindings, JwtPayload } from '../types';
import { OptionService } from '../db';
import { jwtAuth } from '../middleware';

type Variables = {
  jwtPayload: JwtPayload;
  userId: number;
  userRole: number;
};

const misc = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// 版本号
const VERSION = '1.0.0-workers';
const START_TIME = Date.now();

// GET /api/home_page_content - 获取首页内容 (无需认证)
misc.get('/home_page_content', async (c) => {
  const optionService = new OptionService(c.env.DB);
  const content = await optionService.get('home_page_content', '');

  return c.json({
    success: true,
    message: '',
    data: content || '',  // 确保返回字符串，前端需要调用 .trim()
  });
});

// GET /api/notice - 获取公告内容 (无需认证)
misc.get('/notice', async (c) => {
  const optionService = new OptionService(c.env.DB);
  const notice = await optionService.get('notice', '');

  // 返回字符串格式的公告，前端需要调用 .trim()
  return c.json({
    success: true,
    message: '',
    data: notice || '',
  });
});

// GET /api/status - 获取系统状态 (无需认证)
misc.get('/status', async (c) => {
  const optionService = new OptionService(c.env.DB);

  // 获取基本配置选项
  const systemName = await optionService.get('system_name', 'New API');
  const logo = await optionService.get('logo', '');
  const footerHtml = await optionService.get('footer_html', '');
  const registerEnabled = await optionService.getBool('register_enabled', true);
  const quotaPerUnit = await optionService.getInt('quota_per_unit', 500000);

  const data = {
    version: VERSION,
    start_time: START_TIME,
    system_name: systemName || 'New API',
    logo: logo || '',
    footer_html: footerHtml || '',
    register_enabled: registerEnabled,

    // OAuth相关 - Workers版本暂不支持
    email_verification: false,
    github_oauth: false,
    github_client_id: '',
    discord_oauth: false,
    discord_client_id: '',
    linuxdo_oauth: false,
    linuxdo_client_id: '',
    telegram_oauth: false,
    telegram_bot_name: '',
    wechat_login: false,
    wechat_qrcode: '',
    oidc_enabled: false,
    oidc_client_id: '',
    oidc_authorization_endpoint: '',
    passkey_login: false,
    turnstile_check: false,
    turnstile_site_key: '',

    // 功能开关
    enable_batch_update: false,
    enable_drawing: false,
    enable_task: false,
    enable_data_export: true,
    data_export_default_time: 'hour',
    default_collapse_sidebar: false,
    mj_notify_enabled: false,
    demo_site_enabled: false,
    self_use_mode_enabled: false,
    default_use_auto_group: true,

    // 配额相关
    quota_per_unit: quotaPerUnit,
    display_in_currency: false,
    quota_display_type: 'quota',

    // 链接
    top_up_link: '',
    docs_link: '',
    server_address: '',

    // 面板开关
    api_info_enabled: true,
    uptime_kuma_enabled: false,
    announcements_enabled: false,
    faq_enabled: false,

    // 模块配置 - 返回JSON字符串，前端会用 JSON.parse 解析
    // SidebarModulesAdmin 必须包含完整的侧边栏配置，否则侧边栏会显示skeleton加载状态
    HeaderNavModules: '[]',
    SidebarModulesAdmin: JSON.stringify({
      chat: {
        enabled: true,
        playground: true,
        chat: true,
      },
      console: {
        enabled: true,
        detail: true,
        token: true,
        log: true,
        midjourney: false,  // Workers版本暂不支持
        task: false,        // Workers版本暂不支持
      },
      personal: {
        enabled: true,
        topup: false,       // Workers版本暂不支持充值
        personal: true,
      },
      admin: {
        enabled: true,
        channel: true,
        models: true,
        redemption: false,  // Workers版本暂不支持兑换码
        user: true,
        setting: true,
      },
    }),

    // 法律条款
    user_agreement_enabled: false,
    privacy_policy_enabled: false,

    // 设置 - 已完成初始化
    setup: true,
    chats: [],

    // 价格相关
    usd_exchange_rate: 7.3,
    price: 1,
    stripe_unit_price: 0,
  };

  return c.json({
    success: true,
    message: '',
    data,
  });
});

// GET /api/data/ - 获取所有用户数据统计 (管理员专用，兼容原始API格式)
misc.get('/data', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');

  // 检查是否是管理员 (role >= 10)
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  // 获取查询参数
  const startTimestamp = parseInt(c.req.query('start_timestamp') || '0', 10);
  const endTimestamp = parseInt(c.req.query('end_timestamp') || String(Math.floor(Date.now() / 1000)), 10);
  const username = c.req.query('username') || '';

  try {
    // 根据是否有 username 过滤构建查询
    let stmt;
    if (username) {
      stmt = c.env.DB.prepare(`
        SELECT
          l.model as model_name,
          strftime('%s', date(l.created_at)) as created_at,
          SUM(l.prompt_tokens + l.completion_tokens) as token_used,
          COUNT(*) as count,
          SUM(l.quota) as quota,
          l.user_id,
          u.username
        FROM logs l
        LEFT JOIN users u ON l.user_id = u.id
        WHERE l.created_at >= datetime(?, 'unixepoch')
          AND l.created_at <= datetime(?, 'unixepoch')
          AND u.username LIKE ?
        GROUP BY l.model, date(l.created_at), l.user_id
        ORDER BY l.created_at ASC
      `).bind(startTimestamp, endTimestamp, `%${username}%`);
    } else {
      stmt = c.env.DB.prepare(`
        SELECT
          l.model as model_name,
          strftime('%s', date(l.created_at)) as created_at,
          SUM(l.prompt_tokens + l.completion_tokens) as token_used,
          COUNT(*) as count,
          SUM(l.quota) as quota,
          l.user_id,
          u.username
        FROM logs l
        LEFT JOIN users u ON l.user_id = u.id
        WHERE l.created_at >= datetime(?, 'unixepoch')
          AND l.created_at <= datetime(?, 'unixepoch')
        GROUP BY l.model, date(l.created_at), l.user_id
        ORDER BY l.created_at ASC
      `).bind(startTimestamp, endTimestamp);
    }

    const result = await stmt.all();

    // 转换为原始 QuotaData 格式的数组
    const data = result.results.map((row: unknown, index: number) => {
      const r = row as {
        model_name: string;
        created_at: string;
        token_used: number;
        count: number;
        quota: number;
        user_id: number;
        username: string;
      };
      return {
        id: index + 1,
        user_id: r.user_id || 0,
        username: r.username || '',
        model_name: r.model_name || '',
        created_at: parseInt(r.created_at, 10) || 0,
        token_used: r.token_used || 0,
        count: r.count || 0,
        quota: r.quota || 0,
      };
    });

    return c.json({
      success: true,
      message: '',
      data,
    });
  } catch (err) {
    console.error('Error fetching admin data:', err);
    return c.json({
      success: true,
      message: '',
      data: [],
    });
  }
});

// GET /api/data/self/ - 获取用户使用数据统计 (兼容原始API格式)
misc.get('/data/self', jwtAuth(), async (c) => {
  const userId = c.get('userId');

  // 获取查询参数
  const startTimestamp = parseInt(c.req.query('start_timestamp') || '0', 10);
  const endTimestamp = parseInt(c.req.query('end_timestamp') || String(Math.floor(Date.now() / 1000)), 10);

  try {
    // 从 logs 表查询数据，按模型和时间分组，返回与原始 QuotaData 兼容的格式
    const stmt = c.env.DB.prepare(`
      SELECT
        model,
        strftime('%s', date(created_at)) as created_at,
        SUM(prompt_tokens + completion_tokens) as token_used,
        COUNT(*) as count,
        SUM(quota) as quota
      FROM logs
      WHERE user_id = ?
        AND created_at >= datetime(?, 'unixepoch')
        AND created_at <= datetime(?, 'unixepoch')
      GROUP BY model, date(created_at)
      ORDER BY created_at ASC
    `).bind(userId, startTimestamp, endTimestamp);

    const result = await stmt.all();

    // 转换为原始 QuotaData 格式的数组
    const data = result.results.map((row: unknown, index: number) => {
      const r = row as {
        model_name: string;
        created_at: string;
        token_used: number;
        count: number;
        quota: number;
      };
      return {
        id: index + 1,
        user_id: userId,
        username: '',  // 不需要用户名
        model_name: r.model_name || '',
        created_at: parseInt(r.created_at, 10) || 0,
        token_used: r.token_used || 0,
        count: r.count || 0,
        quota: r.quota || 0,
      };
    });

    return c.json({
      success: true,
      message: '',
      data,  // 返回数组格式
    });
  } catch (err) {
    console.error('Error fetching user data:', err);
    return c.json({
      success: true,
      message: '',
      data: [],  // 错误时返回空数组
    });
  }
});

// GET /api/uptime/status - Uptime 监控状态 (Workers版本不支持，返回空数组)
misc.get('/uptime/status', async (c) => {
  return c.json({
    success: true,
    message: '',
    data: [],  // Workers版本暂不支持Uptime监控
  });
});

// GET /api/option - 获取系统选项 (管理员)
misc.get('/option', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const optionService = new OptionService(c.env.DB);

  // 获取常用配置选项
  const options: Record<string, string> = {};
  const keys = [
    'system_name', 'logo', 'footer_html', 'home_page_content', 'notice',
    'register_enabled', 'quota_per_unit', 'default_quota',
  ];

  for (const key of keys) {
    options[key] = await optionService.get(key, '');
  }

  return c.json({
    success: true,
    message: '',
    data: options,
  });
});

// PUT /api/option - 更新系统选项 (管理员)
misc.put('/option', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 100) {
    return c.json({ success: false, message: 'Root permission required' }, 403);
  }

  const body = await c.req.json<Record<string, string>>();
  const optionService = new OptionService(c.env.DB);

  for (const [key, value] of Object.entries(body)) {
    await optionService.set(key, String(value));
  }

  return c.json({
    success: true,
    message: 'Options updated',
  });
});

// GET /api/group - 获取分组列表 (管理员)
misc.get('/group', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  // Workers版本简化实现，返回默认分组
  return c.json({
    success: true,
    message: '',
    data: [{ id: 'default', name: 'default' }],
  });
});

// GET /api/log/ - 获取所有日志 (管理员)
misc.get('/log', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const page = parseInt(c.req.query('p') || '0', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);
  const offset = page * pageSize;

  // 过滤参数
  const username = c.req.query('username') || '';
  const tokenName = c.req.query('token_name') || '';
  const modelName = c.req.query('model_name') || '';
  const startTimestamp = parseInt(c.req.query('start_timestamp') || '0', 10);
  const endTimestamp = parseInt(c.req.query('end_timestamp') || String(Math.floor(Date.now() / 1000)), 10);
  const channel = c.req.query('channel') || '';

  try {
    let sql = `
      SELECT l.id, l.user_id, u.username, l.channel_id, l.model as model,
             l.prompt_tokens, l.completion_tokens, l.quota,
             l.request_id, l.status_code as code, l.created_at, t.name as token_name
      FROM logs l
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN tokens t ON l.token_id = t.id
      WHERE l.created_at >= datetime(?, 'unixepoch')
        AND l.created_at <= datetime(?, 'unixepoch')
    `;
    const params: (string | number)[] = [startTimestamp, endTimestamp];

    if (username) {
      sql += ` AND u.username LIKE ?`;
      params.push(`%${username}%`);
    }
    if (tokenName) {
      sql += ` AND t.name LIKE ?`;
      params.push(`%${tokenName}%`);
    }
    if (modelName) {
      sql += ` AND l.model LIKE ?`;
      params.push(`%${modelName}%`);
    }
    if (channel) {
      sql += ` AND l.channel_id = ?`;
      params.push(parseInt(channel, 10));
    }

    sql += ` ORDER BY l.created_at DESC LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const stmt = c.env.DB.prepare(sql).bind(...params);
    const result = await stmt.all();

    return c.json({
      success: true,
      message: '',
      data: result.results || [],
    });
  } catch (err) {
    console.error('Error fetching admin logs:', err);
    return c.json({
      success: true,
      message: '',
      data: [],
    });
  }
});

// GET /api/log/stat - 获取所有日志统计 (管理员)
misc.get('/log/stat', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const startTimestamp = parseInt(c.req.query('start_timestamp') || '0', 10);
  const endTimestamp = parseInt(c.req.query('end_timestamp') || String(Math.floor(Date.now() / 1000)), 10);
  const username = c.req.query('username') || '';
  const tokenName = c.req.query('token_name') || '';
  const modelName = c.req.query('model_name') || '';
  const channel = c.req.query('channel') || '';

  try {
    let sql = `
      SELECT
        COUNT(*) as total_count,
        SUM(l.prompt_tokens) as total_prompt_tokens,
        SUM(l.completion_tokens) as total_completion_tokens,
        SUM(l.quota) as total_quota
      FROM logs l
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN tokens t ON l.token_id = t.id
      WHERE l.created_at >= datetime(?, 'unixepoch')
        AND l.created_at <= datetime(?, 'unixepoch')
    `;
    const params: (string | number)[] = [startTimestamp, endTimestamp];

    if (username) {
      sql += ` AND u.username LIKE ?`;
      params.push(`%${username}%`);
    }
    if (tokenName) {
      sql += ` AND t.name LIKE ?`;
      params.push(`%${tokenName}%`);
    }
    if (modelName) {
      sql += ` AND l.model LIKE ?`;
      params.push(`%${modelName}%`);
    }
    if (channel) {
      sql += ` AND l.channel_id = ?`;
      params.push(parseInt(channel, 10));
    }

    const stmt = c.env.DB.prepare(sql).bind(...params);
    const result = await stmt.first() as {
      total_count: number;
      total_prompt_tokens: number;
      total_completion_tokens: number;
      total_quota: number;
    } | null;

    return c.json({
      success: true,
      message: '',
      data: {
        total_count: result?.total_count || 0,
        total_prompt_tokens: result?.total_prompt_tokens || 0,
        total_completion_tokens: result?.total_completion_tokens || 0,
        total_quota: result?.total_quota || 0,
      },
    });
  } catch (err) {
    console.error('Error fetching log stats:', err);
    return c.json({
      success: true,
      message: '',
      data: { total_count: 0, total_prompt_tokens: 0, total_completion_tokens: 0, total_quota: 0 },
    });
  }
});

// DELETE /api/log/ - 删除历史日志 (管理员)
misc.delete('/log', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 100) {
    return c.json({ success: false, message: 'Root permission required' }, 403);
  }

  const targetTimestamp = parseInt(c.req.query('target_timestamp') || '0', 10);
  if (!targetTimestamp) {
    return c.json({ success: false, message: 'target_timestamp is required' }, 400);
  }

  try {
    const stmt = c.env.DB.prepare(`
      DELETE FROM logs WHERE created_at < datetime(?, 'unixepoch')
    `).bind(targetTimestamp);
    const result = await stmt.run();

    return c.json({
      success: true,
      message: `Deleted ${result.meta?.changes || 0} logs`,
    });
  } catch (err) {
    console.error('Error deleting logs:', err);
    return c.json({ success: false, message: 'Failed to delete logs' }, 500);
  }
});

// GET /api/log/self/ - 获取个人日志 (用户)
misc.get('/log/self', jwtAuth(), async (c) => {
  const userId = c.get('userId');
  const page = parseInt(c.req.query('p') || '0', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);
  const offset = page * pageSize;

  // 过滤参数
  const tokenName = c.req.query('token_name') || '';
  const modelName = c.req.query('model_name') || '';
  const startTimestamp = parseInt(c.req.query('start_timestamp') || '0', 10);
  const endTimestamp = parseInt(c.req.query('end_timestamp') || String(Math.floor(Date.now() / 1000)), 10);

  try {
    let sql = `
      SELECT l.id, l.channel_id, l.model as model, l.prompt_tokens, l.completion_tokens,
             l.quota, l.request_id, l.status_code as code, l.created_at, t.name as token_name
      FROM logs l
      LEFT JOIN tokens t ON l.token_id = t.id
      WHERE l.user_id = ?
        AND l.created_at >= datetime(?, 'unixepoch')
        AND l.created_at <= datetime(?, 'unixepoch')
    `;
    const params: (string | number)[] = [userId, startTimestamp, endTimestamp];

    if (tokenName) {
      sql += ` AND t.name LIKE ?`;
      params.push(`%${tokenName}%`);
    }
    if (modelName) {
      sql += ` AND l.model LIKE ?`;
      params.push(`%${modelName}%`);
    }

    sql += ` ORDER BY l.created_at DESC LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const stmt = c.env.DB.prepare(sql).bind(...params);
    const result = await stmt.all();

    return c.json({
      success: true,
      message: '',
      data: result.results || [],
    });
  } catch (err) {
    console.error('Error fetching logs:', err);
    return c.json({
      success: true,
      message: '',
      data: [],
    });
  }
});

// GET /api/log/self/stat - 获取个人日志统计 (用户)
misc.get('/log/self/stat', jwtAuth(), async (c) => {
  const userId = c.get('userId');

  // 过滤参数
  const tokenName = c.req.query('token_name') || '';
  const modelName = c.req.query('model_name') || '';
  const startTimestamp = parseInt(c.req.query('start_timestamp') || '0', 10);
  const endTimestamp = parseInt(c.req.query('end_timestamp') || String(Math.floor(Date.now() / 1000)), 10);

  try {
    let sql = `
      SELECT
        COUNT(*) as total_count,
        SUM(l.prompt_tokens) as total_prompt_tokens,
        SUM(l.completion_tokens) as total_completion_tokens,
        SUM(l.quota) as total_quota
      FROM logs l
      LEFT JOIN tokens t ON l.token_id = t.id
      WHERE l.user_id = ?
        AND l.created_at >= datetime(?, 'unixepoch')
        AND l.created_at <= datetime(?, 'unixepoch')
    `;
    const params: (string | number)[] = [userId, startTimestamp, endTimestamp];

    if (tokenName) {
      sql += ` AND t.name LIKE ?`;
      params.push(`%${tokenName}%`);
    }
    if (modelName) {
      sql += ` AND l.model LIKE ?`;
      params.push(`%${modelName}%`);
    }

    const stmt = c.env.DB.prepare(sql).bind(...params);
    const result = await stmt.first() as {
      total_count: number;
      total_prompt_tokens: number;
      total_completion_tokens: number;
      total_quota: number;
    } | null;

    return c.json({
      success: true,
      message: '',
      data: {
        total_count: result?.total_count || 0,
        total_prompt_tokens: result?.total_prompt_tokens || 0,
        total_completion_tokens: result?.total_completion_tokens || 0,
        total_quota: result?.total_quota || 0,
      },
    });
  } catch (err) {
    console.error('Error fetching log stats:', err);
    return c.json({
      success: true,
      message: '',
      data: { total_count: 0, total_prompt_tokens: 0, total_completion_tokens: 0, total_quota: 0 },
    });
  }
});

// GET /api/setting - 获取系统设置 (管理员)
misc.get('/setting', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const optionService = new OptionService(c.env.DB);

  // 获取所有系统设置
  const settings: Record<string, unknown> = {
    // 基础设置
    system_name: await optionService.get('system_name', 'New API'),
    logo: await optionService.get('logo', ''),
    footer_html: await optionService.get('footer_html', ''),
    home_page_content: await optionService.get('home_page_content', ''),
    notice: await optionService.get('notice', ''),

    // 注册设置
    register_enabled: await optionService.getBool('register_enabled', true),
    email_verification: false,  // Workers版本不支持邮件验证

    // 配额设置
    quota_per_unit: await optionService.getInt('quota_per_unit', 500000),
    default_quota: await optionService.getInt('default_quota', 0),
    display_in_currency: false,
    quota_display_type: 'quota',

    // 功能开关 (大部分Workers版本暂不支持)
    enable_drawing: false,
    enable_task: false,
    enable_data_export: true,
    enable_batch_update: false,
    demo_site_enabled: false,
    self_use_mode_enabled: false,

    // 聊天设置
    chats: await optionService.get('chats', '[]'),

    // Dashboard设置
    api_info_enabled: true,
    uptime_kuma_enabled: false,
    uptime_kuma_url: '',
    announcements_enabled: false,
    faq_enabled: false,

    // 绘图设置 (Workers版本暂不支持)
    mj_notify_enabled: false,
    mj_account_filter_enabled: false,
    mj_mode_enabled: false,

    // OAuth设置 (Workers版本暂不支持)
    github_oauth: false,
    discord_oauth: false,
    linuxdo_oauth: false,
    telegram_oauth: false,
    wechat_login: false,
    oidc_enabled: false,

    // 其他设置
    top_up_link: '',
    docs_link: '',
    server_address: '',
    price: 1,
    usd_exchange_rate: 7.3,
  };

  return c.json({
    success: true,
    message: '',
    data: settings,
  });
});

// PUT /api/setting - 更新系统设置 (管理员)
misc.put('/setting', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 100) {
    return c.json({ success: false, message: 'Root permission required' }, 403);
  }

  const body = await c.req.json<Record<string, unknown>>();
  const optionService = new OptionService(c.env.DB);

  // 允许更新的设置键
  const allowedKeys = [
    'system_name', 'logo', 'footer_html', 'home_page_content', 'notice',
    'register_enabled', 'quota_per_unit', 'default_quota',
    'enable_drawing', 'enable_task', 'enable_data_export',
    'chats', 'api_info_enabled', 'uptime_kuma_enabled', 'uptime_kuma_url',
    'announcements_enabled', 'faq_enabled', 'top_up_link', 'docs_link',
    'server_address', 'price', 'usd_exchange_rate',
  ];

  for (const [key, value] of Object.entries(body)) {
    if (allowedKeys.includes(key)) {
      await optionService.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }

  return c.json({
    success: true,
    message: 'Settings updated',
  });
});

// GET /api/models - Dashboard获取模型列表 (用户认证)
misc.get('/models', jwtAuth(), async (c) => {
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

  // 返回模型列表，格式与原始API兼容
  const data = Array.from(modelsSet).map((id, index) => ({
    id: index + 1,
    name: id,
    owned_by: 'new-api',
  }));

  return c.json({
    success: true,
    message: '',
    data,
  });
});

// GET /api/redemption/ - 获取兑换码列表 (管理员)
misc.get('/redemption', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  const page = parseInt(c.req.query('p') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);

  // Workers版本简化实现，返回空列表
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

// POST /api/redemption/ - 创建兑换码 (管理员)
misc.post('/redemption', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  // Workers版本简化实现
  return c.json({
    success: false,
    message: 'Redemption codes are not supported in Workers version',
  }, 501);
});

// DELETE /api/redemption/:id - 删除兑换码 (管理员)
misc.delete('/redemption/:id', jwtAuth(), async (c) => {
  const userRole = c.get('userRole');
  if (userRole < 10) {
    return c.json({ success: false, message: 'Permission denied' }, 403);
  }

  return c.json({
    success: false,
    message: 'Redemption codes are not supported in Workers version',
  }, 501);
});

// GET /api/mj/ - 获取Midjourney任务列表
misc.get('/mj', jwtAuth(), async (c) => {
  const page = parseInt(c.req.query('p') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);

  // Workers版本简化实现，返回空列表
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

// GET /api/task/ - 获取异步任务列表
misc.get('/task', jwtAuth(), async (c) => {
  const page = parseInt(c.req.query('p') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);

  // Workers版本简化实现，返回空列表
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

// GET /api/pricing - 获取定价信息
misc.get('/pricing', async (c) => {
  const { ChannelService } = await import('../db');
  const channelService = new ChannelService(c.env.DB);
  const channels = await channelService.findEnabled();

  const modelsMap = new Map<string, { input: number; output: number }>();

  for (const ch of channels) {
    if (ch.models) {
      const models = ch.models.split(',').map((m: string) => m.trim());
      for (const model of models) {
        if (model && model !== '*' && !modelsMap.has(model)) {
          // 默认价格，可以从数据库或配置中获取
          modelsMap.set(model, { input: 1, output: 1 });
        }
      }
    }
  }

  // 转换为定价数组格式
  const data = Array.from(modelsMap.entries()).map(([name, price]) => ({
    model: name,
    model_ratio: 1,
    input: price.input,
    output: price.output,
    type: 'chat',
  }));

  return c.json({
    success: true,
    message: '',
    data,
  });
});

// GET /api/about - 获取关于页面信息
misc.get('/about', async (c) => {
  const optionService = new OptionService(c.env.DB);
  const aboutContent = await optionService.get('about', '');

  return c.json({
    success: true,
    message: '',
    data: aboutContent || 'New API Workers Edition - A lightweight LLM API gateway running on Cloudflare Workers.',
  });
});

// GET /api/prefill_group - 获取预填充分组信息
misc.get('/prefill_group', async (c) => {
  // type参数: model, endpoint, tag 等
  // Workers版本简化实现，返回空数组
  // 原版本这里会返回模型、端点、标签等预填充数据
  return c.json({
    success: true,
    message: '',
    data: [],
  });
});

export default misc;
