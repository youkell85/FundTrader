import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  int,
  bigint,
  date,
  json,
  index,
  // float,
} from "drizzle-orm/mysql-core";

// ==================== 用户表 ====================
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ==================== 本地认证用户表 ====================
export const localUsers = mysqlTable("local_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
});

export type LocalUser = typeof localUsers.$inferSelect;

// ==================== 基金产品表 ====================
export const funds = mysqlTable(
  "funds",
  {
    id: serial("id").primaryKey(),
    fundCode: varchar("fund_code", { length: 20 }).notNull().unique(),
    fundName: varchar("fund_name", { length: 255 }).notNull(),
    fundAbbr: varchar("fund_abbr", { length: 100 }),
    fundType: mysqlEnum("fund_type", [
      "equity", // 股票型
      "bond", // 债券型
      "hybrid", // 混合型
      "index", // 指数型
      "qdii", // QDII
      "money", // 货币型
      "fof", // FOF
      "reits", // REITs
    ]).notNull(),
    category: varchar("category", { length: 100 }), // 细分分类如：大盘成长、中盘价值等
    company: varchar("company", { length: 255 }).notNull(), // 基金公司
    companyCode: varchar("company_code", { length: 50 }),
    managerId: bigint("manager_id", { mode: "number", unsigned: true }),
    nav: decimal("nav", { precision: 10, scale: 4 }), // 最新净值
    navDate: date("nav_date"),
    accumNav: decimal("accum_nav", { precision: 10, scale: 4 }), // 累计净值
    dailyChange: decimal("daily_change", { precision: 8, scale: 4 }), // 日涨跌幅
    totalScale: decimal("total_scale", { precision: 20, scale: 4 }), // 基金规模(亿元)
    estScale: decimal("est_scale", { precision: 20, scale: 4 }), // 估算规模
    establishDate: date("establish_date"),
    benchmark: text("benchmark"), // 业绩比较基准
    investStrategy: text("invest_strategy"), // 投资策略
    riskLevel: mysqlEnum("risk_level", [
      "low",
      "low_medium",
      "medium",
      "medium_high",
      "high",
    ]), // 风险等级
    isContinuousMarketing: int("is_continuous_marketing").default(0), // 是否持续营销
    isOnShelf: int("is_on_shelf").default(1), // 是否在售
    feeManage: decimal("fee_manage", { precision: 6, scale: 4 }), // 管理费率
    feeCustody: decimal("fee_custody", { precision: 6, scale: 4 }), // 托管费率
    feeSubscription: decimal("fee_subscription", { precision: 6, scale: 4 }), // 认购费率
    feePurchase: decimal("fee_purchase", { precision: 6, scale: 4 }), // 申购费率
    stars: int("stars"), // 晨星评级 1-5
    trackingIndex: varchar("tracking_index", { length: 255 }), // 跟踪指数（指数型）
    tags: json("tags"), // 标签如["AI优选","攻守兼备"]
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_fund_type").on(table.fundType),
    index("idx_category").on(table.category),
    index("idx_company").on(table.company),
    index("idx_manager").on(table.managerId),
    index("idx_marketing").on(table.isContinuousMarketing),
    index("idx_risk_level").on(table.riskLevel),
  ]
);

export type Fund = typeof funds.$inferSelect;

