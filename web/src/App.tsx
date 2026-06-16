import { useState } from "react";
import { useStore } from "./store";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Toast } from "./components/Toast";
import { Wizard } from "./components/Wizard";
import { DashboardView } from "./views/DashboardView";
import { AgentsView } from "./views/AgentsView";
import { BookingsView } from "./views/BookingsView";
import { CallsView } from "./views/CallsView";
import { PromptsView } from "./views/PromptsView";

export function App() {
  const { screen, view } = useStore();
  const [wizardOpen, setWizardOpen] = useState(false);

  if (screen === "auth") {
    return (
      <>
        <AuthScreen />
        <Toast />
      </>
    );
  }

  if (screen === "loading") {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <>
      <div className="app-shell">
        <Sidebar />
        <main className="main-panel">
          <Topbar onNewAgent={() => setWizardOpen(true)} />
          <DashboardView active={view === "dashboard"} onNewAgent={() => setWizardOpen(true)} />
          <AgentsView active={view === "agents"} onNewAgent={() => setWizardOpen(true)} />
          <BookingsView active={view === "bookings"} />
          <CallsView active={view === "calls"} />
          <PromptsView active={view === "prompts"} />
        </main>
      </div>
      {wizardOpen && <Wizard onClose={() => setWizardOpen(false)} />}
      <Toast />
    </>
  );
}
