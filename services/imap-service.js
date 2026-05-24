/**
 * IMAP OAuth2 邮件获取服务（高性能版本）
 * 使用 imapflow 连接 Outlook IMAP，通过 OAuth2 认证获取邮件
 * 
 * 性能优化：
 * 1. 使用 IMAP SEARCH 在服务器端过滤，不下载全部邮件
 * 2. 先取信封，再按需取正文预览
 * 3. UID 倒序取最新邮件
 * 4. 连接超时控制
 */

const { ImapFlow } = require('imapflow');
const config = require('../config');

/**
 * 刷新 OAuth2 access token
 */
async function refreshAccessToken(clientId, refreshToken) {
  const scopes = [
    'https://outlook.office365.com/.default',
    'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
  ];

  let lastError = null;
  for (const scope of scopes) {
    try {
      return await _requestToken(clientId, refreshToken, scope);
    } catch (err) {
      lastError = err;
      continue;
    }
  }
  throw lastError;
}

async function _requestToken(clientId, refreshToken, scope) {
  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: scope,
  });

  const response = await fetch(config.graph.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    const msg = data.error_description || data.error || 'Token 刷新失败';
    throw new Error(`IMAP Token 错误: ${msg}`);
  }

  return data.access_token;
}

/**
 * 通过 IMAP 获取邮件（高性能版本）
 */
async function fetchEmails(account, options = {}) {
  const { email, clientId, refreshToken } = account;
  const { keyword = '', sender = '', limit = 10 } = options;

  const accessToken = await refreshAccessToken(clientId, refreshToken);

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: email, accessToken },
    logger: false,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

  try {
    await client.connect();
    const mailbox = await client.getMailboxLock('INBOX');

    try {
      // 使用 IMAP SEARCH 在服务器端过滤（关键性能优化）
      const searchCriteria = {};
      if (keyword && sender) {
        searchCriteria.and = [
          { or: [{ subject: keyword }, { body: keyword }] },
          { from: sender },
        ];
      } else if (keyword) {
        searchCriteria.or = [{ subject: keyword }, { body: keyword }];
      } else if (sender) {
        searchCriteria.from = sender;
      } else {
        searchCriteria.all = true;
      }

      // 服务器端搜索，只返回 UID 列表（非常快）
      let uids;
      try {
        uids = await client.search(searchCriteria, { uid: true });
      } catch {
        uids = await client.search({ all: true }, { uid: true });
      }

      if (!uids || uids.length === 0) {
        return { success: true, emails: [], count: 0, protocol: 'imap' };
      }

      // 只取最新的 N 封（UID 倒序 = 最新优先）
      uids.sort((a, b) => b - a);
      const targetUids = uids.slice(0, limit);
      const uidRange = targetUids.join(',');

      // 先只获取信封信息（非常快，不下载正文）
      const messages = [];
      for await (const msg of client.fetch(uidRange, {
        uid: true,
        envelope: true,
        bodyStructure: true,
      })) {
        messages.push({
          uid: msg.uid,
          messageId: msg.envelope?.messageId || `imap-${msg.uid}`,
          subject: msg.envelope?.subject || '',
          from: msg.envelope?.from?.[0]?.address || '',
          fromName: msg.envelope?.from?.[0]?.name || '',
          date: msg.envelope?.date?.toISOString() || new Date().toISOString(),
          bodyText: '',
          bodyPreview: '',
          bodyHtml: '',
          protocol: 'imap',
        });
      }

      // 批量获取正文预览（只取 text/plain 的前 1KB）
      if (messages.length > 0) {
        const bodyUids = messages.map(m => m.uid).join(',');
        try {
          for await (const msg of client.fetch(bodyUids, {
            uid: true,
            bodyParts: [{ key: '1', size: 1024 }],
          })) {
            const target = messages.find(m => m.uid === msg.uid);
            if (target && msg.bodyParts) {
              const part = msg.bodyParts.get('1');
              if (part) {
                let text = part.toString('utf-8');
                text = text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                target.bodyText = text.substring(0, 2000);
                target.bodyPreview = text.substring(0, 200);
              }
            }
          }
        } catch {
          // body fetch 失败不影响整体，信封信息已经够了
        }
      }

      // 清理内部字段 + 按时间倒序
      messages.forEach(m => delete m.uid);
      messages.sort((a, b) => new Date(b.date) - new Date(a.date));

      return { success: true, emails: messages, count: messages.length, protocol: 'imap' };
    } finally {
      mailbox.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = { fetchEmails, refreshAccessToken };
