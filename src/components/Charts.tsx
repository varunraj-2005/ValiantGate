import React, { useState } from 'react';
import type { SlidingWindowSnapshot, TimeSeriesPoint } from '../../backend/types.ts';

interface SeriesDef {
  key: keyof TimeSeriesPoint;
  label: string;
  color: string;
}

interface LineChartProps {
  data: TimeSeriesPoint[];
  series: SeriesDef[];
  unit?: string;
  height?: number;
  yMaxOverride?: number;
}

export const TimeSeriesChart: React.FC<LineChartProps> = ({
  data,
  series,
  unit = '',
  height = 200,
  yMaxOverride,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 640;
  const padLeft = 42;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center border border-dashed border-slate-200 rounded-md text-xs text-slate-500"
        style={{ height }}
      >
        Awaiting live telemetry samples...
      </div>
    );
  }

  let maxVal = yMaxOverride ?? 1;
  if (yMaxOverride === undefined) {
    for (const pt of data) {
      for (const s of series) {
        const v = Number(pt[s.key] ?? 0);
        if (v > maxVal) maxVal = v;
      }
    }
    maxVal = Math.max(1, Math.ceil(maxVal * 1.15));
  }

  const getX = (idx: number) =>
    data.length <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (data.length - 1)) * plotW;
  const getY = (val: number) =>
    padTop + plotH - Math.min(1, Math.max(0, val / maxVal)) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    y: padTop + plotH - frac * plotH,
    val: Math.round(maxVal * frac),
  }));

  const hoveredPoint = hoverIdx !== null && data[hoverIdx] ? data[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          {series.map((s) => (
            <span key={String(s.key)} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-0.5 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
        {hoveredPoint && (
          <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-700">
            <span className="text-slate-500">{hoveredPoint.label}</span>
            {series.map((s) => (
              <span key={String(s.key)} style={{ color: s.color }}>
                {s.label}: {Number(hoveredPoint[s.key] ?? 0).toFixed(1)}
                {unit}
              </span>
            ))}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((t) => (
          <g key={t.val}>
            <line
              x1={padLeft}
              y1={t.y}
              x2={width - padRight}
              y2={t.y}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text
              x={padLeft - 6}
              y={t.y + 3}
              textAnchor="end"
              className="fill-slate-400 text-[10px] font-mono"
            >
              {t.val}
              {unit}
            </text>
          </g>
        ))}

        {series.map((s) => {
          const d = data
            .map((pt, idx) => {
              const x = getX(idx);
              const y = getY(Number(pt[s.key] ?? 0));
              return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(' ');
          return (
            <path
              key={String(s.key)}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {hoverIdx !== null && data[hoverIdx] && (
          <line
            x1={getX(hoverIdx)}
            y1={padTop}
            x2={getX(hoverIdx)}
            y2={padTop + plotH}
            stroke="#94a3b8"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
        )}

        {/* X-axis edge labels */}
        {data.length > 0 && (
          <>
            <text
              x={padLeft}
              y={height - 6}
              textAnchor="start"
              className="fill-slate-400 text-[10px] font-mono"
            >
              {data[0].label}
            </text>
            <text
              x={width - padRight}
              y={height - 6}
              textAnchor="end"
              className="fill-slate-400 text-[10px] font-mono"
            >
              {data[data.length - 1].label}
            </text>
          </>
        )}

        {/* Invisible hover columns */}
        {data.map((_, idx) => {
          const x = getX(idx);
          const colW = Math.max(6, plotW / Math.max(1, data.length));
          return (
            <rect
              key={idx}
              x={x - colW / 2}
              y={padTop}
              width={colW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          );
        })}
      </svg>
    </div>
  );
};

interface StatusCodeChartProps {
  statusCodes: Record<string, number>;
}

const CODE_DESCRIPTIONS: Record<string, { label: string; color: string }> = {
  '200': { label: 'OK', color: '#16a34a' },
  '201': { label: 'Created', color: '#15803d' },
  '400': { label: 'Bad Req', color: '#d97706' },
  '401': { label: 'Unauth', color: '#d97706' },
  '403': { label: 'Forbidden', color: '#ea580c' },
  '404': { label: 'Not Found', color: '#64748b' },
  '429': { label: 'Rate Limited', color: '#dc2626' },
  '500': { label: 'Server Err', color: '#b91c1c' },
  '503': { label: 'Unavailable', color: '#991b1b' },
};

export const StatusCodeBarChart: React.FC<StatusCodeChartProps> = ({ statusCodes }) => {
  const entries = Object.entries(CODE_DESCRIPTIONS).map(([code, meta]) => ({
    code,
    label: meta.label,
    color: meta.color,
    count: statusCodes[code] ?? 0,
  }));

  const maxCount = Math.max(1, ...entries.map((e) => e.count));

  return (
    <div className="space-y-2.5">
      {entries.map((item) => {
        const pct = (item.count / maxCount) * 100;
        return (
          <div key={item.code} className="grid grid-cols-[88px_1fr_52px] items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 font-mono tabular-nums text-slate-700">
              <span className="font-semibold">{item.code}</span>
              <span className="text-slate-400 text-[11px] truncate">{item.label}</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm transition-all duration-200"
                style={{
                  width: `${item.count > 0 ? Math.max(2, pct) : 0}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
            <div className="text-right font-mono tabular-nums text-slate-700">
              {item.count.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const SlidingWindowChart: React.FC<{ snapshot: SlidingWindowSnapshot }> = ({
  snapshot,
}) => {
  const windowMs = snapshot.windowSeconds * 1000;
  const now = snapshot.nowMs;
  const start = now - windowMs;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
        <span>t - {snapshot.windowSeconds}s (Expiring edge)</span>
        <span>Current window ({snapshot.inWindowCount}/{snapshot.limit} slots)</span>
        <span>Now (t = 0s)</span>
      </div>

      <div className="relative h-16 bg-slate-50 border border-slate-200 rounded-md overflow-hidden px-2">
        {/* Vertical quarter gridlines */}
        {[0.25, 0.5, 0.75].map((pos) => (
          <div
            key={pos}
            className="absolute top-0 bottom-0 border-l border-dashed border-slate-200"
            style={{ left: `${pos * 100}%` }}
          />
        ))}

        {/* Timestamps inside active window */}
        {snapshot.timestamps.map((ts, idx) => {
          const pct = Math.min(99, Math.max(1, ((ts - start) / Math.max(1, windowMs)) * 100));
          const ageSec = ((now - ts) / 1000).toFixed(1);
          const nearExpiry = pct < 18;
          return (
            <div
              key={`${ts}-${idx}`}
              title={`Request at -${ageSec}s`}
              className={`absolute top-3 bottom-3 w-1.5 rounded-sm transition-all ${
                nearExpiry ? 'bg-amber-500' : 'bg-blue-600'
              }`}
              style={{ left: `${pct}%` }}
            />
          );
        })}

        {snapshot.timestamps.length === 0 && (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">
            No active request timestamps inside the current {snapshot.windowSeconds}s window
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>Blue bars: Active requests inside window</span>
        <span>Amber bars: Requests about to slide out and expire</span>
      </div>
    </div>
  );
};
