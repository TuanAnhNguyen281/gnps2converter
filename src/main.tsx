import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AccountProvider } from "./Account";
import "./styles.css";
import "./workspace.css";
import { ThemeProvider, ConfirmProvider } from "./Ui";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ConfirmProvider>
        <AccountProvider>
          <App />
        </AccountProvider>
      </ConfirmProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
