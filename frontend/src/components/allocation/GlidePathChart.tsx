import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import type { GlidePathPoint } from '@/types/lifecycle'

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '-'
  return `${(value * 100).toFixed(0)}%`
}

export default function GlidePathChart({ points }: { points: GlidePathPoint[] }) {
  const data = points.map((point) => ({
    age: point.age,
    equity: point.equity_weight,
    bond: point.bond_weight,
    cash: point.cash_weight,
  }))

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis dataKey="age" tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={pct} domain={[0, 1]} tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(value: number) => pct(value)}
            labelFormatter={(label) => `Age ${label}`}
            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid rgba(255,255,255,0.08)', color: 'hsl(var(--popover-foreground))' }}
          />
          <Line type="monotone" dataKey="equity" name="Equity" stroke="#38bdf8" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="bond" name="Bond" stroke="#a3e635" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="cash" name="Cash" stroke="#fbbf24" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
