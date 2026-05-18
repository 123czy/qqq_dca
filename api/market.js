/**
 * Vercel Serverless Function: /api/market
 *
 * 数据源: Yahoo Finance v8 chart endpoint (免费, 无 key, 无明确限流)
 *   - QQQ:  https://query1.finance.yahoo.com/v8/finance/chart/QQQ?range=1y&interval=1d
 *   - VIX:  https://query1.finance.yahoo.com/v8/finance/chart/^VIX?range=1y&interval=1d
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

// ============ Yahoo Finance 数据源 ============

/**
 * 构造 Yahoo v8 chart URL
 * VIX 在 Yahoo 上是 ^VIX，URL 中需要编码为 %5EVIX
 */
function buildYahooUrl(ticker) {
  const symbol = ticker === 'VIX' ? '%5EVIX' : encodeURIComponent(ticker);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
}

/**
 * 调用 Yahoo Finance v8 chart endpoint
 * 必须设置 User-Agent，否则 Yahoo 会拒绝默认 fetch 的 user-agent
 */
async function fetchFromYahoo(ticker) {
  const url = buildYahooUrl(ticker);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status} for ${ticker}`);
  }

  const json = await res.json();

  // Yahoo 的错误格式: { chart: { result: null, error: {...} } }
  if (json.chart?.error) {
    const e = json.chart.error;
    throw new Error(`Yahoo API error: ${e.code || ''} ${e.description || JSON.stringify(e)}`);
  }

  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(`Yahoo returned no result for ${ticker}`);
  }

  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  if (!timestamps || !quote || !quote.close) {
    throw new Error(`Yahoo response missing timestamps or close data for ${ticker}`);
  }

  // 转成统一格式 [{date, close, high}, ...] 时间升序
  // Yahoo 返回本身就是升序，但有 null 值需过滤
  const values = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close[i];
    const high = quote.high[i];
    if (close == null) continue; // 跳过缺失数据点
    const d = new Date(timestamps[i] * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    values.push({
      date: dateStr,
      close: close,
      high: high != null ? high : close,
    });
  }

  if (values.length === 0) {
    throw new Error(`Yahoo returned data but no valid points for ${ticker}`);
  }

  return values;
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
    const values = await fetchFromYahoo(ticker);
    const closes = values.map(v => v.close);
    const highs = values.map(v => v.high);
    const currentPrice = closes[closes.length - 1];

    // VIX: 只取当前值
    if (ticker === 'VIX') {
      const result = {
        ticker,
        price: round(currentPrice, 2),
        dataPoints: values.length,
        latestDate: values[values.length - 1].date,
        source: 'yahoo',
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
    const lookback = Math.min(252, highs.length);
    const ath52w = Math.max(...highs.slice(-lookback));
    const weeklyCloses = aggregateToWeekly(values);
    const rsiWeekly = calcWildersRSI(weeklyCloses, 14);

    const result = {
      ticker,
      price: round(currentPrice, 2),
      ma200: ma200 ? round(ma200, 2) : null,
      ath52w: round(ath52w, 2),
      rsiWeekly: rsiWeekly !== null ? round(rsiWeekly, 1) : null,
      ma200Pct: ma200 ? round(((currentPrice - ma200) / ma200) * 100, 2) : null,
      drawdown: round(((ath52w - currentPrice) / ath52w) * 100, 2),
      dataPoints: values.length,
      weeklyDataPoints: weeklyCloses.length,
      latestDate: values[values.length - 1].date,
      source: 'yahoo',
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
