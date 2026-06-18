"""基金数据模型"""
from pydantic import BaseModel
from typing import Optional, List, Dict


class FundBasic(BaseModel):
    """基金基本信息"""
    code: str
    name: str
    type: str = ""
    nav: Optional[float] = None
    nav_date: Optional[str] = None
    day_growth: Optional[float] = None
    tags: List[str] = []


class FundRanking(BaseModel):
    """基金排名信息"""
    code: str
    name: str
    type: str = ""
    nav: Optional[float] = None
    day_growth: Optional[float] = None
    near_1m: Optional[float] = None
    near_3m: Optional[float] = None
    near_6m: Optional[float] = None
    near_1y: Optional[float] = None
    near_3y: Optional[float] = None
    ytd: Optional[float] = None
    tags: List[str] = []


class FundDetail(BaseModel):
    """基金详情"""
    code: str
    name: str
    type: str = ""
    nav: Optional[float] = None
    nav_date: Optional[str] = None
    day_growth: Optional[float] = None
    scale: Optional[float] = None
    establish_date: Optional[str] = None
    manager: Optional[str] = None
    manager_tenure: Optional[float] = None
    company: Optional[str] = None
    fee_rate: Optional[float] = None
    tags: List[str] = []
    near_1m: Optional[float] = None
    near_3m: Optional[float] = None
    near_6m: Optional[float] = None
    near_1y: Optional[float] = None
    near_3y: Optional[float] = None
    ytd: Optional[float] = None


class FundManager(BaseModel):
    """基金经理信息"""
    name: str
    tenure_days: Optional[int] = None
    tenure_years: Optional[float] = None
    best_fund: Optional[str] = None
    best_return: Optional[float] = None
    total_scale: Optional[float] = None
    fund_count: Optional[int] = None
    style_analysis: Optional[str] = None


class NavPoint(BaseModel):
    """净值数据点"""
    date: str
    nav: float
    acc_nav: Optional[float] = None


class FundListParams(BaseModel):
    """基金列表查询参数"""
    category: str = "全部"
    tag: Optional[str] = None
    keyword: Optional[str] = None
    sort_by: str = "今年来"
    sort_order: str = "desc"
    page: int = 1
    page_size: int = 20
    guoyuan_only: bool = True


class FieldSource(BaseModel):
    """DSA-P0: 字段级数据溯源合同。

    每个基金详情字段的 source / status / coverage 元数据。
    status 枚举: available | partial | stale | missing
    """
    field: str
    value: Optional[float | str] = None
    source: Optional[str] = None
    asOf: Optional[str] = None
    status: str = "missing"
    coverage: float = 0.0
    missingReason: Optional[str] = None


class FieldSourceGroup(BaseModel):
    """字段组定义：一组字段的来源与回退策略。"""
    fields: List[str]
    source: str
    fallback: Optional[str] = None
    section: str = ""


class ProviderHealth(BaseModel):
    """DSA-P0: 数据源健康状态。

    每个 provider 的能力清单、最近成功/失败时间、熔断状态。
    """
    name: str
    capabilities: List[str] = []
    status: str = "unknown"  # available | partial | stale | cooldown | missing | unknown
    available: bool = False
    lastSuccessAt: Optional[str] = None
    lastError: Optional[str] = None
    cooldownUntil: Optional[str] = None
    failureCount: int = 0
    circuitOpen: bool = False


class ProviderHealthResponse(BaseModel):
    """数据源健康端点响应。"""
    status: str = "missing"  # available | partial | missing
    updatedAt: Optional[str] = None
    providers: List[ProviderHealth] = []
    availableCount: int = 0
    totalCount: int = 0
