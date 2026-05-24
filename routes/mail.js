/**
 * 邮件取件路由
 * 支持 IMAP OAuth2 和 Graph API 双协议
 */

const router = require('express').Router();
const imapService = require('../services/imap-service');
const graphService = require('../services/graph-service');

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

module.exports = router;
