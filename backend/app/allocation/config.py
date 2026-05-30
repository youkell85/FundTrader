"""Asset allocation configuration — asset classes, groups, and static parameters."""
from typing import Dict, List

# ─── 14 Asset Classes (matching frontend keys exactly) ───
ASSET_CLASSES: List[str] = [
    "a_share_large", "a_share_small", "a_share_value", "a_share_growth",
    "hk_equity", "us_equity",
    "rate_bond", "credit_bond", "convertible",
    "money_fund",
    "gold", "commodity", "reits",
    "cash",
]

N_ASSETS = len(ASSET_CLASSES)
ASSET_INDEX: Dict[str, int] = {a: i for i, a in enumerate(ASSET_CLASSES)}

# ─── Group Mapping ───
GROUP_MAP: Dict[str, List[str]] = {
    "equity": ["a_share_large", "a_share_small", "a_share_value", "a_share_growth", "hk_equity", "us_equity"],
    "fixed_income": ["rate_bond", "credit_bond", "convertible"],
    "alternative": ["gold", "commodity", "reits"],
    "cash_equiv": ["money_fund", "cash"],
}

ASSET_TO_GROUP: Dict[str, str] = {}
for grp, assets in GROUP_MAP.items():
    for a in assets:
        ASSET_TO_GROUP[a] = grp

# ─── Risk Profile Templates ───
# equity_center: target equity allocation (%)
# max_drawdown: maximum acceptable drawdown (%)
# volatility_target: annualized portfolio vol target (%)
RISK_PROFILES: Dict[str, Dict] = {
    "conservative": {"equity_center": 15, "max_drawdown": 8, "volatility_target": 5},
    "moderate": {"equity_center": 30, "max_drawdown": 15, "volatility_target": 8},
    "balanced": {"equity_center": 45, "max_drawdown": 22, "volatility_target": 12},
    "aggressive": {"equity_center": 65, "max_drawdown": 30, "volatility_target": 16},
    "radical": {"equity_center": 80, "max_drawdown": 40, "volatility_target": 20},
}

# ─── Equilibrium Expected Returns (annualized, %) ───
EQUILIBRIUM_RETURNS: Dict[str, float] = {
    "a_share_large": 8.5,
    "a_share_small": 10.0,
    "a_share_value": 8.0,
    "a_share_growth": 11.0,
    "hk_equity": 9.0,
    "us_equity": 9.5,
    "rate_bond": 3.2,
    "credit_bond": 4.0,
    "convertible": 6.0,
    "money_fund": 2.0,
    "gold": 4.5,
    "commodity": 3.5,
    "reits": 6.5,
    "cash": 1.5,
}

# ─── Equilibrium Volatilities (annualized, %) ───
EQUILIBRIUM_VOLS: Dict[str, float] = {
    "a_share_large": 22.0,
    "a_share_small": 28.0,
    "a_share_value": 20.0,
    "a_share_growth": 30.0,
    "hk_equity": 24.0,
    "us_equity": 18.0,
    "rate_bond": 3.5,
    "credit_bond": 5.0,
    "convertible": 15.0,
    "money_fund": 0.5,
    "gold": 16.0,
    "commodity": 20.0,
    "reits": 18.0,
    "cash": 0.3,
}

