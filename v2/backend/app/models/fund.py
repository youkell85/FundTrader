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
