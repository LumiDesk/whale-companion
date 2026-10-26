import Sidebar from "./components/Sidebar";
import { useController } from "./hooks/useController";
import AboutPage from "./pages/AboutPage";
import LogsPage from "./pages/LogsPage";
import SettingsPage from "./pages/SettingsPage";
import StatusPage from "./pages/StatusPage";

const App = () => {
  const controller = useController();

  if (!controller.ready) {
    return (
      <div className="boot-screen">
        <img src="./icons/logo.png" alt="" />
        <div>{controller.bootMessage}</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={controller.page}
        onNavigate={controller.setPage}
        botState={controller.botState}
        hasUpdate={controller.update.status === "available"}
      />

      <main className="main">
        {controller.page === "status" && <StatusPage controller={controller} />}
        {controller.page === "settings" && (
          <SettingsPage controller={controller} />
        )}
        {controller.page === "logs" && <LogsPage controller={controller} />}
        {controller.page === "about" && <AboutPage controller={controller} />}
      </main>
    </div>
  );
};

export default App;
