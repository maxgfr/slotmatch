import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { localParts, zonedTime } from "../core/expand";
import { normalize } from "../core/intervals";
import type { Interval, Ms } from "../core/model";
import { fmtMinutes } from "./state";

/** Cell values: 0 = empty, 1 = available, 2 = preferred. */
export type Cell = 0 | 1 | 2;
type Brush = Cell;

export interface GridColumn {
  key: string;
  label: string;
  sub?: string;
}

export interface WeekGridProps {
  columns: GridColumn[];
  /** Minutes per row. */
  stepMin: number;
  /** Row count; rows start at local midnight. */
  rows: number;
  /** Column-major: index = col * rows + row. */
  value: Cell[];
  /** Omit to make the grid read-only. */
  onChange?: (next: Cell[]) => void;
  /** Cells that cannot be painted (outside the asked range…). */
  disabled?: boolean[];
  /** Cells drawn with an outline (proposed slots…). */
  highlight?: boolean[];
  /** Row scrolled into view on mount. */
  scrollToMin?: number;
  /** Accessible name of the grid. */
  label: string;
}

const LABELS: Record<Cell, string> = { 0: "empty", 1: "available", 2: "preferred" };

export function WeekGrid({ columns, stepMin, rows, value, onChange, disabled, highlight, scrollToMin, label }: WeekGridProps) {
  const id = useId();
  const readOnly = !onChange;
  const [brush, setBrush] = useState<Brush>(1);
  const [focus, setFocus] = useState(() => Math.max(0, Math.floor((scrollToMin ?? 0) / stepMin)));
  const [preview, setPreview] = useState<Cell[] | null>(null);
  const drag = useRef<{ anchor: number; paint: Cell; base: Cell[] } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const rowHeight = useRef(0);

  // Scroll to the start of the working day once.
  useEffect(() => {
    const el = scroller.current;
    if (!el || scrollToMin === undefined) return;
    const cell = el.querySelector<HTMLElement>("[data-row='0']");
    rowHeight.current = cell?.offsetHeight ?? 20;
    el.scrollTop = Math.floor(scrollToMin / stepMin) * rowHeight.current;
  }, []);

  const shown = preview ?? value;
  const cols = columns.length;
  const idx = (c: number, r: number) => c * rows + r;
  const isDisabled = (i: number) => disabled?.[i] ?? false;

  const paintRect = (base: Cell[], a: number, b: number, paint: Cell): Cell[] => {
    const [c1, c2] = [Math.floor(a / rows), Math.floor(b / rows)].sort((x, y) => x - y) as [number, number];
    const [r1, r2] = [a % rows, b % rows].sort((x, y) => x - y) as [number, number];
    const next = [...base];
    for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) if (!isDisabled(idx(c, r))) next[idx(c, r)] = paint;
    return next;
  };

  const cellAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
    if (!el || el.dataset.grid !== id) return null;
    return Number(el.dataset.cell);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (readOnly || e.button !== 0) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i === null || isDisabled(i)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Starting on a cell that already has the brush value erases instead.
    const paint: Cell = brush !== 0 && value[i] === brush ? 0 : brush;
    drag.current = { anchor: i, paint, base: value };
    setFocus(i);
    setPreview(paintRect(value, i, i, paint));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i === null) return;
    setPreview(paintRect(d.base, d.anchor, i, d.paint));
  };

  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    if (preview && onChange) onChange(preview);
    setPreview(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const c = Math.floor(focus / rows);
    const r = focus % rows;
    let next = focus;
    if (e.key === "ArrowUp") next = idx(c, Math.max(0, r - 1));
    else if (e.key === "ArrowDown") next = idx(c, Math.min(rows - 1, r + 1));
    else if (e.key === "ArrowLeft") next = idx(Math.max(0, c - 1), r);
    else if (e.key === "ArrowRight") next = idx(Math.min(cols - 1, c + 1), r);
    else if (e.key === "Home") next = idx(c, 0);
    else if (e.key === "End") next = idx(c, rows - 1);
    else if ((e.key === " " || e.key === "Enter") && onChange && !isDisabled(focus)) {
      e.preventDefault();
      const paint: Cell = brush !== 0 && value[focus] === brush ? 0 : brush;
      onChange(paintRect(value, focus, focus, paint));
      return;
    } else return;
    e.preventDefault();
    // Shift + arrow paints the cell being entered.
    if (e.shiftKey && onChange && !isDisabled(next)) onChange(paintRect(value, next, next, brush));
    setFocus(next);
    scroller.current?.querySelector<HTMLElement>(`[data-cell='${next}']`)?.focus();
  };

  return (
    <div className="weekgrid">
      {!readOnly && (
        <div className="weekgrid-tools" role="radiogroup" aria-label="Brush">
          {([1, 2, 0] as Brush[]).map((b) => (
            <label key={b} className={`brush brush-${b}`}>
              <input type="radio" name={`${id}-brush`} checked={brush === b} onChange={() => setBrush(b)} />
              <span className="swatch" aria-hidden="true" />
              {b === 0 ? "Erase" : b === 1 ? "Available" : "Preferred"}
            </label>
          ))}
          <span className="weekgrid-hint">Drag to paint a block. Arrow keys move, Space paints, Shift+arrow paints while moving.</span>
        </div>
      )}
      <div
        ref={scroller}
        className={`weekgrid-scroll${readOnly ? " is-readonly" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      >
        <div
          className="weekgrid-table"
          role="grid"
          aria-label={label}
          aria-readonly={readOnly}
          style={{ gridTemplateColumns: `3.25rem repeat(${cols}, minmax(2.75rem, 1fr))` }}
          onKeyDown={onKeyDown}
        >
          <div role="row" className="weekgrid-row weekgrid-head">
            <div role="columnheader" className="weekgrid-corner" />
            {columns.map((col) => (
              <div role="columnheader" key={col.key} className="weekgrid-colhead">
                <span>{col.label}</span>
                {col.sub && <small>{col.sub}</small>}
              </div>
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => {
            const minute = r * stepMin;
            const onHour = minute % 60 === 0;
            return (
              <div role="row" key={r} className={`weekgrid-row${onHour ? " on-hour" : ""}`}>
                <div role="rowheader" className="weekgrid-time">
                  {onHour ? fmtMinutes(minute) : <span className="sr-only">{fmtMinutes(minute)}</span>}
                </div>
                {columns.map((col, c) => {
                  const i = idx(c, r);
                  const v = shown[i] ?? 0;
                  const off = isDisabled(i);
                  return (
                    <div
                      key={col.key}
                      role="gridcell"
                      data-cell={i}
                      data-grid={id}
                      data-row={r}
                      tabIndex={i === focus ? 0 : -1}
                      aria-label={`${col.label} ${fmtMinutes(minute)}, ${off ? "unavailable" : LABELS[v]}`}
                      aria-disabled={off || undefined}
                      className={`cell v${v}${off ? " off" : ""}${highlight?.[i] ? " hl" : ""}`}
                      onFocus={() => setFocus(i)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- conversions between cells and absolute intervals ---------- */

/** Local midnights of the columns, and cell bounds in `timeZone`. */
export function cellInterval(dayMidnight: Ms, row: number, stepMin: number, timeZone: string): Interval {
  const p = localParts(dayMidnight, timeZone);
  return {
    start: zonedTime(p.year, p.month, p.day, row * stepMin, timeZone),
    end: zonedTime(p.year, p.month, p.day, (row + 1) * stepMin, timeZone),
  };
}

export function intervalsToCells(
  days: readonly Ms[],
  rows: number,
  stepMin: number,
  timeZone: string,
  available: readonly Interval[],
  preferred: readonly Interval[],
): Cell[] {
  const covers = (list: readonly Interval[], iv: Interval) => list.some((x) => x.start <= iv.start && x.end >= iv.end);
  const out: Cell[] = [];
  days.forEach((day) => {
    for (let r = 0; r < rows; r++) {
      const iv = cellInterval(day, r, stepMin, timeZone);
      out.push(covers(preferred, iv) ? 2 : covers(available, iv) ? 1 : 0);
    }
  });
  return out;
}

export function cellsToIntervals(
  days: readonly Ms[],
  rows: number,
  stepMin: number,
  timeZone: string,
  cells: readonly Cell[],
): { available: Interval[]; preferred: Interval[] } {
  const available: Interval[] = [];
  const preferred: Interval[] = [];
  days.forEach((day, c) => {
    for (let r = 0; r < rows; r++) {
      const v = cells[c * rows + r];
      if (!v) continue;
      const iv = cellInterval(day, r, stepMin, timeZone);
      available.push(iv);
      if (v === 2) preferred.push(iv);
    }
  });
  return { available: normalize(available), preferred: normalize(preferred) };
}
