"""多数据源统一适配器基类"""
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class FundBasic:
    """基金基础信息"""
    code: str
    name: str = ""
    type: str = ""
    management: str = ""
    custodian: str = ""
    manager: str = ""
    found_date: str = ""
    benchmark: str = ""
    status: str = ""
    fund_share: Optional[float] = None  # 最新份额规模（万份）


@dataclass
class FundNav:
    """基金净值数据"""
    date: str
    nav: Optional[float] = None
    accum_nav: Optional[float] = None
    adj_nav: Optional[float] = None
    day_growth: Optional[float] = None


@dataclass
class FundHolding:
    """基金持仓"""
    name: str = ""
    code: str = ""
    ratio: float = 0.0
    industry: str = ""


@dataclass
class FundPerformance:
    """基金业绩指标"""
    near_1m: Optional[float] = None
    near_3m: Optional[float] = None
    near_6m: Optional[float] = None
    near_1y: Optional[float] = None
    near_3y: Optional[float] = None
    ytd: Optional[float] = None
    since_inception: Optional[float] = None


@dataclass
class FundRisk:
    """基金风险指标"""
    volatility: Optional[float] = None
    sharpe: Optional[float] = None
    max_drawdown: Optional[float] = None
    calmar: Optional[float] = None
    sortino: Optional[float] = None
    alpha: Optional[float] = None
    beta: Optional[float] = None
    info_ratio: Optional[float] = None
    win_rate: Optional[float] = None


@dataclass
class FundDetail:
    """基金详情聚合数据"""
    code: str
    name: str = ""
    type: str = ""
    nav: Optional[float] = None
    nav_date: str = ""
    day_growth: Optional[float] = None
    basic: Optional[FundBasic] = None
    performance: Optional[FundPerformance] = None
    risk: Optional[FundRisk] = None
    holdings: List[FundHolding] = field(default_factory=list)
    nav_history: List[FundNav] = field(default_factory=list)
    manager_info: Dict[str, Any] = field(default_factory=dict)
    industry_dist: Dict[str, float] = field(default_factory=dict)
    rating: Optional[int] = None  # 基金评级（晨星等，1-5星）
    source: str = ""  # 数据来源标识


class DataProvider(ABC):
    """数据源适配器基类"""

    name: str = "base"
    priority: int = 0  # 优先级，数值越大优先级越高

    @abstractmethod
    def is_available(self) -> bool:
        """检查数据源是否可用"""
        pass

    @abstractmethod
    def get_fund_list(self, market: str = "O") -> List[FundBasic]:
        """获取基金列表"""
        pass

    @abstractmethod
    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        """获取基金详情"""
        pass

    @abstractmethod
    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        """获取基金净值历史"""
        pass

    @abstractmethod
    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        """获取基金持仓"""
        pass

    def _safe_float(self, val) -> Optional[float]:
        """安全转换为float"""
        if val is None:
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    def _parse_date(self, date_str: str) -> str:
        """标准化日期格式为 YYYY-MM-DD"""
        if not date_str:
            return ""
        date_str = str(date_str).strip()
        # 处理 YYYYMMDD
        if len(date_str) == 8 and date_str.isdigit():
            return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
        # 处理 YYYY-MM-DD
        if len(date_str) == 10 and date_str[4] == '-' and date_str[7] == '-':
            return date_str
        return date_str