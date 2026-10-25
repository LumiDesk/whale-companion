import AboutPage from "./components/AboutPage";
import LogsPage from "./components/LogsPage";
import MessageBanner from "./components/MessageBanner";
import SettingsPage from "./components/SettingsPage";
import Sidebar from "./components/Sidebar";
import StatusPage from "./components/StatusPage";
import { useController } from "./hooks/useController";

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
        <MessageBanner controller={controller} />

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
