"""分析结果模型"""
from pydantic import BaseModel
from typing import Optional, List, Dict


class AnalysisResult(BaseModel):
    """深度产品分析结果"""
    code: str
    name: str
    signal: str  # 买入/持有/赎回
    confidence: float  # 0-1
    score: int  # 0-100
    reasons: List[str] = []
    manager: Optional[Dict] = None
    holdings: List[Dict] = []
    nav_data: List[Dict] = []
    radar_scores: Optional[Dict] = None  # 雷达图评分
    style_analysis: Optional[str] = None  # LLM风格分析


class RadarScores(BaseModel):
    """多维评估雷达图"""
    profitability: float = 0  # 收益能力
    risk_control: float = 0   # 抗风险
    stability: float = 0      # 稳定性
    stock_picking: float = 0  # 选股能力
    timing: float = 0         # 择时能力


class RecommendRequest(BaseModel):
    """智能推荐请求"""
    risk_level: str = "稳健"  # 保守/稳健/积极/激进
    investment_horizon: str = "中期"  # 短期/中期/长期
    amount: float = 100000
    preferences: List[str] = []


class RecommendResult(BaseModel):
    """智能推荐结果"""
    risk_level: str
    total_amount: float
    funds: List[Dict] = []
    expected_return: Optional[float] = None
    expected_risk: Optional[float] = None
    allocation_chart: Optional[Dict] = None
    analysis_summary: Optional[str] = None


class DcaBacktestRequest(BaseModel):
    """定投回测请求"""
    codes: List[str] = []
    amount: float = 1000
    frequency: str = "monthly"  # weekly/monthly
    strategy: str = "compare"  # fixed/ma/compare
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class DcaBacktestResult(BaseModel):
    """定投回测结果"""
    fund_code: str
    fund_name: Optional[str] = None
    strategy: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    years: Optional[float] = None
    total_invested: float = 0
    total_value: float = 0
    total_profit: float = 0
    total_profit_rate: float = 0
    annual_return: float = 0
    max_drawdown: float = 0
    trade_count: int = 0
    skip_count: int = 0
    nav_curve: List[Dict] = []
    error: Optional[str] = None


class ProfessionalAnalysis(BaseModel):
    """专业分析结果"""
    code: str
    name: str
    sharpe_ratio: Optional[float] = None
    max_drawdown: Optional[float] = None
    volatility: Optional[float] = None
    calmar_ratio: Optional[float] = None
    sortino_ratio: Optional[float] = None
    correlation_matrix: Optional[Dict] = None
    asset_allocation: Optional[Dict] = None
    industry_distribution: Optional[Dict] = None
    style_box: Optional[Dict] = None  # 九宫格
