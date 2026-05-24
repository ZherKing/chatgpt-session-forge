/**
 * 邮件取件路由
 * 支持 IMAP OAuth2 和 Graph API 双协议
 */

const router = require('express').Router();
const imapService = require('../services/imap-service');
const graphService = require('../services/graph-service');
const externalMailService = require('../services/external-mail-service');

/**
 * POST /api/fetch-imap - IMAP 协议取件
 */
router.post('/fetch-imap', async (req, res) => {
  try {
    const { email, clientId, refreshToken, keyword, limit, sender } = req.body;

    if (!email || !clientId || !refreshToken) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: email, clientId, refreshToken',
      });
    }

    const result = await imapService.fetchEmails(
      { email, clientId, refreshToken },
      { keyword: keyword || '', limit: limit || 10, sender: sender || '' }
    );

    res.json(result);
  } catch (err) {
    console.error('[IMAP Error]', err.message);
    res.json({
      success: false,
      error: err.message,
      detail: err.stack,
      protocol: 'imap',
      emails: [],
    });
  }
});

/**
 * POST /api/fetch-graph - Graph API 取件
 */
router.post('/fetch-graph', async (req, res) => {
  try {
    const { email, clientId, refreshToken, keyword, limit, sender } = req.body;

    if (!email || !clientId || !refreshToken) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: email, clientId, refreshToken',
      });
    }

    const result = await graphService.fetchEmails(
      { email, clientId, refreshToken },
      { keyword: keyword || '', limit: limit || 10, sender: sender || '' }
    );

    res.json(result);
  } catch (err) {
    console.error('[Graph Error]', err.message);
    res.json({
      success: false,
      error: err.message,
      detail: err.stack,
      protocol: 'graph',
      emails: [],
    });
  }
});

/**
 * POST /api/fetch-provider - 外部邮箱 Provider 取件
 */
router.post('/fetch-provider', async (req, res) => {
  try {
    const { email, keyword, limit, sender } = req.body;
    const account = {
      email,
      mailProvider: req.body.mailProvider || req.body.provider,
      mailConfig: req.body.mailConfig || req.body.providerConfig,
    };
    const provider = externalMailService.getAccountMailProvider(account);

    if (!email || provider === 'outlook') {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: email, mailProvider, mailConfig',
      });
    }

    const result = await externalMailService.fetchEmails(account, {
      keyword: keyword || '',
      limit: limit || 10,
      sender: sender || '',
    });

    res.json(result);
  } catch (err) {
    console.error('[External Mail Error]', err.message);
    res.json({
      success: false,
      error: err.message,
      protocol: 'external',
      emails: [],
    });
  }
});

/**
 * POST /api/fetch-provider-domains - 获取外部邮箱 Provider 域名
 */
router.post('/fetch-provider-domains', async (req, res) => {
  try {
    const provider = externalMailService.normalizeProvider(req.body.mailProvider || req.body.provider);
    const mailConfig = req.body.mailConfig || req.body.providerConfig || {};

    if (provider !== 'cloudflare-temp-mail') {
      return res.status(400).json({
        success: false,
        error: '当前只有 Cloudflare Temp Mail 支持更新域名',
      });
    }

    const result = await externalMailService.fetchCloudflareTempMailDomains(mailConfig);
    res.json({
      success: true,
      domains: result.domains,
      source: result.source,
    });
  } catch (err) {
    console.error('[External Mail Domains Error]', err.message);
    res.json({
      success: false,
      error: err.message,
      domains: [],
    });
  }
});

module.exports = router;
