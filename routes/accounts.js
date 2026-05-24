/**
 * 账号管理路由
 * 处理邮箱账号的 CRUD 操作
 */

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const DATA_FILE = path.resolve(__dirname, '..', config.dataFile);

// ==================== 辅助函数 ====================

function readAccounts() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

/**
 * 解析导入文本
 * 格式：邮箱----密码----clientId----refreshToken（1-4个短横线分隔）
 */
function parseImportText(text) {
  const lines = text.trim().split('\n');
  const accounts = [];
  const errors = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parts = null;
    for (let dashCount = 4; dashCount >= 1; dashCount--) {
      const sep = '-'.repeat(dashCount);
      const testParts = trimmed.split(sep);

      if (testParts.length === 4) {
        const cleaned = testParts.map(p => p.trim());
        if (cleaned.every(p => p.length > 0)) {
          parts = cleaned;
          break;
        }
      }

      if (testParts.length > 4) {
        const cleaned = [];
        let remaining = trimmed;
        for (let i = 0; i < 3; i++) {
          const idx = remaining.indexOf(sep);
          if (idx === -1) break;
          cleaned.push(remaining.substring(0, idx).trim());
          remaining = remaining.substring(idx + sep.length);
        }
        if (cleaned.length === 3 && remaining.trim().length > 0) {
          cleaned.push(remaining.trim());
          parts = cleaned;
          break;
        }
      }
    }

    if (!parts || parts.length !== 4) {
      errors.push(`第 ${index + 1} 行格式错误: ${trimmed.substring(0, 50)}...`);
      return;
    }

    const [email, password, clientId, refreshToken] = parts;

    if (!email.includes('@')) {
      errors.push(`第 ${index + 1} 行邮箱格式无效: ${email}`);
      return;
    }

    accounts.push({
      id: uuidv4(),
      email,
      password,
      clientId,
      refreshToken,
      status: 'idle',
      session: null,
      error: null,
      addedAt: new Date().toISOString(),
    });
  });

  return { accounts, errors };
}

// ==================== 路由 ====================

/**
 * GET /api/accounts - 获取所有账号
 */
router.get('/accounts', (req, res) => {
  const accounts = readAccounts();
  // 返回时隐藏敏感信息
  const safe = accounts.map(a => ({
    ...a,
    refreshToken: a.refreshToken ? '***' + a.refreshToken.slice(-8) : '',
    password: a.password ? '***' : '',
  }));
  res.json({ success: true, accounts: safe, total: accounts.length });
});

/**
 * GET /api/accounts/full - 获取所有账号（含完整信息，前端取件用）
 */
router.get('/accounts/full', (req, res) => {
  const accounts = readAccounts();
  res.json({ success: true, accounts });
});

/**
 * POST /api/accounts/import - 批量导入账号
 */
router.post('/accounts/import', (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: '导入内容不能为空' });
  }

  const { accounts: newAccounts, errors } = parseImportText(text);

  if (newAccounts.length === 0) {
    return res.json({
      success: false,
      error: '未解析到有效账号',
      errors,
      imported: 0,
      duplicates: 0,
    });
  }

  // 去重
  const existing = readAccounts();
  const existingEmails = new Set(existing.map(a => a.email.toLowerCase()));
  const unique = newAccounts.filter(a => !existingEmails.has(a.email.toLowerCase()));
  const duplicates = newAccounts.length - unique.length;

  const merged = [...existing, ...unique];
  writeAccounts(merged);

  res.json({
    success: true,
    imported: unique.length,
    duplicates,
    errors,
    total: merged.length,
  });
});

/**
 * DELETE /api/accounts/clear - 清空所有账号
 */
router.delete('/accounts/clear', (req, res) => {
  writeAccounts([]);
  res.json({ success: true, message: '已清空所有账号' });
});

/**
 * DELETE /api/accounts/:id - 删除单个账号
 */
router.delete('/accounts/:id', (req, res) => {
  const accounts = readAccounts();
  const filtered = accounts.filter(a => a.id !== req.params.id);

  if (filtered.length === accounts.length) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }

  writeAccounts(filtered);
  res.json({ success: true, message: '已删除' });
});

/**
 * POST /api/accounts/delete-batch - 批量删除
 */
router.post('/accounts/delete-batch', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ success: false, error: '无效的 ID 列表' });
  }

  const accounts = readAccounts();
  const idSet = new Set(ids);
  const filtered = accounts.filter(a => !idSet.has(a.id));
  writeAccounts(filtered);

  res.json({
    success: true,
    deleted: accounts.length - filtered.length,
    remaining: filtered.length,
  });
});

/**
 * POST /api/accounts/export - 导出账号
 */
router.post('/accounts/export', (req, res) => {
  const { ids } = req.body;
  let accounts = readAccounts();

  if (ids && Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    accounts = accounts.filter(a => idSet.has(a.id));
  }

  const content = accounts
    .map(a => [a.email, a.password, a.clientId, a.refreshToken].join('----'))
    .join('\n');

  res.json({ success: true, content, count: accounts.length });
});

module.exports = router;
