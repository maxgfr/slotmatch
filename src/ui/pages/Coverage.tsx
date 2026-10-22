import { useMemo, useState, type CSSProperties } from "react";
import { coverage, gaps, type CoverageCell } from "../../core/coverage";
import { localDays, localParts, startOfLocalWeek, zonedTime } from "../../core/expand";
import { DAY, MINUTE } from "../../core/model";
import { href } from "../router";
import { allTags, fmtDay, fmtMinutes, fmtSlot, fmtTime, useSessionState, useStore } from "../state";

const STEP = 30;

export function CoveragePage() {
  const { state } = useStore();
  const tz = state.settings.timeZone;
  const [opts, setOpts] = useSessionState("coverage", () => ({ week: 0, tag: "", minStaff: 2, weekdaysOnly: true }));
  const [selected, setSelected] = useState<CoverageCell | null>(null);
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));
  const { dayStartMin, dayEndMin } = state.settings;

  const view = useMemo(() => {
    const start = startOfLocalWeek(Date.now() + opts.week * 7 * DAY, tz);
    const p = localParts(start, tz);
    const range = { start, end: zonedTime(p.year, p.month, p.day + 7, 0, tz) };
    const cov = coverage(state.people, range, STEP, { meetings: state.meetings, tag: opts.tag || undefined });
    const days = localDays(range, tz);
    const visible = (c: CoverageCell) => {
      const lp = localParts(c.start, tz);
      return lp.minutes >= dayStartMin && lp.minutes + STEP <= dayEndMin && (!opts.weekdaysOnly || lp.weekday < 5);
    };
    const holes = gaps(cov, opts.minStaff, visible);
    const firstRow = Math.floor(dayStartMin / STEP);
    const rowCount = Math.max(1, Math.ceil(dayEndMin / STEP) - firstRow);
    const grid = days.map((day) => {
      const dp = localParts(day, tz);
      return Array.from({ length: rowCount }, (_, r) => {
        const t = zonedTime(dp.year, dp.month, dp.day, (firstRow + r) * STEP, tz);
        const cell = cov.cells[Math.round((t - range.start) / (STEP * MINUTE))];
        return cell && cell.start === t ? cell : undefined;
      });
    });
    return { range, cov, days, holes, grid, firstRow, rowCount, visible };
  }, [state.people, state.meetings, tz, opts, dayStartMin, dayEndMin]);

  const total = view.cov.people.length;
  const tags = allTags(state.people);
  const name = (id: string) => state.people.find((p) => p.id === id)?.name ?? id;

  if (state.people.length === 0) {
    return (
      <section className="page">
        <h1>Coverage</h1>
        <div className="empty">
          <p>
            Add people first, or <a href={href("/settings")}>load the demo data</a>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>Coverage</h1>
        <div className="actions" role="group" aria-label="Week">
          <button onClick={() => set({ week: opts.week - 1 })} aria-label="Previous week">
            ←
          </button>
          <span className="week-label">
            {fmtDay(view.range.start, tz)} – {fmtDay(view.range.end - 1, tz)}
          </span>
          <button onClick={() => set({ week: opts.week + 1 })} aria-label="Next week">
            →
          </button>
          {opts.week !== 0 && <button onClick={() => set({ week: 0 })}>This week</button>}
        </div>
      </div>

      <div className="filters">
        <label>
          Who
          <select value={opts.tag} onChange={(e) => set({ tag: e.target.value })}>
            <option value="">Everyone</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                Tag: {t}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Minimum staff <output>{opts.minStaff}</output>
          <input type="range" min={0} max={Math.max(1, total)} value={opts.minStaff} onChange={(e) => set({ minStaff: Number(e.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.weekdaysOnly} onChange={(e) => set({ weekdaysOnly: e.target.checked })} />
          Weekdays only
        </label>
      </div>

      <div className="legend" aria-hidden="true">
        <span>
          <i className="heat" style={{ "--level": 0 } as CSSProperties} /> nobody
        </span>
        <span>
          <i className="heat" style={{ "--level": 1 } as CSSProperties} /> all {total}
        </span>
        <span>
          <i className="heat gap" /> below {opts.minStaff}
        </span>
      </div>

      <div className="split wide-left">
        <div className="heatmap-scroll">
          <table className="heatmap">
            <caption className="sr-only">
              Free people per half hour, {tz}. Cells below the minimum are marked as gaps.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="corner" />
                {view.days.map((d) => (
                  <th scope="col" key={d}>
                    {fmtDay(d, tz)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: view.rowCount }, (_, r) => {
                const minute = (view.firstRow + r) * STEP;
                return (
                  <tr key={r} className={minute % 60 === 0 ? "on-hour" : undefined}>
                    <th scope="row">{minute % 60 === 0 ? fmtMinutes(minute) : <span className="sr-only">{fmtMinutes(minute)}</span>}</th>
                    {view.grid.map((col, c) => {
                      const cell = col[r];
                      if (!cell) return <td key={c} className="heat-cell none" />;
                      const isGap = cell.count < opts.minStaff && view.visible(cell);
                      return (
                        <td key={c} className="heat-cell">
                          <button
                            className={`heat${isGap ? " gap" : ""}${selected?.start === cell.start ? " selected" : ""}`}
                            style={{ "--level": total ? cell.count / total : 0 } as CSSProperties}
                            aria-label={`${fmtDay(cell.start, tz)} ${fmtTime(cell.start, tz)}: ${cell.count} free${isGap ? ", below minimum" : ""}`}
                            title={`${cell.count} free${cell.ids.length ? `: ${cell.ids.map(name).join(", ")}` : ""}`}
                            onClick={() => setSelected(cell)}
                          >
                            {cell.count || ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="stack">
          {selected && (
            <section className="card" aria-live="polite">
              <h2 className="h3">{fmtSlot(selected.start, selected.end, tz)}</h2>
              {selected.ids.length ? (
                <ul className="plain-list">
                  {selected.ids.map((id) => (
                    <li key={id}>
                      {name(id)} {selected.preferredIds.includes(id) && <span className="badge ex-preferred">preferred</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Nobody is free.</p>
              )}
            </section>
          )}
          <section className="card">
            <h2 className="h3">Gaps</h2>
            <p className="muted small">
              Under {opts.minStaff} free between {fmtMinutes(dayStartMin)} and {fmtMinutes(dayEndMin)}
              {opts.weekdaysOnly ? " on weekdays" : ""}. Visible hours are set in <a href={href("/settings")}>Settings</a>.
            </p>
            {view.holes.length ? (
              <ul className="plain-list gaps">
                {view.holes.map((g) => (
                  <li key={g.start}>{fmtSlot(g.start, g.end, tz)}</li>
                ))}
              </ul>
            ) : (
              <p className="ok-text">No gaps this week.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
