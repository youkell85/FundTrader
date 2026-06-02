# FundTrader 资产配置功能 — 深度代码审查报告

## 总体评级
**C+** — 架构设计优秀（14步管线、5级SAA降级、3层CMA、熔断器、持续性确认），但存在多个金融计算正确性问题和数据质量硬伤，部分问题可能导致配置结果失真，需在上线前修复。

---

## 维度1: 交互设计审查

### 问题清单
| # | 严重度 | 位置 | 问题描述 | 修复建议 |
|---|--------|------|---------|---------|
| 1 | **高** | AllocationWizard.tsx L29-32 | 前端q3选项值为`vhigh/vmid/vlow/vnone`，但后端`risk_profiler.py` L12的`_BEHAVIOR_ADJUSTMENTS`期望key为`high/medium/low/none`。选项值不匹配导致q3的回答永远无法被后端识别，行为校准完全失效 | 统一前后端选项值：前端改为`high/medium/low/none`，或后端适配`vhigh/vmid/vlow/vnone` |
| 2 | **高** | AllocationWizard.tsx L152-155 vs risk_profiler.py L44-48 | 前端`calibratedRisk`逻辑：`avg < -0.5`时降1级、`avg > 1.5`时升1级；后端`profile_user`：`avg < -0.5`降1级、`avg > 1.5`升1级。阈值一致但前端的映射表是硬编码的if-else链（不支持radical→更高级别），后端用`_RISK_LEVELS.index`动态计算。当`risk_tolerance=radical`且`avg>1.5`时，前端不会升级（停留在radical），后端`min(4, 4+1)=4`也不升级，结果一致但逻辑路径不同，维护风险高 | 前端校准逻辑应调用后端返回的`effective_risk`，而非本地重复计算 |
| 3 | **中** | AllocationWizard.tsx L13-17 | 前端RISK_OPTIONS中conservative的dd=12，但config.py L35中conservative的max_drawdown=8。用户选择"保守型"时前端发送dd=12，后端模板dd=8，显示与实际不一致 | 前端dd值应与后端RISK_PROFILES同步，或从后端动态获取 |
| 4 | **中** | allocation.py L89-138 | SSE流式生成无服务端超时保护。如果管线某步卡死（如Tushare API挂起），SSE连接将无限等待。虽然客户端可取消，但服务端线程不会自动释放 | 在`_run_pipeline`中增加总超时（如120s），超时后设置cancel_event |
| 5 | **低** | AllocationWizard.tsx L105 | `max_drawdown: config.max_drawdown || 24` — 当用户选择conservative(dd=12)后，若滑块未触碰，`config.max_drawdown`为12，`12||24`得12，正确。但若用户清空输入使值为0，`0||24`会回退到24，与用户意图不符 | 改为`config.max_drawdown ?? 24`或`config.max_drawdown !== undefined ? config.max_drawdown : 24` |
| 6 | **低** | allocationStore.tsx | Store默认`max_drawdown: 24`，但balanced模板的dd=22。用户首次进入选择"平衡型"时，实际发送24而非22 | 默认值应从后端配置获取，或与RISK_PROFILES同步 |

---

## 维度2: 业务逻辑审查

