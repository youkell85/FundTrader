/** 格式化百分比 */
export function formatPercent(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined) return '--'
  const num = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(num)) return '--'
  return num >= 0 ? `+${num.toFixed(digits)}%` : `${num.toFixed(digits)}%`
}

/** 格式化金额 */
export function formatAmount(val: number | null | undefined): string {
  if (val === null || val === undefined) return '--'
  if (val >= 100000000) return `${(val / 100000000).toFixed(2)}亿`
  if (val >= 10000) return `${(val / 10000).toFixed(2)}万`
  return val.toFixed(2)
}

/** 涨跌颜色类 */
export function getChangeColor(val: number | null | undefined): string {
  if (val === null || val === undefined) return 'text-text-secondary'
  const num = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(num) || num === 0) return 'text-text-secondary'
  return num > 0 ? 'text-rise' : 'text-fall'
}

/** 信号颜色 */
export function getSignalColor(signal: string): string {
  const map: Record<string, string> = {
    '买入': 'text-rise bg-rise/10 border-rise/20',
    '持有': 'text-warn bg-warn/10 border-warn/20',
    '赎回': 'text-fall bg-fall/10 border-fall/20',
  }
  return map[signal] || 'text-text-secondary bg-bg-input border-white/5'
}

/** 风险等级颜色 */
export function getRiskColor(level: string): string {
  const map: Record<string, string> = {
    '保守': 'text-info bg-info/10',
    '稳健': 'text-primary bg-primary/10',
    '积极': 'text-warn bg-warn/10',
    '激进': 'text-rise bg-rise/10',
  }
  return map[level] || 'text-text-secondary bg-bg-input'
}
