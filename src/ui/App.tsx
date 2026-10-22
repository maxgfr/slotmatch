import { CalendarPage } from "./pages/Calendar";
import { CalendarViewPage } from "./pages/CalendarView";
import { CoveragePage } from "./pages/Coverage";
import { ImportPage } from "./pages/Import";
import { MatchPage } from "./pages/Match";
import { PeoplePage } from "./pages/People";
import { PersonEditPage } from "./pages/PersonEdit";
import { PlannerPage } from "./pages/Planner";
import { RequestsPage } from "./pages/Requests";
import { RespondPage } from "./pages/Respond";
import { SettingsPage } from "./pages/Settings";
import { href, useRoute } from "./router";
import { StoreProvider, useStore } from "./state";
import { applyUpdate, useUpdateStatus } from "./update";

const NAV = [
  { path: "people", label: "People" },
  { path: "match", label: "Match" },
  { path: "coverage", label: "Coverage" },
  { path: "calendar", label: "Calendar" },
  { path: "planner", label: "Planner" },
  { path: "requests", label: "Requests" },
  { path: "settings", label: "Settings" },
];

function Shell() {
  const route = useRoute();
  const { state, saved, preservedAs } = useStore();
  const { status } = useUpdateStatus();
  const section = route.path[0] === "data" ? "settings" : (route.path[0] ?? "people");

  let page;
  switch (section) {
    case "people":
      page = route.path[1] ? <PersonEditPage key={route.path[1]} id={route.path[1]} /> : <PeoplePage />;
      break;
    case "match":
      page = <MatchPage />;
      break;
    case "coverage":
      page = <CoveragePage />;
      break;
    case "calendar":
      page = <CalendarPage />;
      break;
    case "planner":
      page = <PlannerPage />;
      break;
    case "requests":
      page = <RequestsPage />;
      break;
    case "import":
      page = <ImportPage key={route.params.get("d") ?? ""} data={route.params.get("d") ?? ""} />;
      break;
    case "settings":
    case "data": // old links
      page = <SettingsPage />;
      break;
    default:
      page = (
        <section className="page">
          <h1>Page not found</h1>
          <p>
            <a href={href("/people")}>Back to people</a>
          </p>
        </section>
      );
  }

  return (
    <div className="app">
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href={href("/people")}>
          <span className="brand-mark" aria-hidden="true" />
          slotmatch
        </a>
        <nav aria-label="Main">
          <ul>
            {NAV.map((n) => (
              <li key={n.path}>
                <a href={href(`/${n.path}`)} aria-current={section === n.path ? "page" : undefined}>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a className="tz-chip" href={href("/settings")} title="Display time zone (change in Settings)">
          {state.settings.timeZone.replace(/_/g, " ")}
        </a>
      </header>
      {status?.state === "available" && (
        <p className="banner" role="status">
          A newer version of slotmatch is online. Your data stays in this browser.{" "}
          <button className="link" onClick={() => void applyUpdate()}>
            Update now
          </button>{" "}
          · <a href={href("/settings")}>Details</a>
        </p>
      )}
      {!saved && (
        <p className="banner warn" role="alert">
          Changes cannot be saved in this browser (storage is full or blocked). Export a backup from Settings.
        </p>
      )}
      {preservedAs && (
        <p className="banner warn" role="alert">
          Data saved earlier in this browser could not be read, so slotmatch started empty. The old data was kept in localStorage under
          “{preservedAs}”.
        </p>
      )}
      <main id="main" tabIndex={-1}>
        {page}
      </main>
    </div>
  );
}

function Router() {
  const route = useRoute();
  // The respondent's page stands alone: no navigation, no access to local data.
  if (route.path[0] === "respond") return <RespondPage key={route.params.get("d") ?? ""} data={route.params.get("d") ?? ""} />;
  // A shared calendar is read-only; local data is only touched if the viewer imports it.
  if (route.path[0] === "calendar-view") return <CalendarViewPage key={route.params.get("d") ?? ""} data={route.params.get("d") ?? ""} />;
  return <Shell />;
}

export function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
