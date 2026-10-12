import { useState } from "react";
import { exportIcs } from "../../core/ics";
import type { Meeting, Requirement } from "../../core/model";
import { planBatch, type BatchResult } from "../../core/planner";
import { newId } from "../../core/store";
import { href } from "../router";
import { download, fmtMinutes, isoDate, useSessionState, useStore } from "../state";
import { bookingTitle, defaultRequirements, formRange, formWindow, RequirementsEditor, SlotCard, WhenFields, type WhenForm } from "./Match";

interface PlannerForm extends WhenForm {
  candidates: string[] | null;
  requirements: Requirement[] | null;
  cap: number;
  title: string;
}

export function PlannerPage() {
  const { state, update } = useStore();
  const tz = state.settings.timeZone;
  const [form, setForm] = useSessionState<PlannerForm>("planner", () => ({
    durationMin: state.settings.defaultDurationMin,
    bufferMin: 15,
    from: isoDate(Date.now(), tz),
    days: 7,
    windowFrom: fmtMinutes(state.settings.dayStartMin),
    windowTo: fmtMinutes(state.settings.dayEndMin),
    candidates: null,
    requirements: null,
    cap: 2,
    title: "",
  }));
  const [result, setResult] = useState<{ plan: BatchResult; meetings: Meeting[] } | null>(null);
  const [booked, setBooked] = useState(false);
  const set = (patch: Partial<PlannerForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setResult(null);
  };

  const externals = state.people.filter((p) => p.kind === "external");
  const candidates = form.candidates ?? externals.filter((p) => p.tags.includes("candidate")).map((p) => p.id);
  const requirements = form.requirements ?? defaultRequirements(state.people, false);
  const run = () => {
    setBooked(false);
    const plan = planBatch(
      {
        candidates: candidates.filter((id) => state.people.some((p) => p.id === id)),
        requirements,
        durationMin: form.durationMin,
        bufferMin: form.bufferMin,
        range: formRange(form, tz),
        dayWindow: formWindow(form),
        timeZone: tz,
        maxPerInterviewerPerDay: form.cap > 0 ? form.cap : undefined,
      },
      state.people,
      state.meetings,
    );
    // Created once so "Book all" and the .ics download share the same UIDs.
    const meetings = plan.placements.map((p) => ({
      id: newId(),
      title: bookingTitle(form.title, p.slot.attendees, state.people),
      start: p.slot.start,
      end: p.slot.end,
      attendeeIds: p.slot.attendees,
      createdAt: Date.now(),
    }));
    setResult({ plan, meetings });
  };

  if (state.people.length === 0) {
    return (
      <section className="page">
        <h1>Planner</h1>
        <div className="empty">
          <p>
            Add people first, or <a href={href("/data")}>load the demo data</a>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <h1>Interview day planner</h1>
      <p className="lead">Give every selected candidate one slot with a full panel, without double-booking anyone.</p>
      <div className="split">
        <div className="stack">
          <fieldset className="card">
            <legend>Candidates</legend>
            {externals.length === 0 ? (
              <p className="muted">
                No external people yet. Send a <a href={href("/requests")}>request link</a> or add someone as External.
              </p>
            ) : (
              <div className="checks">
                {externals.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={candidates.includes(p.id)}
                      onChange={(e) => set({ candidates: e.target.checked ? [...candidates, p.id] : candidates.filter((c) => c !== p.id) })}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="card">
            <legend>Panel for each interview</legend>
            <RequirementsEditor value={requirements} onChange={(r) => set({ requirements: r })} people={state.people.filter((p) => p.kind === "member")} />
          </fieldset>
          <fieldset className="card">
            <legend>When</legend>
            <WhenFields value={form} onChange={(w) => set(w)} />
            <div className="form-grid compact">
              <label>
                Max interviews per person per day
                <input type="number" min={0} max={12} value={form.cap} onChange={(e) => set({ cap: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <label>
                Title
                <input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Interview: candidate name" />
              </label>
            </div>
            <p className="muted small">0 means no cap. Dates and hours are in {tz.replace(/_/g, " ")}.</p>
          </fieldset>
          <button className="primary big" onClick={run} disabled={!candidates.length || !requirements.length}>
            Plan {candidates.length} {candidates.length === 1 ? "interview" : "interviews"}
          </button>
        </div>

        <div className="stack" aria-live="polite">
          {result && (
            <PlanResult
              plan={result.plan}
              meetings={result.meetings}
              booked={booked}
              onBook={() => {
                update((s) => ({ ...s, meetings: [...s.meetings, ...result.meetings] }));
                setBooked(true);
              }}
              requirements={requirements}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function PlanResult({
  plan,
  meetings,
  booked,
  onBook,
  requirements,
}: {
  plan: BatchResult;
  meetings: Meeting[];
  booked: boolean;
  onBook: () => void;
  requirements: Requirement[];
}) {
  const { state } = useStore();
  const tz = state.settings.timeZone;
  const name = (id: string) => state.people.find((p) => p.id === id)?.name ?? id;
  return (
    <>
      <div className="results-head">
        <h2>
          {plan.placements.length} placed{plan.unplaced.length ? `, ${plan.unplaced.length} not placed` : ""}
        </h2>
        {plan.placements.length > 0 && (
          <div className="actions">
            <button className="primary" disabled={booked} onClick={onBook}>
              {booked ? "Booked" : "Book all"}
            </button>
            <button onClick={() => download("slotmatch-interviews.ics", exportIcs(meetings, state.people), "text/calendar")}>
              Download .ics
            </button>
          </div>
        )}
      </div>
      {booked && (
        <p className="banner ok" role="status">
          Booked. These meetings now block the panel's time in Match and Coverage.
        </p>
      )}
      {plan.unplaced.length > 0 && (
        <div className="banner warn">
          <ul className="plain-list">
            {plan.unplaced.map((u) => (
              <li key={u.candidateId}>
                <strong>{name(u.candidateId)}</strong>: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="slots">
        {plan.placements.map((p) => (
          <SlotCard
            key={p.candidateId}
            heading={name(p.candidateId)}
            slot={p.slot}
            requirements={[{ kind: "person", id: p.candidateId }, ...requirements]}
            people={state.people}
            timeZone={tz}
          />
        ))}
      </ol>
    </>
  );
}
