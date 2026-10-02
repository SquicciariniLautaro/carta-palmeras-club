import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "react-hot-toast";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/yellowtail/latin-400.css";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: "#1e1e1e",
            color: "#f7f1e5",
            border: "1px solid #2e2e2e",
            fontSize: "14px",
          },
          success: { iconTheme: { primary: "#f5b82e", secondary: "#141414" } },
          error: { duration: 5000, iconTheme: { primary: "#e04848", secondary: "#141414" } },
        }}
      />
    </BrowserRouter>
  </StrictMode>
);