### 问题清单
| # | 严重度 | 位置 | 问题描述 | 修复建议 |
|---|--------|------|---------|---------|
| 1 | **高** | orchestrator.py L376 | `expected_max_drawdown = volatility × 2.5` 是粗略经验估算，与蒙特卡洛MDD95完全不同量级。对于balanced组合(vol≈12%)，此公式给出MDD=30%，而MC的MDD95可能完全不同。两个MDD同时出现在响应中，前端展示哪个？用户会困惑 | 应统一使用MC的MDD95作为`expected_max_drawdown`，或明确标注此为"经验估算"而非"模拟结果" |
| 2 | **高** | orchestrator.py L485-489 | Sharpe比率计算中无风险利率硬编码`rf=2.0%`。2024-2026年中国10Y国债收益率在1.6-2.3%之间波动，美国更是在4-5%区间。固定2%不反映实际机会成本 | 应从宏观数据中获取当前10Y国债收益率作为rf，或至少按市场(regime)动态调整 |
| 3 | **高** | taa_engine.py L195 | `equity_adjustment = composite_score × 0.10 × regime.confidence`。当`confidence=0.3`（数据不可靠）时，仍会产生非零调整。例如composite_score=0.8时，equity_adj=0.8×0.10×0.3=2.4%，这对一个低置信度的信号来说影响过大 | 当confidence<0.5时，应将TAA调整幅度进一步衰减或直接跳过。建议：`if confidence < 0.5: equity_adj *= confidence * 2` 或 `equity_adj = 0` |
| 4 | **中** | risk_profiler.py L64 | 滑道路径(glide path)仅基于年龄：`reduction = (age - 40) × 0.5`。40岁开始每年减0.5%权益，80岁时减20%。但未考虑投资期限——一个80岁但投资期限10年的人，不应与80岁投资1年的人同等待遇 | 应结合horizon调整glide path强度：长期投资即使高龄也可承受更多权益 |
| 5 | **中** | saa_engine.py L148 | L1成功条件`result.fun < 0.1`过于宽松。L2距离（RC偏差平方和）<0.1意味着RC可以偏离目标10%以上，这并非真正的"风险预算优化" | 应收紧至`result.fun < 0.01`或检查实际RC偏差`max(abs(rc_pct - target_rc)) < 0.05` |
| 6 | **中** | cma_manager.py L253-254 | `_get_regime_adjustments`使用字符串匹配`"share" in a`来识别权益类资产。这会意外匹配到`a_share_large`等，但不会匹配`hk_equity`或`us_equity`。实际上`"share" in "hk_equity"`为False，导致港股和美股在goldilocks/stagflation/deflation时不获得regime调整 | 应使用`ASSET_TO_GROUP`映射判断资产组别，而非字符串匹配 |
| 7 | **中** | orchestrator.py L68-69 | `_DIAG_HISTORY`是模块级列表，多线程写入无锁保护。虽然Python GIL在一定程度上保护了list.append的原子性，但`_record_run`中的读-写操作（append + pop）不是原子的 | 加`threading.Lock`保护`_record_run`，或使用`collections.deque(maxlen=10)` |
| 8 | **低** | scenario_analysis.py | 情景分析仅3个情景（乐观25%/基准50%/悲观25%），概率固定，且乘数按组别而非按资产类别。实际不同资产在同一情景下表现差异巨大 | 增加情景数量（如5个），概率应根据regime动态调整，乘数应细化到资产类别 |

---

## 维度3: UI实现审查

### 问题清单
| # | 严重度 | 位置 | 问题描述 | 修复建议 |
|---|--------|------|---------|---------|
| 1 | **中** | AllocationWizard.tsx L173 | 年龄输入使用原生`<input type="number">`，未使用项目约定的Radix组件。但此处是数字输入框，Radix无原生数字输入组件，可接受 | — |
| 2 | **中** | AllocationWizard.tsx L201 | 最大回撤滑块使用原生`<input type="range">`，样式依赖`accent-[#3B6CFF]`，在部分浏览器上表现不一致 | 可考虑使用Radix Slider组件 |
| 3 | **中** | allocationStore.tsx | Store代码极度压缩（单行），可读性极差，难以维护和调试 | 应格式化为正常代码风格 |
| 4 | **低** | useAllocationData.ts L23 | 当store无输出时回退到`MOCK_DATA`，但`isMock`标志仅用于标记，前端组件可能未充分区分mock和真实数据 | 确保所有展示组件在`isMock=true`时显示"示例数据"提示 |
| 5 | **低** | AllocationWizard.tsx | 5步向导无步骤跳转功能，用户无法返回修改之前的输入而不丢失后续步骤 | 允许点击已完成步骤直接跳转 |

---

## 维度4: 宏观经济背景确定审查

