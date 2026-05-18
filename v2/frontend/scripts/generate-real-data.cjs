const fs = require("fs");
const path = require("path");

const jsonPath = path.resolve(__dirname, "../public/real-funds.json");
const funds = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

const typeMap = {
  "股票型": "equity",
  "混合型": "hybrid",
  "债券型": "bond",
  "指数型": "index",
  "QDII": "qdii",
  "货币型": "money",
  "FOF": "fof",
};

function codeToId(code) {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) - hash + code.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100000;
}

const fundsData = funds.map((f, idx) => ({
  id: codeToId(f.code),
  fundCode: f.code,
  fundName: f.name,
  fundAbbr: f.name.replace(/混合型|股票型|债券型|指数型|证券投资基金|A类|C类/g, "").trim(),
  fundType: typeMap[f.type] || "hybrid",
  category: f.type || "其他",
  company: "—",
  riskLevel: "medium_high",
  isContinuousMarketing: 1,
  nav: f.nav != null ? String(f.nav) : "—",
  accumNav: f.nav != null ? String(f.nav) : "—",
  dailyChange: f.day_growth != null ? String(f.day_growth) : "0",
  totalScale: "—",
  benchmark: "—",
  investStrategy: "—",
  feeManage: "—",
  feeCustody: "—",
  stars: 4,
  managerId: null,
  tags: f.tags || [],
  trackingIndex: null,
}));

const performanceData = funds.map((f) => ({
  fundId: codeToId(f.code),
  return1m: f.near_1m != null ? String(f.near_1m) : "—",
  return3m: f.near_3m != null ? String(f.near_3m) : "—",
  return6m: f.near_6m != null ? String(f.near_6m) : "—",
  return1y: f.near_1y != null ? String(f.near_1y) : "—",
  return2y: "—",
  return3y: f.near_3y != null ? String(f.near_3y) : "—",
  return5y: "—",
  returnThisYear: f.ytd != null ? String(f.ytd) : "—",
  annualizedReturn: "—",
  annualizedVolatility: "—",
  sharpeRatio: "—",
  maxDrawdown: "—",
  calmarRatio: "—",
  sortinoRatio: "—",
  informationRatio: "—",
  alpha: "—",
  beta: "—",
  winRate: "—",
  recoveryPeriod: 0,
}));

const targetPath = path.resolve(__dirname, "../src/hooks/useFundData.ts");
let content = fs.readFileSync(targetPath, "utf-8");

// Replace fundsData
const fundsDataStr = JSON.stringify(fundsData, null, 2).replace(/"([^"]+)":/g, '$1:');
content = content.replace(
  /const fundsData = \[.*?\];/s,
  `const fundsData = ${fundsDataStr};`
);

// Replace performanceData
const perfDataStr = JSON.stringify(performanceData, null, 2).replace(/"([^"]+)":/g, '$1:');
content = content.replace(
  /const performanceData = \[.*?\];/s,
  `const performanceData = ${perfDataStr};`
);

fs.writeFileSync(targetPath, content, "utf-8");
console.log(`Updated useFundData.ts with ${funds.length} real funds`);
