/**
 * 外部邮箱 Provider
 * 兼容 Cloudflare Temp Email / Cloud Mail 的收件 API。
 */

const DEFAULT_LIMIT = 20;

function firstNonEmpty(values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function normalizeBaseUrl(value = '') {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    url.hash = '';
    url.search = '';
    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return '';
  }
}

function joinUrl(baseUrl, pathname) {
  const base = normalizeBaseUrl(baseUrl);
  const path = String(pathname || '').trim();
  if (!base || !path) return base;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function parseProviderConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  const raw = String(value || '').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {}

  const config = {};
  for (const part of raw.split(/[;,]/)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) config[key] = val;
  }
  return config;
}

function normalizeProvider(value = '') {
  const provider = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (['cloudflare-temp-mail', 'cloudflare-temp-email', 'cloudflare'].includes(provider)) {
    return 'cloudflare-temp-mail';
  }
  if (['cloud-mail', 'cloudmail'].includes(provider)) {
    return 'cloud-mail';
  }
  return 'outlook';
}

function getAccountMailProvider(account = {}) {
  return normalizeProvider(account.mailProvider || account.provider || account.mail_provider);
}

function getAccountProviderConfig(account = {}) {
  return parseProviderConfig(account.mailConfig || account.providerConfig || account.mail_config);
}

function buildCloudflareHeaders(config = {}) {
  const headers = { Accept: 'application/json' };
  const adminAuth = firstNonEmpty([
    config.adminAuth,
    config.admin_auth,
    config.xAdminAuth,
    config.adminToken,
    config.cloudflareTempEmailAdminAuth,
  ]);
  const customAuth = firstNonEmpty([
    config.customAuth,
    config.custom_auth,
    config.xCustomAuth,
    config.customToken,
    config.cloudflareTempEmailCustomAuth,
  ]);
  if (adminAuth) headers['x-admin-auth'] = adminAuth;
  if (customAuth) headers['x-custom-auth'] = customAuth;
  return headers;
}

function buildCloudMailHeaders(config = {}, token = '') {
  const headers = { Accept: 'application/json' };
  const resolvedToken = firstNonEmpty([token, config.token, config.cloudMailToken]);
  if (resolvedToken) headers.Authorization = resolvedToken;
  return headers;
}

