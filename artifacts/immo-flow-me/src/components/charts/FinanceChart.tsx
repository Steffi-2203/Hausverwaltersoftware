import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  Legend,
} from 'recharts';

const formatEur = (value: number): string =>
  value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });

const formatPercent = (value: number): string =>
  `${value.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const INCOME_COLORS = ['#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d'];
const EXPENSE_COLORS = ['#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'];

interface RevenueTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

function RevenueTooltip({ active, payload, label }: RevenueTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover p-3 text-popover-foreground shadow-md text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatEur(entry.value)}
        </p>
      ))}
    </div>
  );
}

interface PaymentTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

function PaymentTooltip({ active, payload, label }: PaymentTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover p-3 text-popover-foreground shadow-md text-sm">
      <p className="font-medium mb-1">{label}</p>
      <p style={{ color: payload[0].color }}>{formatPercent(payload[0].value)}</p>
    </div>
  );
}

interface PieTooltipProps {
  active?: boolean;
  payload?: any[];
}

function PieLabelTooltip({ active, payload }: PieTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover p-3 text-popover-foreground shadow-md text-sm">
      <p className="font-medium">{payload[0].name}</p>
      <p>{formatEur(payload[0].value)}</p>
    </div>
  );
}

export function MonthlyRevenueChart({
  data,
}: {
  data: { month: string; income: number; expenses: number }[];
}) {
  return (
    <div data-testid="chart-monthly-revenue" aria-label="Monatliche Einnahmen und Ausgaben">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="month"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${(v / 1000).toLocaleString('de-AT')}k`}
          />
          <Tooltip content={<RevenueTooltip />} />
          <Bar dataKey="income" name="Einnahmen" fill="#4ade80" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" name="Ausgaben" fill="#f87171" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaymentRateChart({
  data,
}: {
  data: { month: string; rate: number }[];
}) {
  return (
    <div data-testid="chart-payment-rate" aria-label="Mieteingangsquote">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="month"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<PaymentTooltip />} />
          <Area
            type="monotone"
            dataKey="rate"
            name="Quote"
            stroke="#22c55e"
            fill="#22c55e"
            fillOpacity={0.2}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const renderPieLabel = ({
  name,
  percent,
}: {
  name: string;
  percent: number;
}) => {
  if (percent < 0.05) return null;
  return `${name} ${(percent * 100).toFixed(0)}%`;
};

export function CategoryPieChart({
  data,
  type,
}: {
  data: { name: string; value: number }[];
  type: 'income' | 'expense';
}) {
  const colors = type === 'income' ? INCOME_COLORS : EXPENSE_COLORS;

  return (
    <div
      data-testid={`chart-category-${type}`}
      aria-label={type === 'income' ? 'Einnahmen nach Kategorie' : 'Ausgaben nach Kategorie'}
    >
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            label={renderPieLabel}
            labelLine={false}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<PieLabelTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function getEsgColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

export function EsgScoreChart({ score }: { score: number }) {
  const color = getEsgColor(score);
  const chartData = [{ name: 'ESG', value: score, fill: color }];

  return (
    <div data-testid="chart-esg-score" aria-label={`ESG Score: ${score} von 100`}>
      <ResponsiveContainer width="100%" height={250}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="60%"
          outerRadius="90%"
          startAngle={180}
          endAngle={0}
          barSize={16}
          data={chartData}
        >
          <RadialBar
            dataKey="value"
            cornerRadius={8}
            background={{ fill: 'hsl(var(--muted))' }}
          />
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground"
            style={{ fontSize: '2rem', fontWeight: 700 }}
          >
            {score}
          </text>
          <text
            x="50%"
            y="62%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            style={{ fontSize: '0.75rem' }}
          >
            von 100
          </text>
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}
