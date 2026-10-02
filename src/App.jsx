import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import Catalogo from "./pages/Catalogo.jsx";
import Cargando from "./components/ui/Cargando.jsx";

// El panel (con Recharts) se carga aparte: el catálogo público queda liviano
const Admin = lazy(() => import("./pages/Admin.jsx"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Catalogo />} />
      <Route
        path="/admin"
        element={
          <Suspense fallback={<Cargando texto="Cargando panel…" />}>
            <Admin />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