async function requestJson(url, options = {}) {
  const { timeoutMs: rawTimeoutMs, acceptBusinessCodes, ...fetchOptions } = options;
  const timeoutMs = Number(rawTimeoutMs) || 20000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message = data?.message || data?.error || data?.msg || text || `HTTP ${res.status}`;
      throw new Error(message);
    }
    if (
      data &&
      typeof data === 'object' &&
      Array.isArray(acceptBusinessCodes) &&
      'code' in data &&
      !acceptBusinessCodes.includes(Number(data.code))
    ) {
      throw new Error(data.message || data.msg || `code=${data.code}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeDomain(value = '') {
  let domain = String(value || '').trim().toLowerCase();
  if (!domain) return '';
  domain = domain.replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : '';
}

function getDomainRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.domains,
    payload.DOMAINS,
    payload.data?.domains,
    payload.data?.DOMAINS,
    payload.payload?.domains,
    payload.payload?.DOMAINS,
    payload.result?.domains,
    payload.result?.DOMAINS,
  ];
  const row = candidates.find(Array.isArray);
  if (row) return row;
  const text = firstNonEmpty([
    payload.domains,
    payload.DOMAINS,
    payload.data?.domains,
    payload.data?.DOMAINS,
    payload.payload?.domains,
    payload.payload?.DOMAINS,
  ]);
  return text ? text.split(/[\s,;，、]+/) : [];
}

function normalizeDomains(values) {
  const domains = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const domain = normalizeDomain(value);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

function resolveTargetEmail(account = {}, config = {}) {
  const lookupMode = String(config.lookupMode || config.lookup_mode || '').trim().toLowerCase();
  const receiveMailbox = firstNonEmpty([
    config.receiveMailbox,
    config.receive_mailbox,
    config.targetEmail,
    config.target_email,
  ]).toLowerCase();
  if (lookupMode === 'receive-mailbox' && receiveMailbox) return receiveMailbox;
  return String(account.email || '').trim().toLowerCase();
}

function getRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.data,
    payload.items,
    payload.messages,
    payload.mails,
    payload.results,
    payload.rows,
    payload.list,
    payload.records,
    payload?.data?.list,
    payload?.data?.records,
    payload?.data?.rows,
  ];
  return candidates.find(Array.isArray) || [];
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(value) {
  if (!value && value !== 0) return new Date().toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 0 && value < 100000000000 ? value * 1000 : value;
    return new Date(timestamp).toISOString();
  }
  let source = String(value || '').trim();
  if (/^\d+$/.test(source)) {
    const numeric = Number(source);
    if (Number.isFinite(numeric)) {
      const timestamp = numeric > 0 && numeric < 100000000000 ? numeric * 1000 : numeric;
      return new Date(timestamp).toISOString();
    }
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)) {
    source = `${source.replace(' ', 'T')}Z`;
  } else {
    source = source.replace(' ', 'T');
  }
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value || '');
}

function normalizeMessage(row = {}, protocol = 'external') {
  const html = firstNonEmpty([row.html, row.html_content, row.htmlContent, row.body_html, row.bodyHtml, row.content]);
  const text = firstNonEmpty([
    row.text,
    row.text_content,
    row.textContent,
    row.plain,
    row.plain_text,
    row.plainText,
    row.body_text,
    row.bodyText,
    row.preview,
    row.bodyPreview,
    row.snippet,
    row.summary,
    row.body,
  ]);
  const recipient = firstNonEmpty([
    row.address,
    row.mail_address,
    row.email,
    row.recipient,
    row.toEmail,
    row.to_email,
  ]).toLowerCase();
  const from = firstNonEmpty([row.from, row.sender, row.mail_from, row.sendEmail, row.send_email, row.mailFrom]);
  const bodyText = text || stripHtml(html) || stripHtml(row.raw || row.source || row.mime || row.message || '');

  return {
    id: firstNonEmpty([row.id, row.mail_id, row.emailId, row.mailId]),
    subject: firstNonEmpty([row.subject, row.title]),
    from,
    fromName: from,
    date: normalizeDate(firstNonEmpty([
      row.receivedDateTime,
      row.received_at,
      row.createTime,
      row.create_time,
      row.createdAt,
      row.created_at,
      row.date,
    ])),
    bodyPreview: bodyText,
    bodyText,
    bodyHtml: html,
    protocol,
    recipient,
  };
}

function messageHasBody(row = {}) {
  return Boolean(firstNonEmpty([
    row.html,
    row.html_content,
    row.htmlContent,
    row.body_html,
    row.bodyHtml,
    row.content,
    row.text,
    row.text_content,
    row.textContent,
    row.plain,
    row.plain_text,
    row.plainText,
    row.body_text,
    row.bodyText,
    row.body,
    row.raw,
    row.source,
    row.mime,
    row.message,
  ]));
}

function unwrapRow(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  return payload.data || payload.mail || payload.message || payload.item || payload;
}

function filterMessages(messages, account, options = {}, targetEmail = '') {
  const target = String(targetEmail || account.email || '').trim().toLowerCase();
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const sender = String(options.sender || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(options.limit) || DEFAULT_LIMIT));

  return messages
    .filter(message => !target || !message.recipient || message.recipient === target)
    .filter(message => {
      if (!keyword) return true;
      const text = [message.subject, message.from, message.bodyPreview, message.bodyText].join(' ').toLowerCase();
      return text.includes(keyword);
    })
    .filter(message => !sender || String(message.from || '').toLowerCase().includes(sender))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

async function fetchCloudflareTempMail(account, options = {}) {
  const config = getAccountProviderConfig(account);
  const baseUrl = normalizeBaseUrl(config.baseUrl || config.url || config.cloudflareTempEmailBaseUrl);
  if (!baseUrl) throw new Error('Cloudflare Temp Mail 缺少 baseUrl');
  const targetEmail = resolveTargetEmail(account, config);

  const url = new URL(joinUrl(baseUrl, '/admin/mails'));
  url.searchParams.set('limit', String(Math.max(1, Math.min(50, Number(options.limit) || DEFAULT_LIMIT))));
  if (targetEmail) url.searchParams.set('address', targetEmail);

  const headers = buildCloudflareHeaders(config);
  const payload = await requestJson(url.toString(), {
    method: 'GET',
    headers,
  });
  const rows = getRows(payload);
  const enrichedRows = await Promise.all(rows.map(async row => {
    if (messageHasBody(row)) return row;
    const id = firstNonEmpty([row.id, row.mail_id, row.emailId, row.mailId]);
    if (!id) return row;
    try {
      const detail = await requestJson(joinUrl(baseUrl, `/admin/mails/${encodeURIComponent(id)}`), {
        method: 'GET',
        headers,
      });
      return { ...row, ...unwrapRow(detail) };
    } catch {
      return row;
    }
  }));
  const emails = filterMessages(
    enrichedRows.map(row => normalizeMessage(row, 'cloudflare-temp-mail')),
    account,
    options,
    targetEmail
  );
  return { success: true, emails, count: emails.length, protocol: 'cloudflare-temp-mail' };
}

async function fetchCloudflareTempMailDomains(input = {}) {
  const config = typeof input === 'string' ? parseProviderConfig(input) : input;
  const baseUrl = normalizeBaseUrl(config.baseUrl || config.url || config.cloudflareTempEmailBaseUrl);
  if (!baseUrl) throw new Error('Cloudflare Temp Mail 缺少 baseUrl');

  let openSettingsError = null;
  try {
    const payload = await requestJson(joinUrl(baseUrl, '/open_api/settings'), {
      method: 'GET',
      headers: buildCloudflareHeaders({ customAuth: config.customAuth || config.custom_auth }),
    });
    const domains = normalizeDomains(getDomainRows(payload));
    if (domains.length > 0) {
      return { domains, source: 'open_api/settings' };
    }
    openSettingsError = new Error('公开设置未返回可用域名');
  } catch (err) {
    openSettingsError = err;
  }

  const adminAuth = firstNonEmpty([config.adminAuth, config.admin_auth, config.xAdminAuth, config.adminToken]);
  if (!adminAuth) {
    throw openSettingsError || new Error('未获取到可用域名');
  }

  const payload = await requestJson(joinUrl(baseUrl, '/admin/worker/configs'), {
    method: 'GET',
    headers: buildCloudflareHeaders(config),
  });
  const domains = normalizeDomains(getDomainRows(payload));
  if (domains.length === 0) {
    throw openSettingsError || new Error('管理配置未返回可用域名');
  }
  return { domains, source: 'admin/worker/configs' };
}

async function fetchCloudMailToken(config) {
  const existing = firstNonEmpty([config.token, config.cloudMailToken]);
  if (existing) return existing;
  const email = firstNonEmpty([config.adminEmail, config.email, config.username]);
  const password = firstNonEmpty([config.adminPassword, config.password]);
  if (!email || !password) return '';

  const baseUrl = normalizeBaseUrl(config.baseUrl || config.url || config.cloudMailBaseUrl);
  const payload = await requestJson(joinUrl(baseUrl, '/api/public/genToken'), {
    method: 'POST',
    headers: { ...buildCloudMailHeaders(config, ''), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    acceptBusinessCodes: [200],
  });
  return firstNonEmpty([payload?.data?.token, payload?.token, payload?.data?.accessToken, payload?.accessToken]);
}

async function fetchCloudMail(account, options = {}) {
  const config = getAccountProviderConfig(account);
  const baseUrl = normalizeBaseUrl(config.baseUrl || config.url || config.cloudMailBaseUrl);
  if (!baseUrl) throw new Error('Cloud Mail 缺少 baseUrl');
  const token = await fetchCloudMailToken({ ...config, baseUrl });
  if (!token) throw new Error('Cloud Mail 缺少 token 或管理员账号密码');
  const targetEmail = resolveTargetEmail(account, config);

  const payload = await requestJson(joinUrl(baseUrl, '/api/public/emailList'), {
    method: 'POST',
    headers: { ...buildCloudMailHeaders(config, token), 'Content-Type': 'application/json' },
    acceptBusinessCodes: [200],
    body: JSON.stringify({
      toEmail: targetEmail,
      type: 0,
      isDel: 0,
      timeSort: 'desc',
      num: 1,
      size: Math.max(1, Math.min(50, Number(options.limit) || DEFAULT_LIMIT)),
    }),
  });
  const emails = filterMessages(getRows(payload).map(row => normalizeMessage(row, 'cloud-mail')), account, options, targetEmail);
  return { success: true, emails, count: emails.length, protocol: 'cloud-mail' };
}

async function fetchEmails(account, options = {}) {
  const provider = getAccountMailProvider(account);
  if (provider === 'cloudflare-temp-mail') return fetchCloudflareTempMail(account, options);
  if (provider === 'cloud-mail') return fetchCloudMail(account, options);
  throw new Error(`不支持的外部邮箱 Provider: ${provider}`);
}

module.exports = {
  fetchEmails,
  fetchCloudflareTempMailDomains,
  getAccountMailProvider,
  getAccountProviderConfig,
  normalizeProvider,
};
