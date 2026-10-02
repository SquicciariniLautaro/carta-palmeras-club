import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import Logo from "../ui/Logo";
import ListaComidas from "./ListaComidas";
import Categorias from "./Categorias";
import HistorialVentas from "./HistorialVentas";

const SECCIONES = [
  { id: "comidas", nombre: "Comidas" },
  { id: "categorias", nombre: "Categorías" },
  { id: "ventas", nombre: "Ventas" },
];

async function obtenerDatos() {
  const [cats, comidas] = await Promise.all([
    supabase.from("categorias").select("*").order("orden").order("nombre"),
    supabase.from("comidas").select("*").order("nombre"),
  ]);
  if (cats.error) throw cats.error;
  if (comidas.error) throw comidas.error;
  return { categorias: cats.data, comidas: comidas.data };
}

export default function Panel({ sesion }) {
  const [seccion, setSeccion] = useState("comidas");
  const [datos, setDatos] = useState({ categorias: [], comidas: [] });
  const [estado, setEstado] = useState("cargando");

  // Recarga categorías y comidas (se usa después de cada cambio)
  const recargar = useCallback(() => {
    return obtenerDatos()
      .then((nuevos) => {
        setDatos(nuevos);
        setEstado("listo");
      })
      .catch((error) => {
        setEstado((anterior) => (anterior === "listo" ? "listo" : "error"));
        toast.error(mensajeDeError(error, "No pudimos cargar los datos."));
      });
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function cerrarSesion() {
    await supabase.auth.signOut();
    toast.success("Cerraste sesión");
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-noche-3 bg-noche/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-auto" />
            <span className="hidden rounded-full bg-noche-3 px-2 py-0.5 text-xs text-crema-suave sm:inline">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-48 truncate text-xs text-crema-suave md:inline">{sesion.user.email}</span>
            <a href="/" target="_blank" rel="noopener noreferrer" className="boton-secundario px-3 py-2 text-xs">
              Ver catálogo
            </a>
            <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={cerrarSesion}>
              Cerrar sesión
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4" role="tablist" aria-label="Secciones del panel">
          {SECCIONES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={seccion === s.id}
              onClick={() => setSeccion(s.id)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                seccion === s.id
                  ? "border-queso text-crema"
                  : "border-transparent text-crema-suave hover:text-crema"
              }`}
            >
              {s.nombre}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {estado === "error" ? (
          <div className="tarjeta mx-auto max-w-md p-6 text-center">
            <p className="font-semibold">No pudimos cargar los datos.</p>
            <button type="button" className="boton-primario mt-4" onClick={recargar}>
              Reintentar
            </button>
          </div>
        ) : seccion === "comidas" ? (
          <ListaComidas
            comidas={datos.comidas}
            categorias={datos.categorias}
            cargando={estado === "cargando"}
            onCambio={recargar}
          />
        ) : seccion === "categorias" ? (
          <Categorias categorias={datos.categorias} comidas={datos.comidas} onCambio={recargar} />
        ) : (
          <HistorialVentas comidas={datos.comidas} onStockCambiado={recargar} />
        )}
      </main>
    </div>
  );
}
