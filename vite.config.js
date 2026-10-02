import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Separamos las librerías grandes en archivos propios: se cachean
        // aparte y ningún archivo supera los 500 kB.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: "supabase", test: /node_modules[\\/]@supabase[\\/]/ },
            { name: "graficos", test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|@reduxjs|immer|reselect)[\\/]/ },
          ],
        },
      },
    },
  },
});
