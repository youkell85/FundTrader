"""腾讯财经实时行情适配器"""
import urllib.request
import json
from typing import Optional, List
from .base import DataProvider, FundBasic, FundNav, FundHolding, FundDetail
from ...utils import console_error


class TencentProvider(DataProvider):
    """腾讯财经免费实时行情适配器
    接口格式: https://qt.gtimg.cn/q=code
    基金格式: fundcode (如 fu000001)
    """

    name = "tencent"
    priority = 2

    BASE_URL = "https://qt.gtimg.cn/q="

    def is_available(self) -> bool:
        try:
            req = urllib.request.Request(
                f"{self.BASE_URL}sh000001",
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def _fetch_raw(self, symbol: str) -> Optional[str]:
        """获取原始行情数据"""
        try:
            req = urllib.request.Request(
                f"{self.BASE_URL}{symbol}",
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.qq.com/"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                text = resp.read().decode("gbk", errors="ignore")
                return text
        except Exception as e:
            console_error(f"Tencent fetch error: {e}")
            return None

    def _parse_fund(self, text: str, code: str) -> Optional[FundDetail]:
        """解析基金行情数据"""
        if not text or "v_fund" not in text:
            return None
        try:
            # 腾讯返回格式: v_fundcode="name,nav,accum_nav,nav_date,day_growth,..."
            start = text.index('"') + 1
            end = text.rindex('"')
            data_str = text[start:end]
            parts = data_str.split(",")
            if len(parts) < 5:
                return None

            name = parts[0] if len(parts) > 0 else ""
            nav = self._safe_float(parts[1]) if len(parts) > 1 else None
            accum_nav = self._safe_float(parts[2]) if len(parts) > 2 else None
            nav_date = parts[3] if len(parts) > 3 else ""
            day_growth = self._safe_float(parts[4]) if len(parts) > 4 else None

            return FundDetail(
                code=code,
                name=name,
                nav=nav,
                nav_date=nav_date,
                day_growth=day_growth,
                source=self.name,
            )
        except Exception as e:
            console_error(f"Tencent parse error: {e}")
            return None

    def get_fund_list(self, market: str = "O") -> List[FundBasic]:
        return []

    def get_fund_detail(self, code: str) -> Optional[FundDetail]:
        # 腾讯基金格式: fu + 6位代码
        symbol = f"fu{code}"
        text = self._fetch_raw(symbol)
        return self._parse_fund(text, code) if text else None

    def get_fund_nav(self, code: str, start_date: str = "", end_date: str = "") -> List[FundNav]:
        # 腾讯不提供历史净值接口
        return []

    def get_fund_holdings(self, code: str) -> List[FundHolding]:
        return []
