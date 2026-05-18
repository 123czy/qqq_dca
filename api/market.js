/**
 * Vercel Serverless Function: /api/market
 *
 * 数据源 (全部免费、不要 key、不限流):
 *   - 股票/ETF (QQQ): Stooq.com CSV
 *   - VIX: Stooq.com (^VIX)
 *
 * 计算:
 *   - 当前价
 *   - 200 日均线 (SMA)
 *   - 52 周最高 (ATH)
 *   - 周线 RSI(14) - Wilder's smoothing
 *
 * 缓存: 内存 10 分钟
 *
 * 调用示例:
 *   GET /api/market?ticker=QQQ
 *   GET /api/market?ticker=VIX
 */

// ============ 内存缓存 ============
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

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

function calcWildersRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
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

function getISOWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target - firstThursday) / 86400000;
  return 1 + Math.floor(diff / 7);
}

function aggregateToWeekly(dailyData) {
  if (dailyData.length === 0) return [];
  const weeks = new Map();
  for (const bar of dailyData) {
    const d = new Date(bar.date + 'T00:00:00Z');
    const year = d.getUTCFullYear();
    const week = getISOWeek(d);
    weeks.set(`${year}-W${week}`, bar.close);
  }
  return Array.from(weeks.values());
}

// ============ Stooq 数据源 ============
/**
 * Stooq 返回 CSV:
 *   Date,Open,High,Low,Close,Volume
 *   2024-01-02,408.55,410.34,406.50,409.52,38500000
 */
function buildStooqUrl(ticker) {
  if (ticker === 'VIX') return 'https://stooq.com/q/d/l/?s=%5Evix&i=d'; // %5E = ^
  return `https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&i=d`;
}

function parseStooqCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('Stooq CSV has no data rows');
  }
  const header = lines[0].toLowerCase();
  if (!header.includes('date') || !header.includes('close')) {
    throw new Error(`Stooq CSV header invalid: "${lines[0].slice(0, 100)}"`);
  }
  const values = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 5) continue;
    const close = parseFloat(parts[4]);
    const high = parseFloat(parts[2]);
    if (isNaN(close)) continue;
    values.push({
      date: parts[0],
      high: isNaN(high) ? close : high,
      close,
    });
  }
  if (values.length === 0) {
    throw new Error('Stooq CSV parsed but no valid rows');
  }
  return values;
}

async function fetchFromStooq(ticker) {
  const url = buildStooqUrl(ticker);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QQQDCABot/1.0)' },
  });
  if (!res.ok) {
    throw new Error(`Stooq HTTP ${res.status} for ${ticker}`);
  }
  const text = await res.text();
  if (!text || text.length < 50) {
    throw new Error(`Stooq returned empty for ${ticker}: "${text.slice(0, 80)}"`);
  }
  if (text.toLowerCase().includes('no data')) {
    throw new Error(`Stooq has no data for ${ticker}`);
  }
  return parseStooqCSV(text);
}

// ============ 主处理函数 ============

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker || !/^[A-Z]{1,8}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker', received: ticker });
  }

  const cached = getCached(ticker);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  try {
    const values = await fetchFromStooq(ticker);
    values.sort((a, b) => a.date.localeCompare(b.date));
    const tail = values.slice(-250);
    const closes = tail.map(v => v.close);
    const highs = tail.map(v => v.high);
    const currentPrice = closes[closes.length - 1];

    if (ticker === 'VIX') {
      const result = {
        ticker,
        price: round(currentPrice, 2),
        dataPoints: tail.length,
        latestDate: tail[tail.length - 1].date,
        source: 'stooq',
        updatedAt: new Date().toISOString(),
        cached: false,
      };
      setCached(ticker, result);
      return res.status(200).json(result);
    }

    const ma200 = closes.length >= 200
      ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      : null;
    const lookback = Math.min(252, highs.length);
    const ath52w = Math.max(...highs.slice(-lookback));
    const weeklyCloses = aggregateToWeekly(tail);
    const rsiWeekly = calcWildersRSI(weeklyCloses, 14);

    const result = {
      ticker,
      price: round(currentPrice, 2),
      ma200: ma200 ? round(ma200, 2) : null,
      ath52w: round(ath52w, 2),
      rsiWeekly: rsiWeekly !== null ? round(rsiWeekly, 1) : null,
      ma200Pct: ma200 ? round(((currentPrice - ma200) / ma200) * 100, 2) : null,
      drawdown: round(((ath52w - currentPrice) / ath52w) * 100, 2),
      dataPoints: tail.length,
      weeklyDataPoints: weeklyCloses.length,
      latestDate: tail[tail.length - 1].date,
      source: 'stooq',
      updatedAt: new Date().toISOString(),
      cached: false,
    };
    setCached(ticker, result);
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[market] ticker=${ticker}:`, err);
    return res.status(502).json({
      error: 'Failed to fetch market data',
      ticker,
      detail: err.message,
    });
  }
}

function round(v, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}
