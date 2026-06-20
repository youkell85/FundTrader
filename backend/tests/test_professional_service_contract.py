import numpy as np

from app.services import professional_service as service


def test_asset_allocation_does_not_estimate_missing_bonds_or_cash():
    result = service._analyze_asset_allocation(
        {"stock_holdings": [{"name": "A", "ratio": 12.5}, {"name": "B", "ratio": 7.5}]}
    )

    assert result["stocks"] == 20.0
    assert result["bonds"] is None
    assert result["cash"] is None
    assert result["other"] is None
    assert result["dataStatus"] == "partial"
    assert "未做默认估算" in result["missingReason"]


def test_asset_allocation_accepts_numeric_ratio_strings():
    result = service._analyze_asset_allocation(
        {"stock_holdings": [{"name": "A", "ratio": "12.5"}, {"name": "B", "ratio": "7.5"}]}
    )

    assert result["stocks"] == 20.0
    assert result["bonds"] is None
    assert result["cash"] is None
    assert result["dataStatus"] == "partial"


def test_asset_allocation_missing_without_valid_ratios():
    result = service._analyze_asset_allocation(
        {"stock_holdings": [{"name": "A", "ratio": None}, {"name": "B", "ratio": "bad"}]}
    )

    assert result["stocks"] is None
    assert result["dataStatus"] == "missing"
    assert result["bonds"] is None
    assert result["cash"] is None


def test_asset_allocation_missing_without_real_holdings():
    result = service._analyze_asset_allocation({"stock_holdings": []})

    assert result["stocks"] is None
    assert result["dataStatus"] == "missing"
    assert "未生成资产配置估算" in result["missingReason"]


def test_industry_distribution_uses_real_industry_fields_only():
    result = service._analyze_industry_distribution(
        {
            "stock_holdings": [
                {"industry": "银行", "ratio": 6.0},
                {"industry": "银行", "ratio": 3.5},
                {"industry": "电子", "ratio": 2.0},
                {"industry": "", "ratio": 88.5},
            ]
        }
    )

    assert result["dataStatus"] == "available"
    assert result["items"] == {"银行": 9.5, "电子": 2.0}
    assert "待完善" not in result["items"]


def test_industry_distribution_does_not_create_placeholder_bucket():
    result = service._analyze_industry_distribution(
        {"stock_holdings": [{"name": "A", "ratio": 10.0}, {"name": "B", "ratio": 5.0}]}
    )

    assert result["items"] == {}
    assert result["dataStatus"] == "missing"
    assert "缺少行业字段" in result["missingReason"]


def test_style_box_does_not_default_to_midcap_balanced_when_sample_short():
    result = service._analyze_style_box(np.array([0.01] * 10), [1.0 + i * 0.01 for i in range(11)])

    assert result["size"] is None
    assert result["style"] is None
    assert result["box"] is None
    assert result["dataStatus"] == "missing"
    assert "未生成默认风格九宫格" in result["missingReason"]


def test_style_box_marks_nav_derived_result_as_partial():
    navs = [1.0 + i * 0.01 for i in range(80)]
    returns = np.diff(navs) / np.array(navs[:-1])

    result = service._analyze_style_box(returns, navs)

    assert result["box"] is not None
    assert result["dataStatus"] == "partial"
    assert result["source"] == "nav_derived_vol_return"
