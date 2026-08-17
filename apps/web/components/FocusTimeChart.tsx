import type { FocusTimeByDay } from "@/app/(app)/analytics/actions";

// Inline SVG — 7 bars doesn't warrant a charting dependency (plan.md's
// Design decisions).
const BAR_WIDTH = 32;
const BAR_GAP = 12;
const CHART_HEIGHT = 120;
const LABEL_HEIGHT = 20;

export function FocusTimeChart({ byDay }: { byDay: FocusTimeByDay[] }) {
  const maxMinutes = Math.max(1, ...byDay.map((day) => day.minutes));
  const width = byDay.length * (BAR_WIDTH + BAR_GAP);

  return (
    <svg
      width={width}
      height={CHART_HEIGHT + LABEL_HEIGHT}
      role="img"
      aria-label={`Focus minutes per day for the last ${byDay.length} days`}
    >
      {byDay.map((day, index) => {
        const barHeight = (day.minutes / maxMinutes) * CHART_HEIGHT;
        const x = index * (BAR_WIDTH + BAR_GAP);
        const y = CHART_HEIGHT - barHeight;
        const label = day.date.slice(5); // MM-DD

        return (
          <g key={day.date}>
            <title>
              {day.date}: {day.minutes} min
            </title>
            <rect x={x} y={y} width={BAR_WIDTH} height={Math.max(barHeight, 1)} fill="currentColor" />
            <text
              x={x + BAR_WIDTH / 2}
              y={CHART_HEIGHT + 14}
              textAnchor="middle"
              fontSize="10"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
