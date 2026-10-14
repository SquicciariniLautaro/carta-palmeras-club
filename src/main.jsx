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
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: "#fcf6ea",
            color: "#2b211b",
            border: "1px solid #e4d4b6",
            fontSize: "14px",
          },
          success: { iconTheme: { primary: "#e2472b", secondary: "#fcf6ea" } },
          error: { duration: 5000, iconTheme: { primary: "#a8231f", secondary: "#fcf6ea" } },
        }}
      />
    </BrowserRouter>
  </StrictMode>
);
