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
- **数据源**: [Stooq.com](https://stooq.com)（免费、无 API key、无限流）
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
  "source": "stooq"
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

## 数据更新机制

- **服务端缓存**：同一 ticker 10 分钟内复用，避免重复请求 Stooq
- **浏览器 localStorage**：保存上次获取的数据，下次打开页面直接显示
- **数据延迟**：Stooq 提供 EOD（end-of-day）数据，盘后约 1 小时更新

## 数据源说明

[Stooq.com](https://stooq.com) 是一个金融数据网站，提供全球股票、ETF、指数、外汇的免费历史数据。被无数开源项目（包括 pandas-datareader、quantmod 等）作为数据源。完全免费、不需要 API key、无明显限流。

## 故障排查

- **API 返回 502**：检查 Stooq 是否能直接访问。打开 [https://stooq.com/q/d/l/?s=qqq.us&i=d](https://stooq.com/q/d/l/?s=qqq.us&i=d) 看是否能下载 CSV。
- **"Stooq returned empty"**：Stooq 偶尔维护或临时限流。等几分钟重试。
- **VIX 拉不到**：Stooq 的 VIX 是 `^VIX`（URL 编码为 `%5Evix`）。失败时可手动从 [Yahoo Finance VIX](https://finance.yahoo.com/quote/%5EVIX) 查并填入。

## 免责声明

本工具仅用于策略分析与教育目的，不构成投资建议。