### 问题清单
| # | 严重度 | 位置 | 问题描述 | 修复建议 |
|---|--------|------|---------|---------|
| 1 | **高** | regime_detector.py L199 | 象限阈值`THRESHOLD = 0.1`过低。以PMI为例，PMI=50.2时growth_score=(50.2-50)/2=0.1，刚好触发"增长"分类。但PMI=50.2仅是微弱扩张，远不足以判定"金发女孩"或"过热"。0.1的阈值使regime分类对噪声极度敏感 | 建议将阈值提高至0.2-0.3，或使用统计学显著性检验（如PMI是否显著偏离50） |
| 2 | **高** | regime_detector.py L64 | 2D象限分类（增长×通胀）仅4种状态+baseline。遗漏了重要的经济状态如"复苏"（增长从负转正、通胀仍低）和"衰退深化"（增长加速下滑）。实际经济周期通常有5-6个阶段 | 增加过渡状态：如growth从负转正但未确认时标记为"复苏"，或引入3D分类（增长×通胀×货币） |
| 3 | **中** | regime_detector.py L133-151 | `_score_growth`仅使用PMI和GDP两个指标。GDP是季度数据、滞后性强，PMI是月度数据。当GDP数据滞后1-2个季度时，growth_score可能严重失真 | 增加更多高频增长指标（如工业增加值、社零同比），或对GDP赋予更低权重 |
| 4 | **中** | regime_detector.py L213-235 | 持续性确认要求2次连续检测。但宏观数据更新频率不同（PMI月度、GDP季度），且`detect_regime()`每次调用都重新获取快照。如果API在短时间内被多次调用，可能用同一份数据快速确认regime切换 | 持续性确认应基于时间间隔而非调用次数。要求两次检测间隔至少1个数据更新周期 |
| 5 | **中** | regime_detector.py L70 | 综合得分`composite = growth×0.4 + (-inflation)×0.3 + monetary×0.3`。权重固定，不随regime变化。在滞胀期，通胀权重应更高；在衰退期，增长权重应更高 | 权重应根据当前regime动态调整，或使用IC衰减分析确定最优权重 |
| 6 | **低** | regime_detector.py L25-27 | `_previous_regime`等全局变量在进程重启后丢失，初始状态为"baseline"。如果服务器重启时实际处于"过热"状态，需要2次连续检测才能恢复，期间配置结果可能失真 | 从SQLite历史记录恢复上次确认的regime状态 |

---

## 维度5: 经济指标可信度审查

### 问题清单
| # | 严重度 | 位置 | 问题描述 | 修复建议 |
|---|--------|------|---------|---------|
| 1 | **高** | macro_fetcher.py L383-386 | 财政赤字率硬编码`return 3.0`，confidence=0.3。但taa_engine.py L243中`_linear_score(3.0, 2.5, 3.5)`会产出score=0.5（偏多），且confidence=0.3时仍参与TAA评分。一个永不更新的硬编码值不应影响配置决策 | 当confidence<0.5时，该指标应被排除出TAA评分，或标记为"不可用"（score=0） |
| 2 | **高** | macro_fetcher.py L408-432 | 美元指数DXY计算使用`open.er-api.com`的汇率数据。公式中`eur^0.576`实际是`(1/EURUSD)^(-0.576) = EURUSD^0.576`，数学正确。但DXY官方公式中EUR权重为-0.576（负号），即`DXY ∝ EURUSD^(-0.576)`。代码中`eur^0.576`等价于`(1/eur)^(-0.576)`，即`EURUSD^(-0.576)`，**数学上正确**。但该API返回的是中间价而非ICE交易价，且缺少NOK权重（DXY旧公式含6种货币，新公式可能不同），精度有限 | 在返回值中标注"近似DXY"，confidence设为0.7而非0.9 |
| 3 | **高** | macro_fetcher.py L229-261 | DR007使用Shibor 1W作为代理。Shibor是银行间报价利率，DR007是回购利率，两者有系统性差异（通常DR007>Shibor，差异在10-30bp）。用Shibor 1W代理DR007会系统性低估资金成本 | 优先从akshare获取FR007（回购定盘利率），仅在FR007不可用时才用Shibor代理，并降低confidence |
| 4 | **高** | taa_engine.py L239 | "社融增速"的评分阈值为`_linear_score(v, 7.0, 10.0)`，但macro_fetcher.py L266-289获取的是"社融增量"（年度累计，单位亿元，量级在20-35万亿），而非"社融增速"（百分比，通常7-13%）。**量纲完全不匹配**：增量30万亿代入增速评分函数`_linear_score(300000, 7, 10)`会得到score=1.0（满分偏多），完全失真 | 必须修复：要么macro_fetcher返回增速而非增量，要么taa_engine的评分阈值适配增量量纲 |
| 5 | **中** | macro_fetcher.py L357-378 | 北向资金列名不稳定：代码尝试`"当日成交净买额"`和`"净流入"`两列，akshare API经常变更列名。如果两列都不存在，会fallback到第一个数值列，可能取到错误数据 | 增加列名验证和日志告警；当列名不匹配时返回None而非猜测 |
| 6 | **中** | macro_fetcher.py L56-73 | 所有指标获取失败时confidence=0.3，但taa_engine.py L256-261仅将confidence映射为"low/medium/high"字符串，**不用于调整评分权重**。confidence=0.3的指标与confidence=0.95的指标在TAA评分中权重相同 | TAA评分应按confidence加权：`score × confidence`，低置信度指标的贡献应被衰减 |
| 7 | **中** | market_data_service.py L154-217 | IC衰减分析实现是伪计算：用`avg_signal × avg_confidence × 0.1`作为`ic_mean`，用固定`"6m"`作为`half_life`，用`avg_confidence`作为`quality`。这不是真正的IC（信息系数），无法反映指标对资产收益的实际预测力 | 实现真正的IC计算：需要历史信号时间序列和对应的前瞻收益，计算Spearman相关系数。当前实现应标注为"placeholder" |
| 8 | **低** | taa_engine.py L232-246 | 13个宏观指标之间存在较强共线性：PMI与GDP、CPI与PPI、M2与社融。共线性会导致某些信号类别被重复计算，放大该方向的影响 | 对7个信号类别进行正交化处理，或降低共线性指标的权重 |