# ─── Default Correlation Matrix (14×14) ───
# Order: a_share_large, a_share_small, a_share_value, a_share_growth, hk_equity, us_equity,
#         rate_bond, credit_bond, convertible, money_fund, gold, commodity, reits, cash
DEFAULT_CORR: List[List[float]] = [
    # large  small  value  growth hk     us     rate   credit conv   money  gold   comm   reits  cash
    [ 1.00,  0.90,  0.92,  0.88,  0.65,  0.40,  -0.10, 0.05,  0.60,  0.00,  0.05,  0.10,  0.25,  0.00],  # large
    [ 0.90,  1.00,  0.82,  0.93,  0.60,  0.35,  -0.12, 0.03,  0.65,  0.00,  0.03,  0.12,  0.22,  0.00],  # small
    [ 0.92,  0.82,  1.00,  0.78,  0.62,  0.38,  -0.08, 0.06,  0.55,  0.00,  0.06,  0.08,  0.28,  0.00],  # value
    [ 0.88,  0.93,  0.78,  1.00,  0.58,  0.42,  -0.15, 0.02,  0.68,  0.00,  0.02,  0.15,  0.20,  0.00],  # growth
    [ 0.65,  0.60,  0.62,  0.58,  1.00,  0.55,  -0.05, 0.08,  0.45,  0.00,  0.10,  0.15,  0.30,  0.00],  # hk
    [ 0.40,  0.35,  0.38,  0.42,  0.55,  1.00,   0.00, 0.10,  0.30,  0.00,  0.05,  0.20,  0.35,  0.00],  # us
    [-0.10, -0.12, -0.08, -0.15, -0.05,  0.00,   1.00, 0.70,  0.10,  0.30, -0.05, -0.10,  0.05,  0.20],  # rate
    [ 0.05,  0.03,  0.06,  0.02,  0.08,  0.10,   0.70, 1.00,  0.25,  0.20,  0.00,  0.00,  0.15,  0.15],  # credit
    [ 0.60,  0.65,  0.55,  0.68,  0.45,  0.30,   0.10, 0.25,  1.00,  0.05,  0.05,  0.10,  0.20,  0.00],  # conv
    [ 0.00,  0.00,  0.00,  0.00,  0.00,  0.00,   0.30, 0.20,  0.05,  1.00,  0.00,  0.00,  0.00,  0.50],  # money
    [ 0.05,  0.03,  0.06,  0.02,  0.10,  0.05,  -0.05, 0.00,  0.05,  0.00,  1.00,  0.30,  0.10,  0.00],  # gold
    [ 0.10,  0.12,  0.08,  0.15,  0.15,  0.20,  -0.10, 0.00,  0.10,  0.00,  0.30,  1.00,  0.15,  0.00],  # comm
    [ 0.25,  0.22,  0.28,  0.20,  0.30,  0.35,   0.05, 0.15,  0.20,  0.00,  0.10,  0.15,  1.00,  0.00],  # reits
    [ 0.00,  0.00,  0.00,  0.00,  0.00,  0.00,   0.20, 0.15,  0.00,  0.50,  0.00,  0.00,  0.00,  1.00],  # cash
]

# ─── Asset Bounds (min, max) per asset class ───
ASSET_BOUNDS: Dict[str, tuple] = {
    "a_share_large": (0.0, 0.35),
    "a_share_small": (0.0, 0.20),
    "a_share_value": (0.0, 0.25),
    "a_share_growth": (0.0, 0.20),
    "hk_equity": (0.0, 0.20),
    "us_equity": (0.0, 0.30),
    "rate_bond": (0.0, 0.50),
    "credit_bond": (0.0, 0.40),
    "convertible": (0.0, 0.20),
    "money_fund": (0.0, 0.50),
    "gold": (0.0, 0.15),
    "commodity": (0.0, 0.10),
    "reits": (0.0, 0.15),
    "cash": (0.0, 0.30),
}

# ─── Constraint Limits ───
QDII_LIMIT = 0.30       # us_equity max
HK_LIMIT = 0.20         # hk_equity max
SINGLE_ASSET_LIMIT = 0.35
CASH_FLOOR = 0.05       # money_fund + cash minimum
SUM_TOLERANCE = 0.001   # sum-to-one tolerance

