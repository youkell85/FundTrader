# 回撤时间序列功能实现记录

## 改动清单

### 1. backend/app/storage/database.py
- **新增表 `fund_drawdown_series`**（在 `_init_fund_data_center_tables()` 中）：
  - 字段：`code`, `nav_date`, `window_days`, `drawdown`, `peak_nav`, `current_nav`, `source`, `computed_at`
  - 主键：`(code, nav_date, window_days)`
  - 外键：`code -> fund_master(code) ON DELETE CASCADE`
- **新增索引 `idx_fund_drawdown_code_window`**：`ON fund_drawdown_series(code, window_days, nav_date)`
- **新增 `FundDataStore.save_drawdown_series_batch()` 静态方法**：
  - 接收 `code`, `drawdown_records`, `window_days=365`, `source="compute"`
  - 使用 `INSERT ... ON CONFLICT(code, nav_date, window_days) DO UPDATE SET` 进行 upsert
  - `computed_at` 使用 `datetime.now().isoformat()`
  - 过滤无效记录（缺失日期、无法解析的 drawdown）

### 2. backend/app/services/fund_service.py
- **新增 `_calc_drawdown_series(nav_rows)` 函数**：
  - 从净值序列计算逐日回撤
  - 按 `nav_date` 升序排序
  - 维护历史最高净值 `peak_nav`
  - `drawdown = (current_nav / peak_nav - 1) * 100`
  - 返回 `[{"date", "drawdown", "peak_nav", "current_nav"}, ...]`
- **在 `get_fund_peer_performance()` 中追加步骤 4）**：
  - 在 `fund_nav_rows` 存在时调用 `_calc_drawdown_series`
  - 将结果写入 `series_data["fund_drawdown"]`（仅保留 `date` + `drawdown`）
  - 调用 `FundDataStore.save_drawdown_series_batch()` 持久化到 SQLite（内层 try/except 包裹，失败不抛异常）
  - 外层 try/except 记录 `console_error` 降级继续
- **导入调整**：将 `from ..storage.database import get_db_context` 改为 `from ..storage.database import FundDataStore, get_db_context`

### 3. frontend/api/fund-router.ts
- `peerPerformance` 路由使用 `ftFetch<any>(...)` 返回类型，无需修改 Zod schema；`fund_drawdown` 字段已通过 `any` 透传。

### 4. frontend/src/pages/FundDetail.tsx
- **修改 `navSeries` useMemo 降级分支**（约第 486-495 行）：
  - 新增读取 `ppDrawdown`：`peerPerformanceQ.data?.series?.fund_drawdown`
  - `ppFund.map((x, i) => ...)` 中 `dd` 从硬编码 `0` 改为 `ppDrawdown?.[i]?.drawdown ?? 0`
  - 保持与 `ppFund` 同索引对齐（假设后端 `fund_drawdown` 与 `fund` 序列一一对应）

## 编译/语法检查结果

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 前端 TypeScript | `npx tsc --noEmit` | ✅ 通过（exit 0） |
| 后端 Python 语法 | `python -m py_compile app/storage/database.py app/services/fund_service.py` | ✅ 通过（exit 0） |

## 关键设计决策

1. **索引对齐假设**：前端降级分支使用 `ppDrawdown?.[i]?.drawdown ?? 0`，依赖后端 `fund_drawdown` 与 `fund` 数组按相同日期顺序、相同长度返回。由于两者均从同一 `fund_nav_rows` 计算，该假设成立。
2. **持久化降级**：`save_drawdown_series_batch` 调用被双层 try/except 包裹，确保 SQLite 写入失败不影响 API 返回。
3. **window_days 默认值**：使用 `365` 作为默认窗口，与同类均值计算口径一致，未来可扩展支持多窗口。
