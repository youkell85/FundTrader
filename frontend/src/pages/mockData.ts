import type { AllocationResponse } from "@/types/allocation";

export const MOCK_DATA: AllocationResponse = {
  "meta": {
    "engine_version": "3.0.0",
    "generated_at": "2026-06-12T14:30:00",
    "regime": "goldilocks",
    "regime_label": "金发女孩",
    "regime_pending": null,
    "regime_pending_count": 0,
    "regime_is_confirmed": true,
    "taa_skipped": false,
    "circuit_breaker_triggered": false
  },
  "user_profile": {
    "risk_tolerance": "balanced",
    "risk_label": "平衡型",
    "effective_risk": "balanced",
    "behavior_adjusted": false,
    "age": 40,
    "amount": 1000000,
    "horizon": "medium"
  },
  "saa": {
    "allocations": {
      "a_share_large": 10.5,
      "a_share_small": 2.0,
      "a_share_value": 6.8,
      "a_share_growth": 8.2,
      "hk_equity": 5.6,
      "us_equity": 4.5,
      "rate_bond": 12.0,
      "credit_bond": 15.0,
      "convertible": 5.0,
      "money_fund": 10.0,
      "gold": 7.5,
      "commodity": 4.0,
      "reits": 5.0,
      "cash": 3.9
    },
    "group_allocations": {
      "equity": 37.6,
      "fixed_income": 32.0,
      "alternative": 16.5,
      "cash_equiv": 13.9
    },
    "equity_center": 37.6,
    "expected_return": 7.2,
    "expected_volatility": 11.8,
    "expected_max_drawdown": 20.5,
    "sharpe_ratio": 0.44,
    "glide_path_applied": false,
    "risk_contributions": {
      "a_share_large": 18.2,
      "a_share_value": 10.5,
      "a_share_growth": 15.3,
      "hk_equity": 9.8,
      "us_equity": 6.5,
      "rate_bond": 8.0,
      "credit_bond": 9.5,
      "convertible": 5.2,
      "gold": 7.0,
      "reits": 4.5,
      "commodity": 3.5,
      "cash": 2.0
    }
  },
  "taa": {
    "taa_adjusted": {

    },
    "adjustments": {

    },
    "composite_score": 0.35,
    "equity_adjustment": 5.2,
    "fed_value": 2.8,
    "fed_interpretation": "美联储模型=2.8，权益相对低估",
    "signals": [
      { "factor_name": "PMI制造业", "category": "growth", "score": 0.65, "confidence": "high", "value": 50.8, "threshold_desc": "当前值: 50.80" },
      { "factor_name": "GDP同比", "category": "growth", "score": 0.40, "confidence": "high", "value": 5.1, "threshold_desc": "当前值: 5.10" },
      { "factor_name": "CPI同比", "category": "inflation", "score": -0.30, "confidence": "high", "value": 2.3, "threshold_desc": "当前值: 2.30" },
      { "factor_name": "PPI同比", "category": "inflation", "score": 0.20, "confidence": "medium", "value": 0.5, "threshold_desc": "当前值: 0.50" },
      { "factor_name": "10Y国债收益率", "category": "interest", "score": 0.50, "confidence": "high", "value": 2.72, "threshold_desc": "当前值: 2.72" },
      { "factor_name": "DR007", "category": "interest", "score": 0.80, "confidence": "high", "value": 1.90, "threshold_desc": "当前值: 1.90" },
      { "factor_name": "社融增速", "category": "credit_money", "score": -0.60, "confidence": "medium", "value": 5.2, "threshold_desc": "当前值: 5.20" },
      { "factor_name": "M2增速", "category": "credit_money", "score": 0.70, "confidence": "high", "value": 9.8, "threshold_desc": "当前值: 9.80" },
      { "factor_name": "融资余额变化", "category": "liquidity", "score": 0.35, "confidence": "medium", "value": 70.0, "threshold_desc": "当前值: 70.00" },
      { "factor_name": "北向资金净流入", "category": "liquidity", "score": 0.55, "confidence": "high", "value": 58.0, "threshold_desc": "当前值: 58.00" },
      { "factor_name": "财政赤字率", "category": "policy", "score": 0.80, "confidence": "high", "value": 3.3, "threshold_desc": "当前值: 3.30" },
      { "factor_name": "美联储利率", "category": "overseas", "score": -0.45, "confidence": "high", "value": 4.75, "threshold_desc": "当前值: 4.75" },
      { "factor_name": "美元指数", "category": "overseas", "score": -0.20, "confidence": "medium", "value": 101.5, "threshold_desc": "当前值: 101.50" }
    ],
    "category_summary": {
      "growth": { "name": "经济增长", "weight": 0.20, "avg_score": 0.53, "interpretation": "偏多", "signal_count": 2 },
      "inflation": { "name": "通胀水平", "weight": 0.15, "avg_score": -0.05, "interpretation": "中性", "signal_count": 2 },
      "interest": { "name": "利率环境", "weight": 0.15, "avg_score": 0.65, "interpretation": "偏多", "signal_count": 2 },
      "credit_money": { "name": "信用/货币", "weight": 0.15, "avg_score": 0.05, "interpretation": "中性", "signal_count": 2 },
      "liquidity": { "name": "市场流动性", "weight": 0.15, "avg_score": 0.45, "interpretation": "偏多", "signal_count": 2 },
      "policy": { "name": "政策导向", "weight": 0.10, "avg_score": 0.80, "interpretation": "偏多", "signal_count": 1 },
      "overseas": { "name": "海外环境", "weight": 0.10, "avg_score": -0.33, "interpretation": "偏空", "signal_count": 2 }
    },
    "business_cycle": {
      "phase": "recovery",
      "phase_name": "复苏",
      "preferred_style": "growth",
      "preferred_industries": [
        "科技",
        "新能源",
        "消费电子"
      ],
      "bond_duration": "medium"
    }
  },
  "funds": [
    {
      "code": "510300",
      "name": "华泰柏瑞沪深300ETF",
      "type": "ETF",
      "asset_class": "a_share_large",
      "company": "华泰柏瑞基金",
      "weight": 12.0,
      "amount": 120000,
      "role": "权益核心",
      "reason": "低费率透明；规模1200亿",
      "score": 85
    },
    {
      "code": "159915",
      "name": "易方达创业板ETF",
      "type": "ETF",
      "asset_class": "a_share_growth",
      "company": "易方达基金",
      "weight": 9.5,
      "amount": 95000,
      "role": "收益增强",
      "reason": "匹配A股成长",
      "score": 78
    },
    {
      "code": "515180",
      "name": "易方达中证红利ETF",
      "type": "ETF",
      "asset_class": "a_share_value",
      "company": "易方达基金",
      "weight": 7.0,
      "amount": 70000,
      "role": "权益核心",
      "reason": "夏普0.6",
      "score": 82
    },
    {
      "code": "513500",
      "name": "博时标普500ETF",
      "type": "QDII",
      "asset_class": "us_equity",
      "company": "博时基金",
      "weight": 4.5,
      "amount": 45000,
      "role": "分散卫星",
      "reason": "匹配美股QDII",
      "score": 75
    },
    {
      "code": "511010",
      "name": "国泰上证5年期国债ETF",
      "type": "ETF",
      "asset_class": "rate_bond",
      "company": "国泰基金",
      "weight": 11.0,
      "amount": 110000,
      "role": "防守底仓",
      "reason": "匹配利率债",
      "score": 80
    },
    {
      "code": "511030",
      "name": "平安中高等级公司债ETF",
      "type": "ETF",
      "asset_class": "credit_bond",
      "company": "平安基金",
      "weight": 13.5,
      "amount": 135000,
      "role": "防守底仓",
      "reason": "匹配信用债",
      "score": 83
    },
    {
      "code": "518880",
      "name": "华安黄金ETF",
      "type": "ETF",
      "asset_class": "gold",
      "company": "华安基金",
      "weight": 7.5,
      "amount": 75000,
      "role": "分散卫星",
      "reason": "匹配黄金ETF",
      "score": 70
    },
    {
      "code": "000198",
      "name": "天弘余额宝货币",
      "type": "货币型",
      "asset_class": "money_fund",
      "company": "天弘基金",
      "weight": 9.0,
      "amount": 90000,
      "role": "流动性储备",
      "reason": "规模7000亿",
      "score": 90
    }
  ],
  "portfolio_metrics": {
    "expected_return": 7.2,
    "volatility": 11.8,
    "max_drawdown": 20.5,
    "sharpe": 0.44,
    "calmar": 0.35,
    "fund_count": 8
  },
  "stress_tests": [
    {
      "scenario": "2015股灾",
      "impact": -20.5,
      "max_loss": 205000
    },
    {
      "scenario": "2018贸易摩擦",
      "impact": -14.2,
      "max_loss": 142000
    },
    {
      "scenario": "2020疫情冲击",
      "impact": -9.8,
      "max_loss": 98000
    },
    {
      "scenario": "2022股债双杀",
      "impact": -16.5,
      "max_loss": 165000
    },
    {
      "scenario": "2024政策利好",
      "impact": 13.8,
      "max_loss": 0
    },
    {
      "scenario": "QDII通道冻结",
      "impact": -4.5,
      "max_loss": 45000
    }
  ],
  "monte_carlo": {
    "median_return": 35.2,
    "percentile_10": -8.5,
    "percentile_25": 8.0,
    "percentile_75": 58.5,
    "percentile_90": 72.0,
    "max_drawdown_95": -38.0,
    "var_95": -15.2,
    "cvar_95": -22.8,
    "prob_positive": 85.5
  },
  "scenario_analysis": {
    "weighted_return": 5.8,
    "scenarios": [
      {
        "scenario": "optimistic",
        "description": "经济复苏",
        "probability": 0.25,
        "impact": 12.5
      },
      {
        "scenario": "baseline",
        "description": "趋势延续",
        "probability": 0.5,
        "impact": 7.2
      },
      {
        "scenario": "pessimistic",
        "description": "滞胀",
        "probability": 0.25,
        "impact": -3.5
      }
    ]
  },
  "factor_exposures": {
    "equity_beta": 0.42,
    "term_premium": 0.15,
    "credit_premium": 0.22,
    "inflation": 0.08,
    "liquidity": 0.12
  },
  "constraints": [
    {
      "rule": "权益总上限",
      "value": "42.0%",
      "limit": "<=80%",
      "passed": true
    },
    {
      "rule": "海外资产上限",
      "value": "10.5%",
      "limit": "<=20%",
      "passed": true
    },
    {
      "rule": "流动性下限",
      "value": "13.0%",
      "limit": ">=10%",
      "passed": true
    },
    {
      "rule": "权重总和",
      "value": "100.0%",
      "limit": "100%",
      "passed": true
    },
    {
      "rule": "单只基金上限",
      "value": "13.5%",
      "limit": "<=20%",
      "passed": true
    }
  ],
  "risk_disclaimer": "本方案由量化模型生成，不构成投资建议。QDII产品涉及汇率风险。基金有风险，投资需谨慎。",
  "warnings": [

  ]
};