# ─── Stress Scenarios (per-asset drawdown vectors, %) ───
STRESS_SCENARIOS: Dict[str, Dict[str, float]] = {
    "2008 全球金融危机": {
        "a_share_large": -65, "a_share_small": -70, "a_share_value": -60,
        "a_share_growth": -72, "hk_equity": -55, "us_equity": -50,
        "rate_bond": 5, "credit_bond": -8, "convertible": -35,
        "money_fund": 1, "gold": 5, "commodity": -40, "reits": -45, "cash": 0.5,
    },
    "2015 A股股灾": {
        "a_share_large": -45, "a_share_small": -55, "a_share_value": -40,
        "a_share_growth": -60, "hk_equity": -20, "us_equity": -5,
        "rate_bond": 3, "credit_bond": -2, "convertible": -25,
        "money_fund": 1, "gold": 2, "commodity": -10, "reits": -8, "cash": 0.5,
    },
    "2018 中美贸易战": {
        "a_share_large": -30, "a_share_small": -35, "a_share_value": -25,
        "a_share_growth": -38, "hk_equity": -18, "us_equity": -15,
        "rate_bond": 4, "credit_bond": -5, "convertible": -15,
        "money_fund": 1, "gold": 3, "commodity": -12, "reits": -10, "cash": 0.5,
    },
    "2020 新冠疫情": {
        "a_share_large": -15, "a_share_small": -20, "a_share_value": -18,
        "a_share_growth": -12, "hk_equity": -22, "us_equity": -34,
        "rate_bond": 3, "credit_bond": -3, "convertible": -8,
        "money_fund": 1, "gold": 8, "commodity": -25, "reits": -20, "cash": 0.5,
    },
    "2022 股债双杀": {
        "a_share_large": -25, "a_share_small": -30, "a_share_value": -20,
        "a_share_growth": -35, "hk_equity": -28, "us_equity": -20,
        "rate_bond": -2, "credit_bond": -8, "convertible": -18,
        "money_fund": 1, "gold": -3, "commodity": 15, "reits": -12, "cash": 0.5,
    },
    "QDII通道冻结": {
        "a_share_large": -5, "a_share_small": -5, "a_share_value": -5,
        "a_share_growth": -5, "hk_equity": -15, "us_equity": -25,
        "rate_bond": 1, "credit_bond": 0, "convertible": -3,
        "money_fund": 1, "gold": 5, "commodity": -5, "reits": -8, "cash": 0.5,
    },
}

# ─── Factor Loadings per Asset Class ───
# Factors: equity_beta, term_premium, credit_premium, inflation, liquidity
FACTOR_LOADINGS: Dict[str, Dict[str, float]] = {
    "a_share_large": {"equity_beta": 1.0, "term_premium": -0.1, "credit_premium": 0.0, "inflation": 0.1, "liquidity": 0.0},
    "a_share_small": {"equity_beta": 1.3, "term_premium": -0.1, "credit_premium": 0.0, "inflation": 0.1, "liquidity": -0.2},
    "a_share_value": {"equity_beta": 0.8, "term_premium": 0.0, "credit_premium": 0.1, "inflation": 0.2, "liquidity": 0.0},
    "a_share_growth": {"equity_beta": 1.4, "term_premium": -0.2, "credit_premium": 0.0, "inflation": -0.1, "liquidity": -0.2},
    "hk_equity": {"equity_beta": 0.9, "term_premium": -0.1, "credit_premium": 0.0, "inflation": 0.1, "liquidity": -0.1},
    "us_equity": {"equity_beta": 0.7, "term_premium": 0.0, "credit_premium": 0.0, "inflation": 0.0, "liquidity": 0.1},
    "rate_bond": {"equity_beta": -0.1, "term_premium": 1.0, "credit_premium": 0.0, "inflation": -0.3, "liquidity": 0.2},
    "credit_bond": {"equity_beta": 0.1, "term_premium": 0.7, "credit_premium": 1.0, "inflation": -0.2, "liquidity": 0.0},
    "convertible": {"equity_beta": 0.6, "term_premium": 0.2, "credit_premium": 0.5, "inflation": 0.0, "liquidity": -0.1},
    "money_fund": {"equity_beta": 0.0, "term_premium": 0.1, "credit_premium": 0.0, "inflation": 0.0, "liquidity": 1.0},
    "gold": {"equity_beta": 0.0, "term_premium": -0.1, "credit_premium": 0.0, "inflation": 0.8, "liquidity": 0.1},
    "commodity": {"equity_beta": 0.2, "term_premium": -0.1, "credit_premium": 0.0, "inflation": 0.7, "liquidity": -0.1},
    "reits": {"equity_beta": 0.5, "term_premium": 0.3, "credit_premium": 0.2, "inflation": 0.3, "liquidity": -0.2},
    "cash": {"equity_beta": 0.0, "term_premium": 0.0, "credit_premium": 0.0, "inflation": -0.1, "liquidity": 1.0},
}

