"""
配置报告生成器 — 生成可导出的 HTML/PDF 报告
"""
from datetime import datetime
from typing import Dict, Any, Optional


def generate_allocation_report(data: Dict[str, Any]) -> str:
    """生成配置方案的 HTML 报告"""
    meta = data.get("meta", {})
    user_profile = data.get("user_profile", {})
    saa = data.get("saa", {})
    taa = data.get("taa", {})
    funds = data.get("funds", [])
    portfolio_metrics = data.get("portfolio_metrics", {})
    stress_tests = data.get("stress_tests", [])
    monte_carlo = data.get("monte_carlo", {})
    factor_exposures = data.get("factor_exposures", {})
    constraints = data.get("constraints", [])

    # 风险类型中文映射
    risk_labels = {
        "conservative": "保守型", "moderate": "稳健型",
        "balanced": "平衡型", "aggressive": "进取型", "radical": "激进型",
    }

    # 资产类型中文映射
    asset_labels = {
        "a_share_large": "A股大盘", "a_share_small": "A股小盘",
        "a_share_value": "A股价值", "a_share_growth": "A股成长",
        "hk_equity": "港股", "us_equity": "美股(QDII)",
        "rate_bond": "利率债", "credit_bond": "信用债",
        "convertible": "可转债", "money_fund": "货币基金",
        "gold": "黄金ETF", "commodity": "商品期货",
        "reits": "公募REITs", "cash": "现金",
    }

    # 大类映射
    group_labels = {
        "equity": "权益类", "fixed_income": "固收类",
        "alternative": "另类", "cash_equiv": "现金类",
    }

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>资产配置方案报告</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
            padding: 20px;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
        .header {{
            text-align: center;
            border-bottom: 2px solid #e9ecef;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }}
        .header h1 {{
            font-size: 28px;
            color: #212529;
            margin-bottom: 8px;
        }}
        .header .meta {{
            font-size: 14px;
            color: #6c757d;
        }}
        .section {{
            margin-bottom: 30px;
        }}
        .section h2 {{
            font-size: 20px;
            color: #495057;
            border-left: 4px solid #3b82f6;
            padding-left: 12px;
            margin-bottom: 16px;
        }}
        .section h3 {{
            font-size: 16px;
            color: #6c757d;
            margin: 16px 0 8px;
        }}
        .grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 16px;
        }}
        .card {{
            background: #f8f9fa;
            border-radius: 6px;
            padding: 16px;
        }}
        .card-label {{
            font-size: 12px;
            color: #6c757d;
            margin-bottom: 4px;
        }}
        .card-value {{
            font-size: 20px;
            font-weight: 600;
            color: #212529;
        }}
        .card-value.green {{ color: #10b981; }}
        .card-value.red {{ color: #ef4444; }}
        .card-value.blue {{ color: #3b82f6; }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
            font-size: 14px;
        }}
        th, td {{
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid #e9ecef;
        }}
        th {{
            background: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }}
        tr:hover {{
            background: #f8f9fa;
        }}
        .tag {{
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            margin-right: 4px;
        }}
        .tag-green {{ background: #d1fae5; color: #065f46; }}
        .tag-yellow {{ background: #fef3c7; color: #92400e; }}
        .tag-red {{ background: #fee2e2; color: #991b1b; }}
        .tag-blue {{ background: #dbeafe; color: #1e40af; }}
        .allocation-bar {{
            height: 24px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
            display: flex;
            margin: 8px 0;
        }}
        .allocation-segment {{
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            color: white;
            font-weight: 500;
        }}
        .legend {{
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 8px;
        }}
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
        }}
        .legend-dot {{
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }}
        .footer {{
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e9ecef;
            text-align: center;
            font-size: 12px;
            color: #6c757d;
        }}
        .warning {{
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 12px 16px;
            border-radius: 4px;
            margin: 16px 0;
            font-size: 14px;
        }}
        @media print {{
            body {{ padding: 0; background: white; }}
            .container {{ box-shadow: none; padding: 20px; }}
            .no-print {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>资产配置方案报告</h1>
            <div class="meta">
                引擎版本 {meta.get('engine_version', 'N/A')} |
                生成时间 {meta.get('generated_at', datetime.now().strftime('%Y-%m-%d %H:%M'))} |
                市场环境: {meta.get('regime_label', '基准')}
            </div>
        </div>

        <!-- 用户画像 -->
        <div class="section">
            <h2>用户画像</h2>
            <div class="grid">
                <div class="card">
                    <div class="card-label">风险偏好</div>
                    <div class="card-value">{risk_labels.get(user_profile.get('risk_tolerance', 'balanced'), '平衡型')}</div>
                </div>
                <div class="card">
                    <div class="card-label">年龄</div>
                    <div class="card-value">{user_profile.get('age', 35)}岁</div>
                </div>
                <div class="card">
                    <div class="card-label">投资金额</div>
                    <div class="card-value blue">¥{user_profile.get('amount', 500000):,.0f}</div>
                </div>
                <div class="card">
                    <div class="card-label">投资期限</div>
                    <div class="card-value">{user_profile.get('horizon', '中期')}</div>
                </div>
            </div>
        </div>

        <!-- 战略配置 (SAA) -->
        <div class="section">
            <h2>战略资产配置 (SAA)</h2>
            <div class="grid">
                <div class="card">
                    <div class="card-label">预期年化收益</div>
                    <div class="card-value green">{saa.get('expected_return', 0):.1f}%</div>
                </div>
                <div class="card">
                    <div class="card-label">预期波动率</div>
                    <div class="card-value">{saa.get('expected_volatility', 0):.1f}%</div>
                </div>
                <div class="card">
                    <div class="card-label">夏普比率</div>
                    <div class="card-value blue">{saa.get('sharpe_ratio', 0):.2f}</div>
                </div>
                <div class="card">
                    <div class="card-label">预期最大回撤</div>
                    <div class="card-value red">{saa.get('expected_max_drawdown', 0):.1f}%</div>
                </div>
            </div>

            <h3>大类配置</h3>
            <div class="allocation-bar">
    """

    # 大类配置可视化
    group_colors = {
        "equity": "#ef4444", "fixed_income": "#3b82f6",
        "alternative": "#f59e0b", "cash_equiv": "#10b981",
    }
    group_allocations = saa.get("group_allocations", {})
    for group, pct in group_allocations.items():
        if pct > 0:
            html += f'<div class="allocation-segment" style="width:{pct}%;background:{group_colors.get(group, "#6b7280")}">{pct:.0f}%</div>'

    html += '</div><div class="legend">'
    for group, pct in group_allocations.items():
        if pct > 0:
            html += f'<div class="legend-item"><div class="legend-dot" style="background:{group_colors.get(group, "#6b7280")}"></div>{group_labels.get(group, group)} {pct:.1f}%</div>'
    html += "</div>"

    # 详细资产配置
    html += '<h3>资产明细</h3><table><tr><th>资产类别</th><th>配置比例</th></tr>'
    allocations = saa.get("allocations", {})
    for asset, pct in sorted(allocations.items(), key=lambda x: -x[1]):
        if pct > 0:
            html += f'<tr><td>{asset_labels.get(asset, asset)}</td><td>{pct:.1f}%</td></tr>'
    html += "</table></div>"

    # 战术调整 (TAA)
    if taa.get("adjustments"):
        html += '<div class="section"><h2>战术调整 (TAA)</h2>'
        html += f'<p>综合信号得分: <strong>{taa.get("composite_score", 0):.2f}</strong> (范围 -1 到 +1)</p>'
        html += "<table><tr><th>资产</th><th>SAA权重</th><th>TAA调整</th><th>最终权重</th></tr>"
        for asset, adj in sorted(taa["adjustments"].items()):
            saa_w = allocations.get(asset, 0)
            taa_w = taa.get("taa_adjusted", {}).get(asset, saa_w)
            if abs(adj) > 0.1:
                html += f'<tr><td>{asset_labels.get(asset, asset)}</td><td>{saa_w:.1f}%</td><td style="color:{"#10b981" if adj > 0 else "#ef4444"}">{"+" if adj > 0 else ""}{adj:.1f}%</td><td>{taa_w:.1f}%</td></tr>'
        html += "</table></div>"

    # 推荐基金
    html += '<div class="section"><h2>推荐基金组合</h2><table><tr><th>代码</th><th>名称</th><th>类型</th><th>权重</th><th>金额</th><th>角色</th></tr>'
    for fund in funds:
        html += f'<tr><td>{fund.get("code", "")}</td><td>{fund.get("name", "")}</td><td>{fund.get("type", "")}</td><td>{fund.get("weight", 0):.1f}%</td><td>¥{fund.get("amount", 0):,.0f}</td><td>{fund.get("role", "")}</td></tr>'
    html += "</table></div>"

    # 组合指标
    html += '<div class="section"><h2>组合指标</h2><div class="grid">'
    metric_labels = {
        "expected_return": "预期收益", "expected_volatility": "预期波动",
        "sharpe_ratio": "夏普比率", "max_drawdown": "最大回撤",
        "calmar_ratio": "卡尔玛比率", "sortino_ratio": "索提诺比率",
    }
    for key, label in metric_labels.items():
        val = portfolio_metrics.get(key)
        if val is not None:
            color_class = "green" if val > 0 and key not in ["max_drawdown", "expected_volatility"] else ""
            html += f'<div class="card"><div class="card-label">{label}</div><div class="card-value {color_class}">{val:.2f}{"%" if "return" in key or "volatility" in key or "drawdown" in key else ""}</div></div>'
    html += "</div></div>"

    # 压力测试
    if stress_tests:
        html += '<div class="section"><h2>压力测试</h2><table><tr><th>场景</th><th>预期影响</th><th>最大亏损</th></tr>'
        for st in stress_tests:
            impact_color = "red" if st.get("impact", 0) < -5 else ""
            html += f'<tr><td>{st.get("scenario", "")}</td><td class="{impact_color}">{st.get("impact", 0):.1f}%</td><td class="red">¥{abs(st.get("max_loss", 0) * user_profile.get("amount", 500000) / 100):,.0f}</td></tr>'
        html += "</table></div>"

    # 蒙特卡洛模拟
    if monte_carlo:
        html += '<div class="section"><h2>蒙特卡洛模拟</h2><div class="grid">'
        html += f'<div class="card"><div class="card-label">中位收益</div><div class="card-value green">{monte_carlo.get("median_return", 0):.1f}%</div></div>'
        html += f'<div class="card"><div class="card-label">正收益概率</div><div class="card-value blue">{monte_carlo.get("prob_positive", 0):.1f}%</div></div>'
        html += f'<div class="card"><div class="card-label">VaR(95%)</div><div class="card-value red">{monte_carlo.get("var_95", 0):.1f}%</div></div>'
        html += f'<div class="card"><div class="card-label">CVaR(95%)</div><div class="card-value red">{monte_carlo.get("cvar_95", 0):.1f}%</div></div>'
        html += "</div></div>"

    # 因子暴露
    if factor_exposures:
        html += '<div class="section"><h2>因子暴露</h2><div class="legend">'
        factor_labels = {
            "growth": "成长", "value": "价值", "momentum": "动量",
            "quality": "质量", "size": "规模", "volatility": "波动",
        }
        for factor, exp in factor_exposures.items():
            tag_class = "tag-green" if exp > 0.3 else "tag-red" if exp < -0.3 else "tag-yellow"
            html += f'<span class="tag {tag_class}">{factor_labels.get(factor, factor)}: {exp:+.2f}</span>'
        html += "</div></div>"

    # 约束检查
    if constraints:
        html += '<div class="section"><h2>约束检查</h2>'
        all_passed = all(c.get("passed", False) for c in constraints)
        if all_passed:
            html += '<div class="tag tag-green">所有约束条件均满足</div>'
        else:
            html += '<div class="warning">部分约束条件未满足，请检查配置</div>'
        html += '<table><tr><th>规则</th><th>当前值</th><th>限制</th><th>状态</th></tr>'
        for c in constraints:
            status = '<span class="tag tag-green">通过</span>' if c.get("passed") else '<span class="tag tag-red">未通过</span>'
            html += f'<tr><td>{c.get("rule", "")}</td><td>{c.get("value", "")}</td><td>{c.get("limit", "")}</td><td>{status}</td></tr>'
        html += "</table></div>"

    # 风险提示
    html += """
        <div class="warning">
            <strong>风险提示：</strong>本报告仅供参考，不构成投资建议。历史表现不代表未来收益。投资有风险，入市需谨慎。请根据自身风险承受能力做出投资决策。
        </div>

        <div class="footer">
            <p>FundTrader 智能资产配置平台 | 报告生成时间: """ + datetime.now().strftime('%Y-%m-%d %H:%M:%S') + """</p>
            <p class="no-print" style="margin-top: 12px;">
                <button onclick="window.print()" style="padding: 8px 24px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">打印/保存PDF</button>
            </p>
        </div>
    </div>
</body>
</html>"""

    return html


def generate_comparison_report(plans: list[Dict[str, Any]]) -> str:
    """生成多个方案对比报告"""
    if not plans:
        return "<html><body><h1>无方案可对比</h1></body></html>"

    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>方案对比报告</title>
    <style>
        body { font-family: -apple-system, "PingFang SC", sans-serif; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; border: 1px solid #e9ecef; text-align: center; }
        th { background: #f8f9fa; }
        .best { background: #d1fae5; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <h1 style="text-align: center;">资产配置方案对比</h1>
        <table>
            <tr>
                <th>指标</th>
    """

    for i, plan in enumerate(plans):
        name = plan.get("name", f"方案{i+1}")
        html += f"<th>{name}</th>"

    html += "</tr>"

    # 对比指标
    metrics = [
        ("预期收益", lambda p: f"{p.get('response', {}).get('saa', {}).get('expected_return', 0):.1f}%"),
        ("预期波动", lambda p: f"{p.get('response', {}).get('saa', {}).get('expected_volatility', 0):.1f}%"),
        ("夏普比率", lambda p: f"{p.get('response', {}).get('saa', {}).get('sharpe_ratio', 0):.2f}"),
        ("最大回撤", lambda p: f"{p.get('response', {}).get('saa', {}).get('expected_max_drawdown', 0):.1f}%"),
    ]

    for label, getter in metrics:
        html += f"<tr><td><strong>{label}</strong></td>"
        values = []
        for plan in plans:
            val = getter(plan)
            values.append((val, plan))
        # Find best value (highest for return/sharpe, lowest for vol/drawdown)
        if label in ["预期收益", "夏普比率"]:
            best_idx = max(range(len(values)), key=lambda i: float(values[i][0].rstrip('%')))
        else:
            best_idx = min(range(len(values)), key=lambda i: float(values[i][0].rstrip('%')))

        for i, (val, _) in enumerate(values):
            cls = ' class="best"' if i == best_idx else ''
            html += f"<td{cls}>{val}</td>"
        html += "</tr>"

    html += """
        </table>
        <div style="text-align: center; margin-top: 20px;">
            <button onclick="window.print()" style="padding: 8px 24px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">打印/保存PDF</button>
        </div>
    </div>
</body>
</html>"""

    return html
