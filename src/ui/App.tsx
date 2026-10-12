import { CoveragePage } from "./pages/Coverage";
import { DataPage } from "./pages/Data";
import { ImportPage } from "./pages/Import";
import { MatchPage } from "./pages/Match";
import { PeoplePage } from "./pages/People";
import { PersonEditPage } from "./pages/PersonEdit";
import { PlannerPage } from "./pages/Planner";
import { RequestsPage } from "./pages/Requests";
import { RespondPage } from "./pages/Respond";
import { href, useRoute } from "./router";
import { StoreProvider, useStore } from "./state";

const NAV = [
  { path: "people", label: "People" },
  { path: "match", label: "Match" },
  { path: "coverage", label: "Coverage" },
  { path: "planner", label: "Planner" },
  { path: "requests", label: "Requests" },
  { path: "data", label: "Data" },
];

function Shell() {
  const route = useRoute();
  const { state, saved, preservedAs } = useStore();
  const section = route.path[0] ?? "people";

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
    case "planner":
      page = <PlannerPage />;
      break;
    case "requests":
      page = <RequestsPage />;
      break;
    case "import":
      page = <ImportPage key={route.params.get("d") ?? ""} data={route.params.get("d") ?? ""} />;
      break;
    case "data":
      page = <DataPage />;
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
        <a className="tz-chip" href={href("/data")} title="Display time zone (change in Data)">
          {state.settings.timeZone.replace(/_/g, " ")}
        </a>
      </header>
      {!saved && (
        <p className="banner warn" role="alert">
          Changes cannot be saved in this browser (storage is full or blocked). Export a backup from Data.
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
  return <Shell />;
}

export function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
