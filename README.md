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
- **数据源**: Twelve Data API（免费层 800 次/天）
- **缓存**: 服务端内存缓存 10 分钟 + 浏览器 localStorage

## 部署到 Vercel（首次部署）

### 1. 准备账号
- [GitHub](https://github.com) 账号
- [Vercel](https://vercel.com) 账号（用 GitHub 登录）
- [Twelve Data](https://twelvedata.com) 免费 API key

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
1. 登录 Vercel → New Project → Import 你刚才的 GitHub repo
2. Framework Preset 选 **Other**（其实它会自动识别）
3. 展开 **Environment Variables**，添加：
   - Name: `TWELVE_DATA_API_KEY`
   - Value: 你的 Twelve Data API key
4. 点 Deploy

约 1 分钟后会得到一个 URL，比如 `qqq-dca-xxx.vercel.app`。

### 4. 测试 API
打开 `https://你的URL/api/market?ticker=QQQ`，应该看到 JSON 响应。

### 5. 自定义域名（可选）
Vercel 项目设置 → Domains → 添加你买的域名。

## 本地开发

```bash
npm i -g vercel
cd qqq-dca
# 创建 .env.local
echo "TWELVE_DATA_API_KEY=你的key" > .env.local
vercel dev
```

打开 `http://localhost:3000`。

## 数据更新机制

- 服务端缓存：同一 ticker 10 分钟内复用，避免重复调 Twelve Data
- 浏览器 localStorage：保存上次获取的数据，下次打开页面直接显示
- 数据延迟：免费层数据有 15 分钟左右延迟，对月度定投策略足够

## 几个朋友一起用够吗？

Twelve Data 免费层 800 次/天，配合服务端 10 分钟缓存，即使 20 个朋友每天各刷 5 次，实际 API 调用也就 50 次左右。**绝对够用**。

## 免责声明

本工具仅用于策略分析与教育目的，不构成投资建议。