---

## 维度6: 金融指标测算正确性审查

### 问题清单
| # | 严重度 | 位置 | 问题描述 | 修复建议 |
|---|--------|------|---------|---------|
| 1 | **高** | monte_carlo.py L80-82 | 跳跃扩散实现问题：`jump_mask`的概率是`jp["prob"] × jump_sensitivity`，但跳跃大小又乘了一次`jump_sensitivity`：`jump_mask * jump_sizes * jump_sensitivity`。这导致敏感资产被双重放大：(1)更容易触发跳跃，(2)跳跃幅度更大。标准Merton跳跃扩散模型中，跳跃概率和跳跃大小应独立参数化，不应同时乘以同一sensitivity | 修改为：`jump_mask = rng.random(...) < jp["prob"]`（统一概率），`jump_sizes = rng.normal(jp["mean"] * sensitivity, jp["vol"], ...)`（仅大小乘sensitivity） |
| 2 | **高** | monte_carlo.py L53-54 | 月度收益计算`monthly_returns = annual_returns / 12.0`使用简单除法，但正确做法是`monthly_returns = (1 + annual_returns) ** (1/12) - 1`。对于8.5%年化收益，简单除法得0.708%/月，复利法得0.683%/月，36个月累积差异约0.9% | 改用复利法：`monthly_returns = np.power(1 + annual_returns, 1/12) - 1` |
| 3 | **高** | monte_carlo.py L57-58 | 年度协方差转月度使用`cov_monthly = cov_annual / 12.0`。正确做法是`cov_monthly = cov_annual / 12.0`（对于对数收益这是正确的），但前提是输入的returns和cov必须一致——如果returns用简单除法（非对数），则cov也应相应调整 | 确保returns和cov使用一致的复利方法。建议统一使用对数收益框架 |
| 4 | **高** | saa_engine.py L110-117 | L1风险预算优化的目标函数是RC百分比的L2距离，但target_rc是等分到组内每个资产的（`budget / n_in_group`）。例如equity组6个资产，每资产目标RC=0.65/6≈10.8%。但实际优化中，6个权益资产的RC不可能相等（因为波动率和相关性不同），这导致L1几乎不可能达到`result.fun < 0.1`以下 | 应将target_rc设为组级别约束（组RC之和=target），而非强制组内等分。或使用组级别RC偏差作为目标 |
| 5 | **高** | orchestrator.py L497-498 | Calmar比率 = `expected_return / max_drawdown`，其中max_drawdown = `volatility × 2.5`。但Calmar比率的分母应是**实际最大回撤**（如MC模拟的MDD95），而非波动率的粗略倍数。用vol×2.5作为MDD会导致Calmar失真 | 使用MC的MDD95计算Calmar，或至少使用历史回测MDD |
| 6 | **中** | matrix_utils.py L59-119 | Ledoit-Wolf收缩实现使用条件数启发式（cond>1000时delta=...），这不是标准的LW公式。标准LW需要样本数量T来计算最优收缩强度。当前实现缺乏T参数，收缩强度可能不准确 | 实现标准LW公式，传入样本数量T。或使用sklearn的`LedoitWolf`估计器 |
| 7 | **中** | saa_engine.py L199-235 | ERC的CCD实现中，`w_new_i = target_rc_i / a`，其中`target_rc_i = var_p / n`。但标准ERC的目标是每个资产的RC相等（即`RC_i = sigma_p / n`），而非`RC_i = var_p / n`。`var_p / n`是方差贡献而非风险贡献 | 修正为：`target_rc_i = sigma_p / n`，其中`sigma_p = sqrt(var_p)` |
| 8 | **中** | cma_manager.py L69-71 | 协方差矩阵构建：`vols_array`将%转为小数（`volatilities[a] / 100.0`），但`corr_to_cov`的结果`cov[i,j] = corr[i,j] × vol[i] × vol[j]`。如果vol已经是小数（如0.22），则cov的单位是"小数的平方"（0.0484），这是正确的。但SAA优化器中`returns = cma.expected_returns[a] / 100.0`，cov和returns的单位一致（小数），**这部分正确** | — |
| 9 | **中** | stress_test.py L52-54 | 可转债3D压力中，`asset_drawdown = cb_stress / 100.0`，但其他资产`asset_drawdown = drawdowns.get(asset, 0.0) / 100.0`。STRESS_SCENARIOS中的值已经是百分比（如-65），cb_stress也是百分比（如-32.5），两者单位一致。**这部分正确** | — |
| 10 | **中** | monte_carlo.py L107-108 | VaR和CVaR计算基于总收益（terminal return），而非月度收益。这导致VaR反映的是整个投资期的损失，而非单期损失。对于不同horizon的用户，VaR不可比 | 应同时提供年化VaR（基于月度收益分布）和累积VaR |
| 11 | **低** | saa_engine.py L339-343 | L4逆波动率加权中`vols = np.maximum(vols, 0.1)`，0.1%的底限过低。如果某资产vol=0.5%（货币基金），逆波动率权重会极大，可能导致货币基金占比过高 | 底限应设为1.0%或2.0%，或对货币基金/现金类资产设独立上限 |

