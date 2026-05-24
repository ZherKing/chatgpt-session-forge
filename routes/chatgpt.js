/**
 * ChatGPT 自动登录路由
 * 处理批量登录、状态推送、重试等
 */

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const chatgptService = require('../services/chatgpt-service');
const imapService = require('../services/imap-service');
const graphService = require('../services/graph-service');

const DATA_FILE = path.resolve(__dirname, '..', config.dataFile);

function readAccounts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8') || '[]');
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

function updateAccountStatus(accountId, updates) {
  const accounts = readAccounts();
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx >= 0) {
    Object.assign(accounts[idx], updates);
    writeAccounts(accounts);
  }
}

function normalizeLoginError(error) {
  const message = String(error || '未知错误');
  const lower = message.toLowerCase();
  if (
    lower.includes('account_deactivated') ||
    lower.includes('deleted or deactivated')
  ) {
    return {
      message: '账号已停用',
      type: 'account_deactivated',
    };
  }

  return {
    message,
    type: null,
  };
}

/**
 * 获取验证码的函数
 * 同时尝试 IMAP 和 Graph 两种协议
 */
async function fetchVerificationCode(account) {
  const options = {
    keyword: 'OpenAI',
    sender: '',
    limit: 5,
  };

  const promises = [];

  // IMAP
  promises.push(
    imapService.fetchEmails(account, options).catch(err => {
      console.error(`[IMAP 取码失败] ${account.email}:`, err.message);
      return { success: false, emails: [] };
    })
  );

  // Graph
  promises.push(
    graphService.fetchEmails(account, options).catch(err => {
      console.error(`[Graph 取码失败] ${account.email}:`, err.message);
      return { success: false, emails: [] };
    })
  );

  const results = await Promise.all(promises);
  const allEmails = [];
  for (const r of results) {
    if (r.emails && r.emails.length > 0) {
      allEmails.push(...r.emails);
    }
  }

  return allEmails;
}

/**
 * POST /api/chatgpt/login - 批量登录
 */
router.post('/chatgpt/login', async (req, res) => {
  const { accountIds, concurrency } = req.body;

  if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ success: false, error: '请选择要登录的账号' });
  }

  const requestedConcurrency = Math.max(
    1,
    Math.min(20, parseInt(concurrency, 10) || config.concurrency || 8)
  );
  chatgptService.setConcurrency(requestedConcurrency);

  const broadcast = req.app.get('broadcast');
  const accounts = readAccounts();
  const toLogin = accounts.filter(a => accountIds.includes(a.id));

  if (toLogin.length === 0) {
    return res.status(404).json({ success: false, error: '未找到指定的账号' });
  }

  // 立即返回，后台执行登录
  res.json({
    success: true,
    message: `登录任务已启动，共 ${toLogin.length} 个账号，并发 ${Math.min(requestedConcurrency, toLogin.length)}`,
    count: toLogin.length,
    concurrency: Math.min(requestedConcurrency, toLogin.length),
  });

  // 后台执行批量登录
  (async () => {
    let completed = 0;
    let succeeded = 0;
    let nextIndex = 0;

    async function runOne(account, workerId) {
      // 更新状态为登录中
      updateAccountStatus(account.id, { status: 'logging_in', error: null, errorType: null });
      broadcast({
        type: 'login_start',
        accountId: account.id,
        email: account.email,
        workerId,
      });

      try {
        const session = await chatgptService.login(
          account,
          fetchVerificationCode,
          (status, detail) => {
            broadcast({
              type: 'login_status',
              accountId: account.id,
              status,
              detail,
              email: account.email,
              workerId,
            });
          }
        );

        // 登录成功
        updateAccountStatus(account.id, {
          status: 'success',
          session,
          error: null,
          errorType: null,
        });

        succeeded++;
        broadcast({
          type: 'login_success',
          accountId: account.id,
          email: account.email,
        });
      } catch (err) {
        const loginError = normalizeLoginError(err.message);

        // 登录失败
        updateAccountStatus(account.id, {
          status: 'failed',
          error: loginError.message,
          errorType: loginError.type,
        });

        broadcast({
          type: 'login_failed',
          accountId: account.id,
          email: account.email,
          error: loginError.message,
          errorType: loginError.type,
        });
      } finally {
        completed++;

        broadcast({
          type: 'login_progress',
          completed,
          total: toLogin.length,
          succeeded,
        });
      }
    }

    async function worker(workerId) {
      while (nextIndex < toLogin.length) {
        const account = toLogin[nextIndex++];
        await runOne(account, workerId);
      }
    }

    const workerCount = Math.min(requestedConcurrency, toLogin.length);
    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

    broadcast({
      type: 'login_complete',
      total: toLogin.length,
      succeeded,
      failed: toLogin.length - succeeded,
    });
  })().catch(err => {
    console.error('[批量登录任务异常]', err);
    broadcast({
      type: 'login_complete',
      total: toLogin.length,
      succeeded: 0,
      failed: toLogin.length,
      error: err.message,
    });
  });
});

/**
 * POST /api/chatgpt/login/:id - 单个账号登录
 */
router.post('/chatgpt/login/:id', async (req, res) => {
  const accounts = readAccounts();
  const account = accounts.find(a => a.id === req.params.id);

  if (!account) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }

  const broadcast = req.app.get('broadcast');

  // 立即返回
  res.json({ success: true, message: '登录任务已启动' });

  // 后台执行
  (async () => {
    updateAccountStatus(account.id, { status: 'logging_in', error: null, errorType: null });
    broadcast({ type: 'login_start', accountId: account.id, email: account.email });

    let succeeded = 0;
    try {
      const session = await chatgptService.login(
        account,
        fetchVerificationCode,
        (status, detail) => {
          broadcast({ type: 'login_status', accountId: account.id, email: account.email, status, detail });
        }
      );

      updateAccountStatus(account.id, { status: 'success', session, error: null, errorType: null });
      broadcast({ type: 'login_success', accountId: account.id, email: account.email });
      succeeded = 1;
    } catch (err) {
      const loginError = normalizeLoginError(err.message);
      updateAccountStatus(account.id, { status: 'failed', error: loginError.message, errorType: loginError.type });
      broadcast({ type: 'login_failed', accountId: account.id, email: account.email, error: loginError.message, errorType: loginError.type });
    }

    broadcast({ type: 'login_progress', completed: 1, total: 1, succeeded });
  })();
});

/**
 * POST /api/chatgpt/retry-failed - 重试所有失败的账号
 */
router.post('/chatgpt/retry-failed', (req, res) => {
  const accounts = readAccounts();
  const failed = accounts.filter(a => a.status === 'failed');

  if (failed.length === 0) {
    return res.json({ success: false, error: '没有失败的账号需要重试' });
  }

  // 触发登录逻辑（复用 login 路由的 body）
  req.body = { accountIds: failed.map(a => a.id), concurrency: req.body.concurrency };

  // 由前端再调 /api/chatgpt/login 接口
  res.json({
    success: true,
    accountIds: failed.map(a => a.id),
    count: failed.length,
    message: `找到 ${failed.length} 个失败账号`,
  });
});

/**
 * GET /api/chatgpt/sessions - 获取所有成功的 session
 */
router.get('/chatgpt/sessions', (req, res) => {
  const accounts = readAccounts();
  const sessions = accounts
    .filter(a => a.status === 'success' && a.session)
    .map(a => ({
      id: a.id,
      email: a.email,
      session: a.session,
    }));

  res.json({ success: true, sessions, count: sessions.length });
});

module.exports = router;
