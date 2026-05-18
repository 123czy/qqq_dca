# QQQ Smart DCA Dashboard

一个 QQQ 智能定投策略仪表盘，基于多指标（200日均线偏离、回撤幅度、周线 RSI、VIX）动态调整定投倍数。

## 功能

- **01 实时指标获取** - 一键拉取 QQQ 和 VIX 的实时数据
- **02 指标解读** - 4 个核心指标的可视化展示，含 info tooltip 说明
- **03 本月策略** - 自动计算建议定投倍数（0.3X – 5X）
- **04 完整倍数表** - 8 档市场状态对应的操作建议
- **05 长期收益模拟** - 智能 DCA vs 普通 DCA 的 N 年蒙特卡洛对比
- **06 长期人民币规划** - 不同年化回报情景下的复利计算

## 架构

- **前端**: 单 HTML 文件（vanilla JS + Chart.js），无构建步骤
- **后端**: 一个 Vercel Serverless Function (`api/market.js`)
- **数据源**: Yahoo Finance v8 chart endpoint（免费、无 API key、覆盖股票/ETF/指数）
- **缓存**: 服务端内存缓存 10 分钟 + 浏览器 localStorage

## 部署到 Vercel（首次部署）

### 1. 准备账号
- [GitHub](https://github.com) 账号
- [Vercel](https://vercel.com) 账号（用 GitHub 登录）

**不需要任何 API key**。

### 2. 推送代码到 GitHub

```bash
cd qqq-dca
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin git@github.com:YOURNAME/qqq-dca.git
git push -u origin main
```

### 3. Vercel 导入项目

1. 登录 Vercel → New Project → Import 你的 GitHub repo
2. Framework Preset 选 **Other**（自动识别）
3. 直接点 **Deploy**（不需要任何环境变量）

约 1 分钟后会得到一个 URL，比如 `qqq-dca-xxx.vercel.app`。

### 4. 测试 API

打开 `https://你的URL/api/market?ticker=QQQ`，应该看到 JSON 响应：

```json
{
  "ticker": "QQQ",
  "price": 721.34,
  "ma200": 618.42,
  "ath52w": 725.10,
  "rsiWeekly": 80.5,
  "ma200Pct": 16.65,
  "drawdown": 0.52,
  "latestDate": "2026-05-16",
  "source": "yahoo"
}
```

再访问 `?ticker=VIX`：
```json
{
  "ticker": "VIX",
  "price": 17.85,
  "source": "yahoo"
}
```

### 5. 自定义域名（可选）

Vercel 项目设置 → Domains → 添加你买的域名。

## 本地开发

```bash
npm i -g vercel
cd qqq-dca
vercel dev
```

打开 `http://localhost:3000`。

## 支持的 ticker

代码里 `toYahooSymbol()` 函数处理 ticker 映射：

| 输入 | Yahoo symbol | 用途 |
|---|---|---|
| `QQQ` | `QQQ` | Nasdaq 100 ETF |
| `VIX` | `^VIX` | 恐慌指数 |
| `SPX` | `^GSPC` | S&P 500 指数 |
| `NDX` | `^NDX` | Nasdaq 100 指数 |
| `DJI` | `^DJI` | 道琼斯指数 |
| 其他 | 原样传 | 任意股票/ETF |

要加新映射，修改 `api/market.js` 的 `toYahooSymbol()` 函数即可。

## 数据更新机制

- **服务端缓存**：同一 ticker 10 分钟内复用，避免重复请求 Yahoo
- **浏览器 localStorage**：保存上次获取的数据，下次打开页面直接显示
- **数据延迟**：Yahoo 的 v8 chart endpoint 提供准实时数据（15分钟延迟）

## 数据源说明

Yahoo Finance 的 v8 chart endpoint 是 yahoo.com 网站本身用来渲染历史走势图的接口，返回 JSON 格式的 OHLC 数据。虽然 Yahoo 关闭了官方 API 但这个 endpoint 一直工作。被 [yfinance](https://github.com/ranaroussi/yfinance)、[pandas-datareader](https://pandas-datareader.readthedocs.io/) 等知名库长期使用。

**URL 格式**：`https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?range=1y&interval=1d`

## 故障排查

- **API 返回 502 / "Yahoo HTTP 429"**：被限流了，等几分钟。我们已经设了 User-Agent 避免被直接拒，但如果几个朋友同时高频请求可能会触发。服务端 10 分钟缓存能避免这种情况。
- **"Yahoo returned no result"**：ticker 拼错或 Yahoo 不认识。检查 [Yahoo Finance 网站](https://finance.yahoo.com) 上的 symbol 是否正确。
- **VIX 显示为 null 或 0**：VIX 的 high 字段偶尔为 null（指数特性），代码会自动 fallback 到 close 值。
- **数据是上个交易日的**：盘前盘后是正常的，Yahoo 在盘后才更新当日 EOD 数据。

## 免责声明

本工具仅用于策略分析与教育目的，不构成投资建议。
