# slotmatch

Find meeting times that work for a group of people across time zones, with panel rules. It runs entirely in the browser: no account and no backend. Everything is stored in `localStorage`, and data moves between people only inside share links.

Live (once published): https://maxgfr.github.io/slotmatch/

## Features

- **People.** Anyone can be added: colleagues (`member`) or candidates, clients and other outsiders (`external`), with free-form tags such as `engineering`, `hr` or `candidate`. Each person has their own time zone, weekly hours painted on a grid (available or preferred), one-off exceptions, absences, and busy times imported from an `.ics` file.
- **Absences.** Vacation, sick leave or other days away, from one date to another in the person's own zone, with half days: afternoon only on the first day, morning only on the last (noon is the boundary). Match, Coverage and the planner skip them.
- **Match.** Describe who must attend:
  - a specific person;
  - *k* people with a tag ("1 engineering + 1 hr");
  - *k* people out of a hand-picked group.

  slotmatch scans every 15 minutes (configurable), and never uses one person to fill two rules. Each slot shows an explainable score:
  - the share of preferred time;
  - the part of the day;
  - fairness (interviewers with fewer meetings that week are swapped in);
  - how soon it is.

  Results can be booked or downloaded as `.ics`.
- **Coverage.** A weekly heatmap of how many people are free each half hour, with a minimum-staff slider and a list of the gaps. It can be filtered by tag.
- **Team calendar.** A month view of everyone's absences and booked meetings, filtered by tag, with a list of who is away and a form to add an absence for anyone. On a phone it reads as an agenda.
- **Shared calendar.** A read-only link (`…#/calendar-view?d=…`) for one, three or six months: names, tags, absences and meeting titles, never weekly hours, exceptions or imported calendars. The page stands alone; a colleague can import it, which matches people by email then name, creates the missing ones, and adds absences and meetings by id (importing twice changes nothing). The same period downloads as one `.ics` file with meetings, all-day absences and timed half days.
- **Interview day planner.** Gives every selected candidate one slot with a full panel, without double-booking anyone and within a daily cap per interviewer. It places the most constrained candidate first and backtracks when it hits a dead end. Anyone it cannot place is listed with the reason.
- **Calendar files.** Import reads Google, Outlook and Apple exports:
  - times in UTC, with `TZID` (including Windows zone names) or all-day;
  - `DURATION`;
  - daily and weekly `RRULE` with `INTERVAL`, `BYDAY`, `COUNT` and `UNTIL`;
  - `EXDATE` and moved occurrences (`RECURRENCE-ID`).

  Free and cancelled events are ignored. Export writes standard `VEVENT`s with attendees, and absences as all-day (or, for half days, timed) busy events.
- **Backup.** JSON export and import (merge or replace), demo data, and reset.

## Asking an outsider for their availability

1. **Requests:** choose the dates and the meeting length, then create a link and send it to them.
2. They open `…#/respond?d=…`. The page stands alone and never sees your data. They paint their free time in their own time zone and create an answer link.
3. They send the answer back. Opening `…#/import?d=…` in your browser (or pasting it into Requests) shows a preview. You then add them as a new person or update an existing one.

Calendar links (`#/calendar-view`) use the same format. Links carry JSON compressed with `deflate-raw` and encoded in base64url. Intervals are stored as minute offsets, so a busy week stays well under 2,000 characters. Damaged links, links of the wrong kind and links with an unknown version are rejected with a clear message.

## Data model

All instants are UTC epoch milliseconds, and every interval is half-open: `[start, end)`.

| Type | Shape |
| --- | --- |
| `Person` | `id, name, email?, kind: member \| external, tags[], timeZone, weekly[], exceptions[], busy[], absences[]` |
| `WeeklyBlock` | `day` (0 = Monday), `startMin`, `endMin`, `level: available \| preferred`, in the person's zone |
| `AvailabilityException` | `start, end, kind: available \| preferred \| busy, note?` |
| `Absence` | `id, kind: vacation \| sick \| other, from, to` (`YYYY-MM-DD`, inclusive, in the person's zone), `fromPm?, toAm?, note?` |
| `Meeting` | `id, title, start, end, attendeeIds[]` |
| `Requirement` | `{kind: person, id}` · `{kind: tag, tag, count}` · `{kind: anyOf, ids, count}` |

Weekly blocks are expanded day by day in the person's zone, so 09:00 stays 09:00 across DST changes. Absences are stored as dates for the same reason. The browser stores `{ version, people, meetings, settings }` under `localStorage["slotmatch:v1"]`. Older or damaged data is migrated or dropped, and never crashes the app.

## Code

```
src/core/   pure TypeScript, no DOM, covered by bun test
  intervals.ts  interval algebra          expand.ts   people → UTC intervals (time zones, DST)
  match.ts      slots + panel assignment  score.ts    ranking with breakdown
  coverage.ts   heatmap and gaps          planner.ts  batch interview planning
  ics.ts        .ics import/export        share.ts    request/answer/calendar links
  calendar.ts   dates, absences, months   store.ts    persistence, migration, backup, demo
src/ui/     React 19: hash router, pages, WeekGrid (mouse, touch and keyboard painting), MonthCalendar
```

## Commands

```sh
bun install
bun run dev          # dev server with hot reload
bun test             # unit tests
bun run typecheck    # tsc --noEmit
bun run build        # production build into dist/ (relative asset paths)
bun run preview      # serve dist/ under /slotmatch/ like GitHub Pages (PORT=4173)
bun scripts/preview.ts --check   # start, check index and every asset answer 200, stop
```

## Publish

The workflow `.github/workflows/pages.yml` tests, typechecks, builds and deploys on every push to `main`. It has not been run yet. To publish:

```sh
gh repo create maxgfr/slotmatch --public --source . --push
gh api -X POST repos/maxgfr/slotmatch/pages -f build_type=workflow
```

## Limits

- Repeats other than daily and weekly (monthly, yearly) are imported once, with a warning.
- Data lives in one browser. Use the JSON backup to move it.
- The grid paints in 30-minute cells; matching runs at 15-minute precision.
