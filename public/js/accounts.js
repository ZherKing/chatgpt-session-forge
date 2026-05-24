/**
 * 邮箱账号管理模块
 * 处理导入/导出/删除/搜索等操作
 */

// ==================== 数据操作 ====================
let _cachedAccounts = [];

async function loadAccounts() {
  try {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    _cachedAccounts = data.accounts || [];
    return _cachedAccounts;
  } catch (err) {
    console.error('加载账号失败:', err);
    return [];
  }
}

async function loadFullAccounts() {
  try {
    const res = await fetch('/api/accounts/full');
    const data = await res.json();
    return data.accounts || [];
  } catch (err) {
    console.error('加载完整账号失败:', err);
    return [];
  }
}

function getAccountSearchKeyword() {
  return (document.getElementById('accountSearch')?.value || '').trim().toLowerCase();
}

function normalizeAccountProvider(value = '') {
  const provider = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (['cloudflare-temp-mail', 'cloudflare-temp-email', 'cloudflare'].includes(provider)) return 'cloudflare-temp-mail';
  if (['cloud-mail', 'cloudmail'].includes(provider)) return 'cloud-mail';
  return 'outlook';
}

function getAccountProvider(account = {}) {
  return normalizeAccountProvider(account.mailProvider || account.provider || account.mail_provider);
}

function accountProviderLabel(provider) {
  const labels = {
    outlook: 'Outlook',
    'cloudflare-temp-mail': 'CF Temp',
    'cloud-mail': 'Cloud Mail',
  };
  return labels[provider] || provider;
}

const IMPORT_PROVIDER_SETTINGS_KEY = 'mailImportProviderSettings';

function getImportProvider() {
  return normalizeAccountProvider(document.getElementById('importMailProvider')?.value || 'outlook');
}

function getRadioValue(name, fallback = '') {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function setRadioValue(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''));
}

