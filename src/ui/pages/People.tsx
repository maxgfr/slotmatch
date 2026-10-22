import { useMemo, useState } from "react";
import { absentNow } from "../../core/calendar";
import { localParts } from "../../core/expand";
import type { Person } from "../../core/model";
import { demoState } from "../../core/store";
import { href, navigate } from "../router";
import { allTags, fmtDate, fmtTime, useStore } from "../state";

function weeklyHours(p: Person): number {
  return p.weekly.reduce((s, b) => s + (b.endMin - b.startMin), 0) / 60;
}

export function PeoplePage() {
  const { state, update } = useStore();
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState<"" | Person["kind"]>("");
  const [q, setQ] = useState("");
  const tags = allTags(state.people);
  const now = Date.now();

  const people = useMemo(
    () =>
      state.people
        .filter((p) => (!tag || p.tags.includes(tag)) && (!kind || p.kind === kind))
        .filter((p) => !q || `${p.name} ${p.email ?? ""} ${p.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.people, tag, kind, q],
  );

  if (state.people.length === 0) {
    return (
      <section className="page">
        <h1>People</h1>
        <div className="empty">
          <h2>Nobody here yet</h2>
          <p>
            Add the people whose time you want to match: colleagues with their weekly hours, candidates, clients. Everything stays in this
            browser.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => navigate("/people/new")}>
              Add a person
            </button>
            <button onClick={() => update((s) => ({ ...demoState(Date.now(), s.settings.timeZone), settings: s.settings }))}>
              Load demo data
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>People</h1>
        <button className="primary" onClick={() => navigate("/people/new")}>
          Add a person
        </button>
      </div>

      <div className="filters" role="search">
        <label>
          Search
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or tag" />
        </label>
        <label>
          Tag
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">Everyone</option>
            <option value="member">Members</option>
            <option value="external">External</option>
          </select>
        </label>
      </div>

      <p className="muted" aria-live="polite">
        {people.length} of {state.people.length} {state.people.length === 1 ? "person" : "people"}
      </p>

      <ul className="people-list">
        {people.map((p) => {
          const local = localParts(now, p.timeZone);
          const hours = weeklyHours(p);
          const answers = p.exceptions.filter((x) => x.kind !== "busy" && x.end > now).length;
          const away = absentNow(p, now);
          return (
            <li key={p.id}>
              <a className="person-row" href={href(`/people/${p.id}`)}>
                <span className="avatar" aria-hidden="true" data-kind={p.kind}>
                  {p.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="person-main">
                  <strong>{p.name}</strong>
                  <span className="tags">
                    <span className={`badge kind-${p.kind}`}>{p.kind === "member" ? "Member" : "External"}</span>
                    {p.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="person-meta">
                  <span>
                    {p.timeZone.replace(/_/g, " ")} · {fmtTime(now, p.timeZone)}
                    {local.weekday > 4 ? " (weekend)" : ""}
                  </span>
                  <span className="muted">
                    {hours ? `${hours} h/week` : answers ? `${answers} upcoming time ranges` : "No availability yet"}
                    {p.busy.length ? ` · ${p.busy.length} calendar events` : ""}
                  </span>
                  {away && (
                    <span>
                      <span className={`badge abs-${away.kind}`}>
                        Away until {fmtDate(away.to)}
                        {away.toAm ? " noon" : ""}
                      </span>
                    </span>
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