# ─── Conservative Fallback Template (L5, by risk level) ───
FALLBACK_TEMPLATES: Dict[str, Dict[str, float]] = {
    "conservative": {
        "a_share_large": 0.05, "a_share_small": 0.0, "a_share_value": 0.03, "a_share_growth": 0.0,
        "hk_equity": 0.02, "us_equity": 0.02,
        "rate_bond": 0.30, "credit_bond": 0.20, "convertible": 0.03,
        "money_fund": 0.20, "gold": 0.05, "commodity": 0.0, "reits": 0.03, "cash": 0.07,
    },
    "moderate": {
        "a_share_large": 0.10, "a_share_small": 0.03, "a_share_value": 0.05, "a_share_growth": 0.02,
        "hk_equity": 0.04, "us_equity": 0.04,
        "rate_bond": 0.22, "credit_bond": 0.18, "convertible": 0.05,
        "money_fund": 0.12, "gold": 0.06, "commodity": 0.02, "reits": 0.04, "cash": 0.03,
    },
    "balanced": {
        "a_share_large": 0.15, "a_share_small": 0.06, "a_share_value": 0.07, "a_share_growth": 0.05,
        "hk_equity": 0.06, "us_equity": 0.06,
        "rate_bond": 0.15, "credit_bond": 0.12, "convertible": 0.06,
        "money_fund": 0.08, "gold": 0.06, "commodity": 0.02, "reits": 0.04, "cash": 0.02,
    },
    "aggressive": {
        "a_share_large": 0.20, "a_share_small": 0.10, "a_share_value": 0.08, "a_share_growth": 0.10,
        "hk_equity": 0.08, "us_equity": 0.08,
        "rate_bond": 0.08, "credit_bond": 0.08, "convertible": 0.06,
        "money_fund": 0.05, "gold": 0.04, "commodity": 0.02, "reits": 0.03, "cash": 0.0,
    },
    "radical": {
        "a_share_large": 0.22, "a_share_small": 0.15, "a_share_value": 0.08, "a_share_growth": 0.15,
        "hk_equity": 0.10, "us_equity": 0.10,
        "rate_bond": 0.03, "credit_bond": 0.03, "convertible": 0.05,
        "money_fund": 0.03, "gold": 0.03, "commodity": 0.01, "reits": 0.02, "cash": 0.0,
    },
}

# ─── Risk Budget Templates (target risk contribution per group) ───
RISK_BUDGETS: Dict[str, Dict[str, float]] = {
    "conservative": {"equity": 0.40, "fixed_income": 0.30, "alternative": 0.15, "cash_equiv": 0.15},
    "moderate": {"equity": 0.55, "fixed_income": 0.25, "alternative": 0.12, "cash_equiv": 0.08},
    "balanced": {"equity": 0.65, "fixed_income": 0.20, "alternative": 0.10, "cash_equiv": 0.05},
    "aggressive": {"equity": 0.75, "fixed_income": 0.13, "alternative": 0.08, "cash_equiv": 0.04},
    "radical": {"equity": 0.85, "fixed_income": 0.08, "alternative": 0.05, "cash_equiv": 0.02},
}

# ─── Fund Asset Class Mapping (ETF/fund code → asset class) ───
FUND_ASSET_MAP: Dict[str, str] = {
    # A股大盘
    "510300": "a_share_large", "510050": "a_share_large", "159919": "a_share_large",
    "510500": "a_share_large", "159922": "a_share_large",
    # A股小盘
    "159915": "a_share_small", "159949": "a_share_small", "512100": "a_share_small",
    # A股价值
    "515180": "a_share_value", "510880": "a_share_value", "512380": "a_share_value",
    # A股成长
    "159995": "a_share_growth", "512760": "a_share_growth", "515050": "a_share_growth",
    # 港股
    "513050": "hk_equity", "159920": "hk_equity", "513060": "hk_equity",
    # 美股QDII
    "513500": "us_equity", "160213": "us_equity", "513100": "us_equity",
    # 利率债
    "511010": "rate_bond", "511260": "rate_bond",
    # 信用债
    "511030": "credit_bond", "511020": "credit_bond",
    # 可转债
    "511380": "convertible", "123120": "convertible",
    # 货币基金
    "000198": "money_fund", "511880": "money_fund", "003003": "money_fund",
    # 黄金
    "518880": "gold", "159934": "gold",
    # 商品
    "161815": "commodity", "165513": "commodity",
    # REITs
    "508000": "reits", "508027": "reits", "180101": "reits",
}

# ─── Horizon Mapping (frontend key → months) ───
HORIZON_MONTHS: Dict[str, int] = {
    "short": 12,
    "medium": 36,
    "long": 60,
    "very_long": 120,
}
