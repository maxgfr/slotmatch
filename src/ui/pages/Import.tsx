import { useEffect, useMemo, useState } from "react";
import { localDays } from "../../core/expand";
import { intersect, totalDuration } from "../../core/intervals";
import type { Person } from "../../core/model";
import { applyResponse, decodeResponse, ShareError, type ShareResponse } from "../../core/share";
import { newId } from "../../core/store";
import { href, navigate } from "../router";
import { fmtDay, fmtTime, useStore } from "../state";
import { intervalsToCells, WeekGrid } from "../WeekGrid";

const STEP = 30;
const ROWS = (24 * 60) / STEP;

export function ImportPage({ data }: { data: string }) {
  const { state, update } = useStore();
  const tz = state.settings.timeZone;
  const [res, setRes] = useState<ShareResponse | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<string>("new");
  const [tags, setTags] = useState("candidate");

  useEffect(() => {
    let live = true;
    if (!data) {
      setError("No response in this link.");
      return;
    }
    decodeResponse(data)
      .then((r) => {
        if (!live) return;
        setRes(r);
        const norm = (s: string) => s.trim().toLowerCase();
        const match = state.people.find((p) => (r.email && p.email && norm(p.email) === norm(r.email)) || norm(p.name) === norm(r.name));
        if (match) setTarget(match.id);
      })
      .catch((e: unknown) => live && setError(e instanceof ShareError ? e.message : "This link could not be read."));
    return () => {
      live = false;
    };
    // Only decode once per link; matching uses the people known at that moment.
  }, [data]);

  const days = useMemo(() => (res ? localDays(res.range, tz) : []), [res, tz]);
  const cells = useMemo(
    () => (res ? intervalsToCells(days, ROWS, STEP, tz, res.available, res.preferred) : []),
    [res, days, tz],
  );

  if (error) {
    return (
      <section className="page narrow">
        <h1>This answer cannot be imported</h1>
        <p>{error}</p>
        <p>
          <a href={href("/requests")}>Back to requests</a>
        </p>
      </section>
    );
  }
  if (!res) return <p className="page muted">Reading the answer…</p>;

  const doImport = () => {
    const existing = state.people.find((p) => p.id === target);
    const base: Person = existing ?? {
      id: newId(),
      name: res.name,
      kind: "external",
      tags: [...new Set(tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))],
      timeZone: res.timeZone,
      weekly: [],
      exceptions: [],
      busy: [],
      ...(res.email ? { email: res.email } : {}),
    };
    const person = applyResponse(base, res);
    update((s) => ({
      ...s,
      people: existing ? s.people.map((p) => (p.id === person.id ? person : p)) : [...s.people, person],
    }));
    navigate(`/people/${person.id}`);
  };

  const hours = totalDuration(res.available) / 3_600_000;
  const byDay = days
    .map((d, i) => {
      const next = days[i + 1] ?? res.range.end;
      return { d, list: intersect(res.available, [{ start: d, end: next }]) };
    })
    .filter((x) => x.list.length);

  return (
    <section className="page">
      <h1>Answer from {res.name}</h1>
      <p className="lead">
        {res.title ? `For “${res.title}”. ` : ""}
        {hours} h free between {fmtDay(res.range.start, tz)} and {fmtDay(res.range.end - 1, tz)}. They are in {res.timeZone.replace(/_/g, " ")}; times below
        are in yours ({tz.replace(/_/g, " ")}).
      </p>

      <div className="split wide-left">
        <WeekGrid label={`Availability of ${res.name}`} columns={days.map((d) => ({ key: String(d), label: fmtDay(d, tz) }))} stepMin={STEP} rows={ROWS} value={cells} scrollToMin={state.settings.dayStartMin} />

        <div className="stack">
          <fieldset className="card stack">
            <legend>Save as</legend>
            <label>
              Person
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">New person: {res.name}</option>
                {state.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    Update {p.name}
                  </option>
                ))}
              </select>
            </label>
            {target === "new" ? (
              <label>
                Tags
                <input value={tags} onChange={(e) => setTags(e.target.value)} />
              </label>
            ) : (
              <p className="muted small">Their earlier answers inside this range are replaced. Busy times and weekly hours stay.</p>
            )}
            <button className="primary" onClick={doImport}>
              {target === "new" ? "Add person" : "Update person"}
            </button>
          </fieldset>
          <section className="card">
            <h2 className="h3">Free times</h2>
            <ul className="plain-list">
              {byDay.map(({ d, list }) => (
                <li key={d}>
                  <strong>{fmtDay(d, tz)}</strong>: {list.map((iv) => `${fmtTime(iv.start, tz)}–${fmtTime(iv.end, tz)}`).join(", ")}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </section>
  );
}