// ==================== 基金经理表 ====================
export const fundManagers = mysqlTable(
  "fund_managers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    gender: mysqlEnum("gender", ["male", "female"]),
    education: varchar("education", { length: 100 }), // 学历
    careerStart: date("career_start"), // 从业起始日
    manageYears: decimal("manage_years", { precision: 5, scale: 2 }), // 管理年限
    totalScale: decimal("total_scale", { precision: 20, scale: 4 }), // 在管总规模(亿元)
    fundCount: int("fund_count").default(0), // 在管基金数量
    company: varchar("company", { length: 255 }), // 所属公司
    investmentStyle: varchar("investment_style", { length: 255 }), // 投资风格标签
    styleDescription: text("style_description"), // 风格描述（LLM生成）
    philosophy: text("philosophy"), // 投资理念
    bestReturn: decimal("best_return", { precision: 10, scale: 4 }), // 最佳年度回报
    worstReturn: decimal("worst_return", { precision: 10, scale: 4 }), // 最差年度回报
    avatar: text("avatar"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_manager_name").on(table.name)]
);

export type FundManager = typeof fundManagers.$inferSelect;

// ==================== 基金业绩表 ====================
export const fundPerformance = mysqlTable(
  "fund_performance",
  {
    id: serial("id").primaryKey(),
    fundId: bigint("fund_id", { mode: "number", unsigned: true }).notNull(),
    return1m: decimal("return_1m", { precision: 10, scale: 4 }), // 近1月收益
    return3m: decimal("return_3m", { precision: 10, scale: 4 }), // 近3月收益
    return6m: decimal("return_6m", { precision: 10, scale: 4 }), // 近6月收益
    return1y: decimal("return_1y", { precision: 10, scale: 4 }), // 近1年收益
    return2y: decimal("return_2y", { precision: 10, scale: 4 }), // 近2年收益
    return3y: decimal("return_3y", { precision: 10, scale: 4 }), // 近3年收益
    return5y: decimal("return_5y", { precision: 10, scale: 4 }), // 近5年收益
    returnThisYear: decimal("return_this_year", { precision: 10, scale: 4 }), // 今年以来
    returnSinceInception: decimal("return_since_inception", {
      precision: 10,
      scale: 4,
    }), // 成立以来
    annualizedReturn: decimal("annualized_return", { precision: 10, scale: 4 }), // 年化收益
    annualizedVolatility: decimal("annualized_volatility", {
      precision: 10,
      scale: 4,
    }), // 年化波动率
    sharpeRatio: decimal("sharpe_ratio", { precision: 10, scale: 4 }), // 夏普比率
    maxDrawdown: decimal("max_drawdown", { precision: 10, scale: 4 }), // 最大回撤
    calmarRatio: decimal("calmar_ratio", { precision: 10, scale: 4 }), // 卡玛比率
    sortinoRatio: decimal("sortino_ratio", { precision: 10, scale: 4 }), // 索提诺比率
    informationRatio: decimal("information_ratio", { precision: 10, scale: 4 }), // 信息比率
    alpha: decimal("alpha", { precision: 10, scale: 4 }), // 阿尔法系数
    beta: decimal("beta", { precision: 10, scale: 4 }), // 贝塔系数
    winRate: decimal("win_rate", { precision: 6, scale: 4 }), // 日正收益胜率
    recoveryPeriod: int("recovery_period"), // 最长回撤修复周期(天)
    jensenAlpha: decimal("jensen_alpha", { precision: 10, scale: 4 }), // 詹森阿尔法
    treynorRatio: decimal("treynor_ratio", { precision: 10, scale: 4 }), // 特雷诺比率
    downsideDeviation: decimal("downside_deviation", {
      precision: 10,
      scale: 4,
    }), // 下行标准差
    var95: decimal("var_95", { precision: 10, scale: 4 }), // 95%置信度VaR
    trackingError: decimal("tracking_error", { precision: 10, scale: 4 }), // 跟踪误差
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_perf_fund").on(table.fundId)]
);

export type FundPerformance = typeof fundPerformance.$inferSelect;

// ==================== 基金净值历史表 ====================
export const fundNavHistory = mysqlTable(
  "fund_nav_history",
  {
    id: serial("id").primaryKey(),
    fundId: bigint("fund_id", { mode: "number", unsigned: true }).notNull(),
    navDate: date("nav_date").notNull(),
    nav: decimal("nav", { precision: 10, scale: 4 }).notNull(),
    accumNav: decimal("accum_nav", { precision: 10, scale: 4 }),
    dailyReturn: decimal("daily_return", { precision: 8, scale: 4 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_nav_fund_date").on(table.fundId, table.navDate),
    index("idx_nav_date").on(table.navDate),
  ]
);

export type FundNavHistory = typeof fundNavHistory.$inferSelect;

// ==================== 基金持仓表(重仓股/债券) ====================
export const fundHoldings = mysqlTable(
  "fund_holdings",
  {
    id: serial("id").primaryKey(),
    fundId: bigint("fund_id", { mode: "number", unsigned: true }).notNull(),
    stockCode: varchar("stock_code", { length: 20 }).notNull(),
    stockName: varchar("stock_name", { length: 100 }).notNull(),
    industry: varchar("industry", { length: 100 }), // 所属行业
    ratio: decimal("ratio", { precision: 8, scale: 4 }), // 占净值比
    changeRatio: decimal("change_ratio", { precision: 8, scale: 4 }), // 较上季度变动
    quarter: varchar("quarter", { length: 10 }).notNull(), // 报告期如"2024Q3"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_holding_fund").on(table.fundId),
    index("idx_holding_industry").on(table.industry),
  ]
);

export type FundHolding = typeof fundHoldings.$inferSelect;

// ==================== 行业配置表 ====================
export const industryAllocation = mysqlTable(
  "industry_allocation",
  {
    id: serial("id").primaryKey(),
    fundId: bigint("fund_id", { mode: "number", unsigned: true }).notNull(),
    industry: varchar("industry", { length: 100 }).notNull(),
    ratio: decimal("ratio", { precision: 8, scale: 4 }).notNull(), // 占比
    changeRatio: decimal("change_ratio", { precision: 8, scale: 4 }),
    quarter: varchar("quarter", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_alloc_fund").on(table.fundId),
    index("idx_alloc_industry").on(table.industry),
  ]
);

export type IndustryAllocation = typeof industryAllocation.$inferSelect;

// ==================== 回测记录表 ====================
export const backtestRecords = mysqlTable(
  "backtest_records",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    type: mysqlEnum("type", ["single", "portfolio"]).notNull(), // 单只或组合
    fundIds: json("fund_ids").notNull(), // 基金ID数组
    weights: json("weights"), // 权重数组(组合回测)
    strategy: mysqlEnum("strategy", [
      "fixed_amount", // 固定金额定投
      "fixed_ratio", // 固定比例定投
      "value_averaging", // 价值平均定投
      "smart_beta", // 智能Beta定投
      "martingale", // 马丁格尔定投
    ]).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    investAmount: decimal("invest_amount", { precision: 15, scale: 2 }), // 单次投入金额
    investFrequency: mysqlEnum("invest_frequency", [
      "weekly",
      "biweekly",
      "monthly",
    ]), // 定投频率
    totalInvested: decimal("total_invested", { precision: 15, scale: 2 }), // 总投入
    finalValue: decimal("final_value", { precision: 15, scale: 2 }), // 最终价值
    totalReturn: decimal("total_return", { precision: 10, scale: 4 }), // 总收益率
    annualizedReturn: decimal("annualized_return", { precision: 10, scale: 4 }), // 年化收益
    maxDrawdown: decimal("max_drawdown", { precision: 10, scale: 4 }), // 最大回撤
    sharpeRatio: decimal("sharpe_ratio", { precision: 10, scale: 4 }),
    benchmarkReturn: decimal("benchmark_return", { precision: 10, scale: 4 }), // 基准收益
    excessReturn: decimal("excess_return", { precision: 10, scale: 4 }), // 超额收益
    monthlyData: json("monthly_data"), // 月度数据序列
    userId: varchar("user_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("idx_bt_user").on(table.userId)]
);

export type BacktestRecord = typeof backtestRecords.$inferSelect;

// ==================== 基金推荐配置表 ====================
export const fundRecommendations = mysqlTable(
  "fund_recommendations",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    riskProfile: mysqlEnum("risk_profile", [
      "conservative",
      "moderate",
      "balanced",
      "growth",
      "aggressive",
    ]).notNull(), // 风险偏好
    fundAllocations: json("fund_allocations").notNull(), // [{fundId, weight, reason}]
    marketCondition: varchar("market_condition", { length: 255 }), // 适用市场环境
    expectedReturn: decimal("expected_return", { precision: 10, scale: 4 }),
    expectedRisk: decimal("expected_risk", { precision: 10, scale: 4 }),
    rationale: text("rationale"), // 推荐理由(LLM生成)
    isAiGenerated: int("is_ai_generated").default(0),
    tags: json("tags"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("idx_rec_risk").on(table.riskProfile)]
);

export type FundRecommendation = typeof fundRecommendations.$inferSelect;

// ==================== 用户偏好表 ====================
export const userPreferences = mysqlTable(
  "user_preferences",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull().unique(),
    riskTolerance: mysqlEnum("risk_tolerance", [
      "conservative",
      "moderate",
      "balanced",
      "growth",
      "aggressive",
    ]).default("moderate"),
    preferredTypes: json("preferred_types"), // 偏好基金类型
    preferredIndustries: json("preferred_industries"), // 偏好行业
    investHorizon: mysqlEnum("invest_horizon", [
      "short", // <1年
      "medium", // 1-3年
      "long", // 3-5年
      "very_long", // >5年
    ]).default("medium"),
    investAmount: decimal("invest_amount", { precision: 15, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_pref_user").on(table.userId)]
);

export type UserPreference = typeof userPreferences.$inferSelect;

// ==================== 基金收藏表 ====================
export const fundFavorites = mysqlTable(
  "fund_favorites",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    fundId: bigint("fund_id", { mode: "number", unsigned: true }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_fav_user").on(table.userId),
    index("idx_fav_fund").on(table.fundId),
  ]
);

export type FundFavorite = typeof fundFavorites.$inferSelect;
