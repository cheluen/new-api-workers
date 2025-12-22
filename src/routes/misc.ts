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
    HeaderNavModules: '[]',
    SidebarModulesAdmin: '[]',

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
misc.get('/data/', jwtAuth(), async (c) => {
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
          l.model_name,
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
        GROUP BY l.model_name, date(l.created_at), l.user_id
        ORDER BY l.created_at ASC
      `).bind(startTimestamp, endTimestamp, `%${username}%`);
    } else {
      stmt = c.env.DB.prepare(`
        SELECT
          l.model_name,
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
        GROUP BY l.model_name, date(l.created_at), l.user_id
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
misc.get('/data/self/', jwtAuth(), async (c) => {
  const userId = c.get('userId');

  // 获取查询参数
  const startTimestamp = parseInt(c.req.query('start_timestamp') || '0', 10);
  const endTimestamp = parseInt(c.req.query('end_timestamp') || String(Math.floor(Date.now() / 1000)), 10);

  try {
    // 从 logs 表查询数据，按模型和时间分组，返回与原始 QuotaData 兼容的格式
    const stmt = c.env.DB.prepare(`
      SELECT
        model_name,
        strftime('%s', date(created_at)) as created_at,
        SUM(prompt_tokens + completion_tokens) as token_used,
        COUNT(*) as count,
        SUM(quota) as quota
      FROM logs
      WHERE user_id = ?
        AND created_at >= datetime(?, 'unixepoch')
        AND created_at <= datetime(?, 'unixepoch')
      GROUP BY model_name, date(created_at)
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

export default misc;