function readImportProviderSettings() {
  try {
    return JSON.parse(localStorage.getItem(IMPORT_PROVIDER_SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function collectImportProviderSettings() {
  return {
    provider: getImportProvider(),
    cloudflare: {
      baseUrl: document.getElementById('cfTempBaseUrl')?.value.trim() || '',
      adminAuth: document.getElementById('cfAdminAuth')?.value.trim() || '',
      customAuth: document.getElementById('cfCustomAuth')?.value.trim() || '',
      lookupMode: getRadioValue('cfLookupMode', 'receive-mailbox'),
      receiveMailbox: document.getElementById('cfReceiveMailbox')?.value.trim() || '',
      randomSubdomain: Boolean(document.getElementById('cfRandomSubdomain')?.checked),
      domain: document.getElementById('cfTempDomain')?.value.trim() || '',
    },
    cloudMail: {
      baseUrl: document.getElementById('cloudMailBaseUrl')?.value.trim() || '',
      adminEmail: document.getElementById('cloudMailAdminEmail')?.value.trim() || '',
      adminPassword: document.getElementById('cloudMailAdminPassword')?.value.trim() || '',
      domain: document.getElementById('cloudMailDomain')?.value.trim() || '',
    },
  };
}

function saveImportProviderSettings() {
  try {
    localStorage.setItem(IMPORT_PROVIDER_SETTINGS_KEY, JSON.stringify(collectImportProviderSettings()));
  } catch {}
}

function applyImportProviderSettings() {
  const settings = readImportProviderSettings();
  if (settings.provider && document.getElementById('importMailProvider')) {
    document.getElementById('importMailProvider').value = normalizeAccountProvider(settings.provider);
  }

  const cf = settings.cloudflare || {};
  if (cf.baseUrl) document.getElementById('cfTempBaseUrl').value = cf.baseUrl;
  if (cf.adminAuth) document.getElementById('cfAdminAuth').value = cf.adminAuth;
  if (cf.customAuth) document.getElementById('cfCustomAuth').value = cf.customAuth;
  if (cf.lookupMode) setRadioValue('cfLookupMode', cf.lookupMode);
  if (cf.receiveMailbox) document.getElementById('cfReceiveMailbox').value = cf.receiveMailbox;
  document.getElementById('cfRandomSubdomain').checked = Boolean(cf.randomSubdomain);
  if (cf.domain) document.getElementById('cfTempDomain').value = cf.domain;

  const cloudMail = settings.cloudMail || {};
  if (cloudMail.baseUrl) document.getElementById('cloudMailBaseUrl').value = cloudMail.baseUrl;
  if (cloudMail.adminEmail) document.getElementById('cloudMailAdminEmail').value = cloudMail.adminEmail;
  if (cloudMail.adminPassword) document.getElementById('cloudMailAdminPassword').value = cloudMail.adminPassword;
  if (cloudMail.domain) document.getElementById('cloudMailDomain').value = cloudMail.domain;
}

function buildImportProviderConfig(provider = getImportProvider()) {
  if (provider === 'outlook') return { ok: true, config: '', errors: [] };

  const settings = collectImportProviderSettings();
  const errors = [];
  let config = {};

  if (provider === 'cloudflare-temp-mail') {
    const cf = settings.cloudflare;
    if (!cf.baseUrl) errors.push('Cloudflare Temp Email 缺少 TEMP API');
    if (cf.lookupMode === 'receive-mailbox' && !cf.receiveMailbox) {
      errors.push('Cloudflare Temp Email 选择「邮件接收」时需要填写接收邮箱');
    }
    config = compactObject({
      baseUrl: cf.baseUrl,
      adminAuth: cf.adminAuth,
      customAuth: cf.customAuth,
      lookupMode: cf.lookupMode,
      receiveMailbox: cf.receiveMailbox,
      randomSubdomain: cf.randomSubdomain ? 'true' : '',
      domain: cf.domain,
    });
  }

  if (provider === 'cloud-mail') {
    const cloudMail = settings.cloudMail;
    if (!cloudMail.baseUrl) errors.push('Cloud Mail 缺少 API 地址');
    if (!cloudMail.adminEmail) errors.push('Cloud Mail 缺少管理员邮箱');
    if (!cloudMail.adminPassword) errors.push('Cloud Mail 缺少管理员密码');
    config = compactObject({
      baseUrl: cloudMail.baseUrl,
      adminEmail: cloudMail.adminEmail,
      adminPassword: cloudMail.adminPassword,
      domain: cloudMail.domain,
    });
  }

  return {
    ok: errors.length === 0,
    config: JSON.stringify(config),
    errors,
  };
}

function refreshImportProviderUi() {
  const provider = getImportProvider();
  const cfPanel = document.getElementById('cloudflareProviderPanel');
  const cloudMailPanel = document.getElementById('cloudMailProviderPanel');
  const note = document.getElementById('importProviderNote');
  const formatTip = document.getElementById('importFormatTip');
  const providerHelp = document.getElementById('importProviderHelp');
  const textarea = document.getElementById('importTextarea');

  if (cfPanel) cfPanel.hidden = provider !== 'cloudflare-temp-mail';
  if (cloudMailPanel) cloudMailPanel.hidden = provider !== 'cloud-mail';

  if (note) {
    const notes = {
      outlook: '导入时保持 Outlook 四段格式',
      'cloudflare-temp-mail': '会自动追加 Cloudflare Temp Email 配置',
      'cloud-mail': '会自动追加 Cloud Mail 配置',
    };
    note.textContent = notes[provider] || notes.outlook;
  }

  if (formatTip) {
    formatTip.innerHTML = provider === 'outlook'
      ? 'Outlook 每行一个：<code>登录邮箱----登录密码或占位----clientid----刷新令牌</code>'
      : '外部邮箱每行一个：<code>登录邮箱----登录密码或占位</code>，也兼容四段格式';
  }

  if (providerHelp) {
    providerHelp.textContent = provider === 'outlook'
      ? 'Outlook 取验证码会使用该行的 clientid 和刷新令牌；如果 OpenAI 要求密码登录，会使用第二段密码。'
      : 'Cloudflare Temp Email / Cloud Mail 的 API 配置填在上面；第二段不是自建邮箱密码，如果 OpenAI 只要验证码，可以填 x。';
  }

  if (textarea) {
    textarea.placeholder = provider === 'outlook'
      ? 'login-email@outlook.com----openai-password-or-x----client-id-here----refresh-token-here\nlogin-email2@outlook.com--openai-password-or-x--clientid--token'
      : 'login-email@example.com----x\nanother-login-email@example.com----openai-password-if-needed';
  }
}

// ==================== 渲染邮箱列表 ====================
async function renderAccountList(highlightIds = null) {
  const accounts = await loadAccounts();
  const searchKeyword = getAccountSearchKeyword();
  const visible = searchKeyword
    ? accounts.filter(a => (a.email || '').toLowerCase().includes(searchKeyword))
    : accounts;

  const listEl = document.getElementById('accountList');
  const countEl = document.getElementById('accountCount');

  const oldCount = parseInt(countEl.textContent) || 0;
  countEl.textContent = searchKeyword ? `${visible.length}/${accounts.length}` : accounts.length;
  if (accounts.length !== oldCount) {
    countEl.classList.add('badge-pulse');
    setTimeout(() => countEl.classList.remove('badge-pulse'), 600);
  }

  if (accounts.length === 0) {
    listEl.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7L12 13L2 7"/></svg>
      <p>暂无邮箱</p><p class="text-muted">点击上方按钮导入</p>
    </div>`;
    return;
  }

  if (visible.length === 0) {
    listEl.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <p>未找到邮箱</p><p class="text-muted">换个关键词试试</p>
    </div>`;
    return;
  }

  let html = `<div class="select-all-wrapper">
    <input type="checkbox" class="account-checkbox" id="selectAll" />
    <label for="selectAll" style="cursor:pointer;">全选</label>
    <button class="btn btn-ghost btn-small btn-danger-ghost" id="btnDeleteSelected" style="display:none;margin-left:auto;">删除选中</button>
  </div>`;

  visible.forEach((acc, i) => {
    const isNew = highlightIds && highlightIds.has(acc.id);
    const provider = getAccountProvider(acc);
    const providerBadge = provider !== 'outlook'
      ? `<span class="account-provider ${provider}">${accountProviderLabel(provider)}</span>`
      : '';
    html += `<div class="account-item ${isNew ? 'account-item-new' : ''}" data-id="${acc.id}" style="animation-delay:${isNew ? i * 0.05 : 0}s">
      <input type="checkbox" class="account-checkbox account-check" data-id="${acc.id}" />
      <span class="account-email" title="${escapeAttr(acc.email)}">${escapeHtml(acc.email)}</span>
      ${providerBadge}
      <button class="account-copy" data-email="${escapeAttr(acc.email)}" title="复制邮箱">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="account-delete" onclick="event.stopPropagation();deleteAccount('${acc.id}')" title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  });

  listEl.innerHTML = html;

  // 事件绑定
  if (highlightIds && highlightIds.size > 0) {
    setTimeout(() => document.querySelectorAll('.account-item-new').forEach(el => el.classList.remove('account-item-new')), 3000);
  }

  document.getElementById('selectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.account-check').forEach(cb => {
      cb.checked = e.target.checked;
      cb.closest('.account-item')?.classList.toggle('selected', e.target.checked);
    });
    updateBulkDeleteButton();
  });

  document.querySelectorAll('.account-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.account-checkbox') || e.target.closest('.account-delete') || e.target.closest('.account-copy')) return;
      const cb = item.querySelector('.account-check');
      if (cb) { cb.checked = !cb.checked; item.classList.toggle('selected', cb.checked); updateSelectAllState(); updateBulkDeleteButton(); }
    });
  });

  document.querySelectorAll('.account-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.target.closest('.account-item')?.classList.toggle('selected', e.target.checked);
      updateSelectAllState();
      updateBulkDeleteButton();
    });
  });

  document.getElementById('btnDeleteSelected')?.addEventListener('click', deleteSelectedAccounts);

  document.querySelectorAll('.account-copy').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copyText(btn.dataset.email, '邮箱已复制'); });
  });
}

function updateSelectAllState() {
  const selectAll = document.getElementById('selectAll');
  if (!selectAll) return;
  const all = document.querySelectorAll('.account-check');
  const checked = document.querySelectorAll('.account-check:checked');
  selectAll.checked = all.length > 0 && all.length === checked.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
}

function updateBulkDeleteButton() {
  const btn = document.getElementById('btnDeleteSelected');
  if (!btn) return;
  const count = document.querySelectorAll('.account-check:checked').length;
  btn.style.display = count > 0 ? 'inline-flex' : 'none';
  if (count > 0) btn.textContent = `删除选中 (${count})`;
}

function getSelectedAccountIds() {
  const ids = [];
  document.querySelectorAll('.account-check:checked').forEach(cb => ids.push(cb.dataset.id));
  return ids;
}

// ==================== CRUD 操作 ====================
async function deleteAccount(id) {
  const item = document.querySelector(`.account-item[data-id="${id}"]`);
  if (item) item.classList.add('account-item-removing');

  setTimeout(async () => {
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      renderAccountList();
      showToast('已删除邮箱', 'info');
      addLog('删除邮箱', 'info');
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    }
  }, 300);
}

async function deleteSelectedAccounts() {
  const ids = getSelectedAccountIds();
  if (ids.length === 0) { showToast('请先选择要删除的邮箱', 'warning'); return; }
  if (!confirm(`确定要删除选中的 ${ids.length} 个邮箱吗？`)) return;

  ids.forEach(id => {
    const item = document.querySelector(`.account-item[data-id="${id}"]`);
    if (item) item.classList.add('account-item-removing');
  });

  setTimeout(async () => {
    try {
      await fetch('/api/accounts/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      renderAccountList();
      showToast(`已删除 ${ids.length} 个邮箱`, 'success');
      addLog(`批量删除 ${ids.length} 个邮箱`, 'info');
    } catch (err) {
      showToast('删除失败', 'error');
    }
  }, 300);
}

async function exportAccounts() {
  const ids = getSelectedAccountIds();
  try {
    const res = await fetch('/api/accounts/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids.length > 0 ? ids : undefined }),
    });
    const data = await res.json();
    if (data.success) {
      downloadTextFile(`outlook-accounts-${new Date().toISOString().slice(0, 10)}.txt`, data.content);
      copyText(data.content, `已导出 ${data.count} 个邮箱`);
      addLog(`导出 ${data.count} 个邮箱`, 'success');
    }
  } catch (err) {
    showToast('导出失败', 'error');
  }
}

// ==================== 导入解析（客户端预览） ====================
function parseImportTextPreview(text) {
  const lines = text.trim().split('\n');
  const accounts = [];
  const errors = [];
  const needsProviderConfig = [];
  const selectedProvider = getImportProvider();

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed = null;
    if (selectedProvider !== 'outlook') {
      parsed = parseExternalSimpleImportLine(trimmed);
    }

    for (let dashCount = 4; dashCount >= 1; dashCount--) {
      if (parsed) break;
      const sep = '-'.repeat(dashCount);
      let remaining = trimmed;
      const fields = [];
      for (let i = 0; i < 3; i++) {
        const idx = remaining.indexOf(sep);
        if (idx === -1) break;
        fields.push(remaining.substring(0, idx).trim());
        remaining = remaining.substring(idx + sep.length);
      }
      if (fields.length !== 3 || fields.some(field => !field) || !remaining.trim()) continue;

      const tailParts = remaining.trim().split(sep).map(part => part.trim());
      let provider = 'outlook';
      let hasConfig = true;
      let hasInlineProvider = false;
      if (tailParts.length >= 2) {
        const maybeProvider = normalizeAccountProvider(tailParts[1]);
        if (maybeProvider !== 'outlook') {
          provider = maybeProvider;
          hasConfig = tailParts.slice(2).join(sep).trim().length > 0;
          hasInlineProvider = true;
        }
      }

      parsed = {
        email: fields[0],
        provider,
        validConfig: hasConfig,
        hasInlineProvider,
      };
      break;
    }

    if (!parsed || !parsed.email.includes('@') || !parsed.validConfig) { errors.push(index); return; }
    if (!parsed.hasInlineProvider) needsProviderConfig.push(index);
    accounts.push(parsed);
  });

  return { accounts, errors, needsProviderConfig, lines: lines.filter(l => l.trim()).length };
}

function parseExternalSimpleImportLine(line) {
  for (let dashCount = 4; dashCount >= 1; dashCount--) {
    const sep = '-'.repeat(dashCount);
    const idx = line.indexOf(sep);
    if (idx === -1) continue;
    const email = line.slice(0, idx).trim();
    const password = line.slice(idx + sep.length).trim();
    if (!email || !password || password.includes(sep)) continue;
    return {
      email,
      provider: getImportProvider(),
      validConfig: true,
      hasInlineProvider: false,
      simpleExternal: true,
      sep,
    };
  }
  return null;
}

function updateImportPreview() {
  const textarea = document.getElementById('importTextarea');
  const previewEl = document.getElementById('importPreview');
  const text = textarea.value.trim();
  const provider = getImportProvider();
  const providerConfig = buildImportProviderConfig(provider);

  if (!text) {
    const configMessage = provider !== 'outlook' && !providerConfig.ok
      ? ` <span class="preview-error">${providerConfig.errors.map(escapeHtml).join('，')}</span>`
      : '';
    previewEl.innerHTML = `<span class="preview-hint">💡 粘贴邮箱数据后将自动预览，支持 Ctrl+Enter 快捷导入</span>${configMessage}`;
    return;
  }

  const { accounts, errors, needsProviderConfig, lines } = parseImportTextPreview(text);
  const externalCount = accounts.filter(account => account.provider !== 'outlook').length;
  let html = `<span class="preview-count">📋 识别 ${lines} 行`;
  if (accounts.length > 0) html += ` → <span class="preview-valid">✅ ${accounts.length} 个有效</span>`;
  if (externalCount > 0) html += ` <span class="preview-valid">外部邮箱 ${externalCount} 个</span>`;
  if (provider !== 'outlook' && needsProviderConfig.length > 0) {
    html += ` <span class="${providerConfig.ok ? 'preview-valid' : 'preview-error'}">将套用 ${accountProviderLabel(provider)} 配置 ${needsProviderConfig.length} 行</span>`;
  }
  if (provider !== 'outlook' && !providerConfig.ok) {
    html += ` <span class="preview-error">${providerConfig.errors.map(escapeHtml).join('，')}</span>`;
  }
  if (errors.length > 0) html += ` <span class="preview-error">❌ ${errors.length} 个错误</span>`;
  html += '</span>';
  previewEl.innerHTML = html;
}

function lineHasInlineExternalProvider(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  for (let dashCount = 4; dashCount >= 1; dashCount--) {
    const sep = '-'.repeat(dashCount);
    let remaining = trimmed;
    const fields = [];
    for (let i = 0; i < 3; i++) {
      const idx = remaining.indexOf(sep);
      if (idx === -1) break;
      fields.push(remaining.substring(0, idx).trim());
      remaining = remaining.substring(idx + sep.length);
    }
    if (fields.length !== 3 || fields.some(field => !field) || !remaining.trim()) continue;
    const tailParts = remaining.trim().split(sep).map(part => part.trim());
    return tailParts.length >= 2 && normalizeAccountProvider(tailParts[1]) !== 'outlook';
  }
  return false;
}

function prepareImportText(rawText) {
  const provider = getImportProvider();
  if (provider === 'outlook') return { ok: true, text: rawText, errors: [] };

  const providerConfig = buildImportProviderConfig(provider);
  if (!providerConfig.ok) return { ok: false, text: rawText, errors: providerConfig.errors };

  const lines = rawText.split('\n').map(line => {
    if (!line.trim() || lineHasInlineExternalProvider(line)) return line;
    const normalizedLine = normalizeExternalImportLine(line, provider);
    return `${normalizedLine}----${provider}----${providerConfig.config}`;
  });

  return { ok: true, text: lines.join('\n'), errors: [] };
}

function normalizeExternalImportLine(line, provider) {
  const trimmed = String(line || '').trim();
  const simple = parseExternalSimpleImportLine(trimmed);
  if (!simple) return trimmed;
  return `${simple.email}----${trimmed.slice(trimmed.indexOf(simple.sep) + simple.sep.length).trim()}----external-clientid----external-refresh-token`;
}

// ==================== 事件绑定 ====================
document.addEventListener('DOMContentLoaded', () => {
  renderAccountList();

  const importModal = document.getElementById('importModal');
  const importTextarea = document.getElementById('importTextarea');
  applyImportProviderSettings();
  refreshImportProviderUi();

  document.getElementById('btnOpenImport').addEventListener('click', () => {
    importModal.classList.add('active');
    importTextarea.focus();
    importTextarea.classList.remove('textarea-error');
    refreshImportProviderUi();
    updateImportPreview();
  });

  document.getElementById('btnCloseModal').addEventListener('click', () => importModal.classList.remove('active'));
  document.getElementById('btnCancelImport').addEventListener('click', () => importModal.classList.remove('active'));
  importModal.addEventListener('click', (e) => { if (e.target === importModal) importModal.classList.remove('active'); });

  importTextarea.addEventListener('input', () => {
    importTextarea.classList.remove('textarea-error');
    updateImportPreview();
  });

  document.getElementById('importMailProvider')?.addEventListener('change', () => {
    refreshImportProviderUi();
    saveImportProviderSettings();
    updateImportPreview();
  });

  document.querySelectorAll('#cloudflareProviderPanel input, #cloudflareProviderPanel select, #cloudMailProviderPanel input, #cloudMailProviderPanel select').forEach(el => {
    el.addEventListener('input', () => {
      saveImportProviderSettings();
      updateImportPreview();
    });
    el.addEventListener('change', () => {
      saveImportProviderSettings();
      updateImportPreview();
    });
  });

  document.querySelectorAll('.secret-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  document.getElementById('btnCfRefreshDomains')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnCfRefreshDomains');
    const configResult = buildImportProviderConfig('cloudflare-temp-mail');
    const cfSettings = collectImportProviderSettings().cloudflare;
    if (!cfSettings.baseUrl) {
      showToast('请先填写 Cloudflare Temp Email 的 TEMP API', 'warning');
      return;
    }

    setButtonLoading(btn, true);
    try {
      const res = await fetch('/api/fetch-provider-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'cloudflare-temp-mail',
          mailConfig: configResult.config || JSON.stringify(compactObject({
            baseUrl: cfSettings.baseUrl,
            adminAuth: cfSettings.adminAuth,
            customAuth: cfSettings.customAuth,
          })),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '更新域名失败');

      const optionsEl = document.getElementById('cfTempDomainOptions');
      optionsEl.innerHTML = (data.domains || [])
        .map(domain => `<option value="${escapeAttr(domain)}"></option>`)
        .join('');
      if (data.domains?.length && !document.getElementById('cfTempDomain').value.trim()) {
        document.getElementById('cfTempDomain').value = data.domains[0];
      }
      saveImportProviderSettings();
      updateImportPreview();
      showToast(`已更新 ${data.domains?.length || 0} 个域名`, 'success');
    } catch (err) {
      showToast('更新域名失败: ' + err.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // 确认导入
  document.getElementById('btnConfirmImport').addEventListener('click', async () => {
    const text = importTextarea.value;
    if (!text.trim()) {
      showToast('请输入邮箱信息', 'warning');
      importTextarea.classList.add('textarea-error');
      return;
    }

    const btn = document.getElementById('btnConfirmImport');
    setButtonLoading(btn, true);

    try {
      const prepared = prepareImportText(text);
      if (!prepared.ok) {
        prepared.errors.forEach(err => showToast(err, 'error', 5000));
        importTextarea.classList.add('textarea-error');
        return;
      }

      const res = await fetch('/api/accounts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prepared.text }),
      });
      const data = await res.json();

      if (data.errors && data.errors.length > 0) {
        data.errors.forEach(err => showToast(err, 'error', 5000));
      }

      if (data.imported > 0) {
        importTextarea.value = '';
        updateImportPreview();
        importModal.classList.remove('active');
        showImportSuccessBanner(data.imported, data.duplicates);
        addLog(`导入 ${data.imported} 个邮箱 (重复 ${data.duplicates} 个)`, 'success');
        renderAccountList();
      } else if (data.duplicates > 0) {
        showToast(`所有 ${data.duplicates} 个邮箱都已存在`, 'warning');
      } else {
        showToast('未解析到有效的邮箱数据', 'warning');
        importTextarea.classList.add('textarea-error');
      }
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Ctrl+Enter 快捷导入
  importTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnConfirmImport').click();
    }
  });

  // 搜索
  document.getElementById('accountSearch').addEventListener('input', () => renderAccountList());

  // 清空全部
  document.getElementById('btnClearAll').addEventListener('click', async () => {
    if (_cachedAccounts.length === 0) { showToast('没有可清空的邮箱', 'info'); return; }
    if (!confirm(`确定要清空全部 ${_cachedAccounts.length} 个邮箱吗？`)) return;

    document.querySelectorAll('.account-item').forEach(item => item.classList.add('account-item-removing'));
    setTimeout(async () => {
      await fetch('/api/accounts/clear', { method: 'DELETE' });
      renderAccountList();
      showToast('已清空全部邮箱', 'info');
      addLog('清空所有邮箱', 'warning');
    }, 300);
  });

  // 导出
  document.getElementById('btnExportAccounts').addEventListener('click', exportAccounts);

  // 邮件详情弹窗关闭
  const emailDetailModal = document.getElementById('emailDetailModal');
  document.getElementById('btnCloseDetail').addEventListener('click', () => emailDetailModal.classList.remove('active'));
  emailDetailModal.addEventListener('click', (e) => { if (e.target === emailDetailModal) emailDetailModal.classList.remove('active'); });
});
