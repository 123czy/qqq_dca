/**
 * Vercel Serverless Function: /api/market
 *
 * 拉取 QQQ 或 VIX 的当前价和历史数据，计算：
 *   - 当前价
 *   - 200 日均线 (SMA)
 *   - 52 周最高 (ATH)
 *   - 周线 RSI(14) - Wilder's smoothing
 *   - 距 MA200 百分比
 *   - 从 52 周高的回撤
 *
 * 数据源: Twelve Data API
 * 缓存: 内存 10 分钟（同一 ticker 复用）
 *
 * 调用示例:
 *   GET /api/market?ticker=QQQ
 *   GET /api/market?ticker=VIX
 */

// ============ 内存缓存 ============
// Vercel 函数实例会保持一段时间，缓存能跨请求复用
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============ 指标计算 ============

/**
 * Wilder's RSI (14 期)
 * 接受按时间升序排列的收盘价数组，返回最后一个 RSI 值
 */
function calcWildersRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // 第一段平均
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder's smoothing: 后续用指数平滑
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * 把日线数据聚合成周线（按 ISO 周分组，取每周最后一天的收盘）
 * dailyData: [{date: 'YYYY-MM-DD', close: number}, ...] 时间升序
 * 返回: [number, number, ...] 周线收盘价数组
 */
function aggregateToWeekly(dailyData) {
  if (dailyData.length === 0) return [];

  const weeks = new Map();
  for (const bar of dailyData) {
    const d = new Date(bar.date + 'T00:00:00Z');
    // 用 ISO 年-周作为 key
    const year = d.getUTCFullYear();
    const week = getISOWeek(d);
    const key = `${year}-W${week}`;
    // 同一周的最后一根 bar 会覆盖前面的
    weeks.set(key, bar.close);
  }
  return Array.from(weeks.values());
}

function getISOWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target - firstThursday) / 86400000;
  return 1 + Math.floor(diff / 7);
}

// ============ Twelve Data 调用 ============

/**
 * 拉取 ticker 的 250 个交易日的日线数据
 * 返回 { meta, values: [{date, close}, ...] } 时间升序
 */
async function fetchTimeSeries(ticker, apiKey) {
  // VIX 在 Twelve Data 里直接写 VIX 即可（自动识别为指数）
  const symbol = ticker === 'VIX' ? 'VIX' : ticker;
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=250&apikey=${apiKey}&order=asc`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Twelve Data HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.status === 'error') {
    throw new Error(`Twelve Data error: ${data.message || 'unknown'}`);
  }
  if (!data.values || data.values.length === 0) {
    throw new Error('Twelve Data returned no values');
  }

  return {
    values: data.values.map(v => ({
      date: v.datetime,
      close: parseFloat(v.close),
      high: parseFloat(v.high),
    })),
  };
}

// ============ 主处理函数 ============

export default async function handler(req, res) {
  // CORS - 允许从任何前端域名调用（包括本地开发）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker || !/^[A-Z^]{1,8}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }

  // 缓存命中？
  const cached = getCached(ticker);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  // 检查 API key
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'API key not configured',
      hint: 'Set TWELVE_DATA_API_KEY in environment variables',
    });
  }

  try {
    const { values } = await fetchTimeSeries(ticker, apiKey);
    const closes = values.map(v => v.close);
    const highs = values.map(v => v.high);

    const currentPrice = closes[closes.length - 1];

    // VIX 只取当前值，不算其他指标
    if (ticker === 'VIX') {
      const result = {
        ticker,
        price: round(currentPrice, 2),
        updatedAt: new Date().toISOString(),
        cached: false,
      };
      setCached(ticker, result);
      return res.status(200).json(result);
    }

    // QQQ / 其他股票: 算完整指标
    const ma200 = closes.length >= 200
      ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      : null;

    // 52 周高 = 过去约 252 个交易日的最高价
    const lookback = Math.min(252, highs.length);
    const ath52w = Math.max(...highs.slice(-lookback));

    // 周线 RSI
    const weeklyCloses = aggregateToWeekly(values);
    const rsiWeekly = calcWildersRSI(weeklyCloses, 14);

    const result = {
      ticker,
      price: round(currentPrice, 2),
      ma200: ma200 ? round(ma200, 2) : null,
      ath52w: round(ath52w, 2),
      rsiWeekly: rsiWeekly ? round(rsiWeekly, 1) : null,
      ma200Pct: ma200 ? round(((currentPrice - ma200) / ma200) * 100, 2) : null,
      drawdown: round(((ath52w - currentPrice) / ath52w) * 100, 2),
      dataPoints: values.length,
      updatedAt: new Date().toISOString(),
      cached: false,
    };

    setCached(ticker, result);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Market API error:', err);
    return res.status(502).json({
      error: 'Failed to fetch market data',
      detail: err.message,
    });
  }
}

function round(v, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}
