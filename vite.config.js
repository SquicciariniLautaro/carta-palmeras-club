import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// En Vercel, /api/cloudinary es una función aparte. Con "npm run dev" la
// servimos desde Vite para poder subir fotos también en la compu.
function apiLocal() {
  return {
    name: "api-local",
    configureServer(server) {
      server.middlewares.use("/api/cloudinary", async (req, res) => {
        let cuerpo = "";
        for await (const parte of req) cuerpo += parte;
        req.body = cuerpo;
        res.status = (codigo) => {
          res.statusCode = codigo;
          return res;
        };
        res.json = (datos) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(datos));
        };
        try {
          const { default: handler } = await server.ssrLoadModule("/api/cloudinary.js");
          await handler(req, res);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Falló la función de imágenes (mirá la terminal)." });
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Las variables sin VITE_ (claves de Cloudinary) quedan solo del lado del servidor
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    // En GitHub Pages el sitio vive en /nombre-del-repo/ (lo define el workflow); en Vercel y local es "/"
    base: process.env.VITE_BASE || "/",
    plugins: [react(), tailwindcss(), apiLocal()],
    build: {
      // ExcelJS (~930 kB) va en un archivo aparte que solo se descarga al exportar
      // un Excel desde el panel; el resto de los archivos queda debajo de 500 kB.
      chunkSizeWarningLimit: 1000,
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
  };
});