---

## Blocker清单（必须修复才能上线）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| B1 | **社融量纲错误** — macro_fetcher返回"增量"（万亿元级），taa_engine按"增速"（7-10%）评分，导致社融信号永远满分偏多 | macro_fetcher.py L266 + taa_engine.py L239 | TAA调整方向可能完全错误 |
| B2 | **前端q3选项值不匹配** — 前端发`vhigh/vmid/vlow/vnone`，后端期望`high/medium/low/none`，q3行为校准完全失效 | AllocationWizard.tsx L29-32 + risk_profiler.py L12 | 用户行为问卷第3题无效 |
| B3 | **蒙特卡洛跳跃扩散双重放大** — 跳跃概率和跳跃大小都乘以sensitivity，敏感资产被过度惩罚 | monte_carlo.py L80-82 | MC模拟的MDD和VaR对权益类资产偏高 |
| B4 | **CMA regime调整字符串匹配错误** — `"share" in a`无法匹配`hk_equity`和`us_equity`，港股和美股不获得regime调整 | cma_manager.py L253-254 | 港股/美股的预期收益在不同regime下不变 |
| B5 | **低置信度指标仍影响TAA** — confidence=0.3的硬编码数据（如财政赤字率）仍产生非零TAA调整 | taa_engine.py L195 + macro_fetcher.py L383 | 不可靠数据影响配置结果 |

---

## 优点亮点

1. **14步管线架构优秀**：每步独立降级、诊断记录、进度回调，生产级可观测性
2. **5级SAA降级策略**：从风险预算优化到硬编码模板，确保任何情况下都能产出配置
3. **3层CMA架构**：Anchor/Signal/Blend设计合理，数据不可用时优雅降级到静态均衡
4. **熔断器4级梯度保护**：非对称恢复机制（升级即时、降级需2次确认）防止频繁切换
5. **Regime持续性确认**：2次连续检测才切换，避免单次噪声导致配置剧变
6. **可转债3D压力测试**：Delta/Credit/Rate三通道独立建模，比简单历史回撤更专业
7. **GARCH(1,1)波动率预测**：实现完整，包含参数约束和长期方差计算
8. **IC衰减分析框架**：虽然当前实现是placeholder，但接口设计正确，后续可接入真实IC计算
9. **SSE流式生成+取消**：用户体验好，长时间计算不阻塞，支持中途取消
10. **SQLite持久化**：宏观数据和regime历史跨重启保留，避免冷启动时数据空白
