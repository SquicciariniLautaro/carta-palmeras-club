import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearPrecio } from "../../lib/formato";
import { prepararSonido, sonarAviso } from "../../lib/sonido";
import { usePedidosEnVivo } from "../../hooks/usePedidosEnVivo";
import Logo from "../ui/Logo";
import ListaComidas from "./ListaComidas";
import Categorias from "./Categorias";
import HistorialVentas from "./HistorialVentas";
import Horarios from "./Horarios";

const SECCIONES = [
  { id: "ventas", nombre: "Ventas" },
  { id: "comidas", nombre: "Comidas" },
  { id: "categorias", nombre: "Categorías" },
  { id: "horarios", nombre: "Horarios" },
];

const TITULO = "Panel · Las Palmeras Club";

async function obtenerDatos() {
  const [cats, comidas, horarios] = await Promise.all([
    supabase.from("categorias").select("*").order("orden").order("nombre"),
    supabase.from("comidas").select("*").order("nombre"),
    supabase.from("horarios").select("*").order("dia"),
  ]);
  if (cats.error) throw cats.error;
  if (comidas.error) throw comidas.error;
  if (horarios.error) console.warn("No se pudo leer el horario (¿falta correr el SQL?)", horarios.error);
  return { categorias: cats.data, comidas: comidas.data, horarios: horarios.data ?? [] };
}

const avisosDisponibles = () => typeof window !== "undefined" && "Notification" in window;

export default function Panel({ sesion }) {
  const [seccion, setSeccion] = useState("ventas");
  const [datos, setDatos] = useState({ categorias: [], comidas: [], horarios: [] });
  const [estado, setEstado] = useState("cargando");
  const [permisoAvisos, setPermisoAvisos] = useState(() => (avisosDisponibles() ? Notification.permission : "denied"));

  // Recarga categorías, comidas y horario (se usa después de cada cambio)
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

  // Pedido nuevo: sonido, cartel en el panel y notificación si la pestaña no está a la vista
  const avisarNuevos = useCallback((pedidos) => {
    sonarAviso();
    for (const p of pedidos) {
      const texto = `${p.cliente_nombre || "Sin nombre"} · ${formatearPrecio(p.total)}`;
      toast(
        (t) => (
          <span className="flex items-center gap-3">
            <span>
              <strong className="block">¡Nuevo pedido #{p.numero}!</strong>
              <span className="text-xs">{texto}</span>
            </span>
            <button
              type="button"
              className="boton-primario px-3 py-1.5 text-xs"
              onClick={() => {
                setSeccion("ventas");
                toast.dismiss(t.id);
              }}
            >
              Ver
            </button>
          </span>
        ),
        { id: `pedido-${p.id}`, icon: "🛎️", duration: 20_000 }
      );
      if (document.hidden && avisosDisponibles() && Notification.permission === "granted") {
        new Notification(`Nuevo pedido #${p.numero}`, { body: texto, icon: "/favicon.png", tag: p.id });
      }
    }
  }, []);

  const { abiertos, version, revisar } = usePedidosEnVivo(avisarNuevos);
  const sinCerrar = abiertos.length;
  const hayNuevos = abiertos.some((p) => p.estado === "pendiente");

  // El navegador solo deja sonar después de un toque: lo preparamos con el primero
  useEffect(() => {
    const alTocar = () => prepararSonido();
    document.addEventListener("pointerdown", alTocar, { once: true });
    return () => document.removeEventListener("pointerdown", alTocar);
  }, []);

  // "(3) Panel · …" en la pestaña del navegador
  useEffect(() => {
    document.title = sinCerrar > 0 ? `(${sinCerrar}) ${TITULO}` : TITULO;
  }, [sinCerrar]);
  useEffect(() => () => (document.title = "Las Palmeras Club"), []);

  async function activarAvisos() {
    prepararSonido();
    const permiso = await Notification.requestPermission();
    setPermisoAvisos(permiso);
    if (permiso === "granted") toast.success("Listo: te avisamos cuando entre un pedido, aunque estés en otra pestaña.");
    else toast.error("El navegador bloqueó los avisos. Igual vas a escuchar el sonido con el panel abierto.");
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
    toast.success("Cerraste sesión");
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-borde bg-fondo/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-auto" />
            <span className="hidden rounded-full bg-borde px-2 py-0.5 text-xs text-tinta-suave sm:inline">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-48 truncate text-xs text-tinta-suave md:inline">{sesion.user.email}</span>
            {avisosDisponibles() && permisoAvisos === "default" && (
              <button type="button" className="boton-primario px-3 py-2 text-xs" onClick={activarAvisos}>
                🔔 Activar avisos
              </button>
            )}
            <a href="/" target="_blank" rel="noopener noreferrer" className="boton-secundario px-3 py-2 text-xs">
              Ver catálogo
            </a>
            <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={cerrarSesion}>
              Cerrar sesión
            </button>
          </div>
        </div>
        <nav className="sin-scrollbar mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4" role="tablist" aria-label="Secciones del panel">
          {SECCIONES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={seccion === s.id}
              onClick={() => setSeccion(s.id)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                seccion === s.id
                  ? "border-palmera text-tinta"
                  : "border-transparent text-tinta-suave hover:text-tinta"
              }`}
            >
              {s.nombre}
              {s.id === "ventas" && sinCerrar > 0 && (
                <span
                  className={`grid min-w-6 place-items-center rounded-full px-1.5 py-0.5 text-xs font-bold text-white ${
                    hayNuevos ? "animate-pulse bg-brasa" : "bg-palmera"
                  }`}
                  aria-label={`${sinCerrar} pedidos sin cerrar`}
                  title={`${sinCerrar} pedidos sin cerrar`}
                >
                  {sinCerrar}
                </span>
              )}
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
        ) : seccion === "horarios" ? (
          <Horarios horarios={datos.horarios} onCambio={recargar} />
        ) : (
          <HistorialVentas comidas={datos.comidas} actualizacion={version} onCambio={() => revisar()} />
        )}
      </main>
    </div>
  );
}
