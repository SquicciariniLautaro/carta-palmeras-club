import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearPrecio } from "../../lib/formato";
import { prepararSonido, sonarAviso } from "../../lib/sonido";
import { EVENTO_MODO, imprimirComanda, leerConfigImpresora, leerModoImpresion } from "../../lib/impresion";
import { usePedidosEnVivo } from "../../hooks/usePedidosEnVivo";
import { useCaja } from "../../hooks/useCaja";
import { RolContext } from "../../hooks/useRol";
import Logo from "../ui/Logo";
import {
  IconoAlerta,
  IconoBilletera,
  IconoCaja,
  IconoCampana,
  IconoGrafico,
  IconoImpresora,
  IconoLibreta,
  IconoLuna,
  IconoPelota,
  IconoReloj,
  IconoSol,
} from "../ui/Iconos";
import CajaProvider from "./CajaProvider";
import Turno from "./Turno";
import Caja from "./Caja";
import CuentasCorrientes from "./CuentasCorrientes";
import Gastos from "./Gastos";
import Finanzas from "./Finanzas";
import ConfigImpresora from "./ConfigImpresora";
import Cancha from "./Cancha";
import Actividad from "./Actividad";
import { conStockBajo, idsDeKiosco, necesitaCocina } from "./ventasUtils";

// soloDueno: los empleados no la ven (la base tampoco les deja leer los gastos)
const SECCIONES = [
  { id: "noche", nombre: "Venta noche", Icono: IconoLuna },
  { id: "mediodia", nombre: "Venta mediodía", Icono: IconoSol },
  { id: "cancha", nombre: "Cancha", Icono: IconoPelota },
  { id: "caja", nombre: "Caja", Icono: IconoCaja },
  { id: "cuentas", nombre: "Cuentas corrientes", Icono: IconoLibreta },
  { id: "gastos", nombre: "Gastos y costos", Icono: IconoBilletera, soloDueno: true },
  { id: "finanzas", nombre: "Finanzas", Icono: IconoGrafico, soloDueno: true },
  { id: "actividad", nombre: "Actividad", Icono: IconoReloj, soloDueno: true },
];

const ROLES = { dueno: "Dueño", empleado: "Empleado" };

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

function EstadoCaja({ onIr }) {
  const { caja, cargando } = useCaja();
  if (cargando) return null;
  return (
    <button
      type="button"
      onClick={onIr}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
        caja ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
      }`}
      title={caja ? "Ir a la caja" : "La caja está cerrada: abrila para cobrar"}
    >
      <span className={`size-2 rounded-full ${caja ? "bg-emerald-600" : "animate-respirar bg-amber-600"}`} />
      {caja ? `Caja abierta · N° ${caja.numero}` : "Caja cerrada"}
    </button>
  );
}

function PanelContenido({ sesion, rol }) {
  const [seccion, setSeccion] = useState("noche");
  const [subTurno, setSubTurno] = useState("ventas");
  const [datos, setDatos] = useState({ categorias: [], comidas: [], horarios: [] });
  const [estado, setEstado] = useState("cargando");
  const [permisoAvisos, setPermisoAvisos] = useState(() => (avisosDisponibles() ? Notification.permission : "denied"));
  const [impresoraAbierta, setImpresoraAbierta] = useState(false);
  const [modoImpresion, setModoImpresion] = useState(leerModoImpresion);
  const [avisoImpresionOculto, setAvisoImpresionOculto] = useState(false);
  const datosRef = useRef(datos);
  useEffect(() => {
    datosRef.current = datos;
  });

  // Cada impresión cuenta si salió directo o con el cuadro de Chrome
  useEffect(() => {
    const alCambiar = (e) => setModoImpresion(e.detail);
    window.addEventListener(EVENTO_MODO, alCambiar);
    return () => window.removeEventListener(EVENTO_MODO, alCambiar);
  }, []);

  // Recarga categorías, comidas y horarios (se usa después de cada cambio)
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

  // Pedido nuevo: sonido, cartel en el panel, comanda (si está configurado) y
  // notificación si la pestaña no está a la vista
  const avisarNuevos = useCallback((pedidos) => {
    sonarAviso();
    const config = leerConfigImpresora();
    for (const p of pedidos) {
      const texto = `${p.cliente_nombre || "Sin nombre"} · ${formatearPrecio(p.total)}`;
      toast(
        (t) => (
          <span className="flex items-center gap-3">
            <span>
              <strong className="block">Nuevo pedido #{p.numero}</strong>
              <span className="text-xs">{texto}</span>
            </span>
            <button
              type="button"
              className="boton-primario px-3 py-1.5 text-xs"
              onClick={() => {
                setSeccion("noche");
                toast.dismiss(t.id);
              }}
            >
              Ver
            </button>
          </span>
        ),
        { id: `pedido-${p.id}`, icon: <IconoCampana className="size-5 text-brasa" />, duration: 20_000 }
      );
      if (config.comandaAlLlegar) {
        supabase
          .from("ventas")
          .select("*, venta_items(*)")
          .eq("id", p.id)
          .single()
          .then(({ data }) => {
            if (!data) return;
            // Un pedido solo de bebidas o golosinas no necesita comanda de cocina
            const { categorias, comidas } = datosRef.current;
            if (config.comandaKiosco || necesitaCocina(data.venta_items ?? [], idsDeKiosco(categorias, comidas))) imprimirComanda(data);
          });
      }
      if (document.hidden && avisosDisponibles() && Notification.permission === "granted") {
        new Notification(`Nuevo pedido #${p.numero}`, { body: texto, icon: `${import.meta.env.BASE_URL}favicon.png`, tag: p.id });
      }
    }
  }, []);

  const { abiertos, version, revisar } = usePedidosEnVivo(avisarNuevos);

  // Cada venta mueve el stock de bebidas y golosinas: recargamos las comidas
  useEffect(() => {
    if (version > 0) recargar();
  }, [version, recargar]);
  const enCurso = (turno) => abiertos.filter((p) => (p.turno ?? "noche") === turno).length;
  const nuevosSinConfirmar = abiertos.filter((p) => p.estado === "pendiente" && p.origen === "web").length;

  // El navegador solo deja sonar después de un toque: lo preparamos con el primero
  useEffect(() => {
    const alTocar = () => prepararSonido();
    document.addEventListener("pointerdown", alTocar, { once: true });
    return () => document.removeEventListener("pointerdown", alTocar);
  }, []);

  // "(3) Panel · …" en la pestaña del navegador
  useEffect(() => {
    document.title = abiertos.length > 0 ? `(${abiertos.length}) ${TITULO}` : TITULO;
  }, [abiertos.length]);
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

  const esTurno = seccion === "noche" || seccion === "mediodia";
  const esDueno = rol === "dueno";
  const secciones = SECCIONES.filter((s) => esDueno || !s.soloDueno);
  const stockBajo = conStockBajo(datos.categorias, datos.comidas);

  // Cambia de sección; en los turnos se puede abrir una pestaña de adentro (ej. Stock)
  function irA(id, sub = "ventas") {
    setSeccion(id);
    setSubTurno(sub);
  }

  return (
    <div className="min-h-dvh">
      <header className="z-30 border-b border-borde bg-fondo/95 backdrop-blur sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-auto" />
            <span className="hidden rounded-full bg-borde px-2 py-0.5 text-xs text-tinta-suave sm:inline">{ROLES[rol] ?? "Administración"}</span>
            <EstadoCaja onIr={() => irA("caja")} />
            {stockBajo.length > 0 && (
              <button
                type="button"
                onClick={() => irA(stockBajo[0].turno ?? "noche", "stock")}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900"
                title={stockBajo.map((c) => `${c.nombre}: ${c.stock}`).join("\n")}
              >
                <IconoAlerta className="size-3.5" />
                {stockBajo.length === 1 ? "1 producto con poco stock" : `${stockBajo.length} con poco stock`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden max-w-48 truncate text-xs text-tinta-suave lg:inline">{sesion.user.email}</span>
            {avisosDisponibles() && permisoAvisos === "default" && (
              <button type="button" className="boton-primario px-3 py-2 text-xs" onClick={activarAvisos}>
                <IconoCampana className="size-4" /> Activar avisos
              </button>
            )}
            <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={() => setImpresoraAbierta(true)}>
              <IconoImpresora className="size-4" /> Ticketera
            </button>
            <a href={import.meta.env.BASE_URL} target="_blank" rel="noopener noreferrer" className="boton-secundario px-3 py-2 text-xs">
              Ver carta
            </a>
            <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={cerrarSesion}>
              Cerrar sesión
            </button>
          </div>
        </div>
        <nav className="sin-scrollbar mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4" role="tablist" aria-label="Secciones del panel">
          {secciones.map(({ id, nombre, Icono }) => {
            const cantidad = id === "noche" || id === "mediodia" ? enCurso(id) : 0;
            const alerta = id === "noche" && nuevosSinConfirmar > 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={seccion === id}
                onClick={() => irA(id)}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  seccion === id ? "border-palmera text-tinta" : "border-transparent text-tinta-suave hover:text-tinta"
                }`}
              >
                <Icono className="size-4" />
                {nombre}
                {cantidad > 0 && (
                  <span
                    className={`grid min-w-6 place-items-center rounded-full px-1.5 py-0.5 text-xs font-bold text-white ${
                      alerta ? "animate-respirar bg-brasa" : id === "noche" ? "bg-noche" : "bg-mediodia"
                    }`}
                    aria-label={`${cantidad} pedidos en curso`}
                    title={`${cantidad} pedidos en curso`}
                  >
                    {cantidad}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {nuevosSinConfirmar > 0 && (
        <div className="border-b border-brasa/30 bg-brasa text-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <IconoCampana className="animate-timbre size-5" />
              {nuevosSinConfirmar === 1 ? "Hay 1 pedido nuevo esperando confirmación" : `Hay ${nuevosSinConfirmar} pedidos nuevos esperando confirmación`}
            </p>
            {seccion !== "noche" && (
              <button type="button" className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-brasa" onClick={() => irA("noche")}>
                Ver pedidos
              </button>
            )}
          </div>
        </div>
      )}

      {modoImpresion === "dialogo" && !avisoImpresionOculto && (
        <div className="border-b border-amber-300 bg-amber-50 text-amber-950">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2">
            <p className="flex items-center gap-2 text-sm">
              <IconoAlerta className="size-5 shrink-0 text-amber-700" />
              <span>
                <strong>La comanda no sale sola:</strong> Chrome está mostrando el cuadro de impresión. Abrí el panel desde el acceso
                directo "Panel Palmeras" para que imprima directo.
              </span>
            </p>
            <div className="flex gap-2">
              <button type="button" className="rounded-lg bg-amber-900 px-3 py-1 text-xs font-bold text-white" onClick={() => setImpresoraAbierta(true)}>
                Cómo hacerlo
              </button>
              <button type="button" className="rounded-lg px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100" onClick={() => setAvisoImpresionOculto(true)}>
                Ocultar
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6">
        {estado === "error" && esTurno ? (
          <div className="tarjeta mx-auto max-w-md p-6 text-center">
            <p className="font-semibold">No pudimos cargar los datos.</p>
            <button type="button" className="boton-primario mt-4" onClick={recargar}>
              Reintentar
            </button>
          </div>
        ) : esTurno ? (
          <Turno
            key={`${seccion}-${subTurno}`}
            turno={seccion}
            subInicial={subTurno}
            datos={datos}
            cargando={estado === "cargando"}
            enCurso={enCurso(seccion)}
            actualizacion={version}
            onRecargarDatos={recargar}
            onCambioVentas={() => {
              revisar();
              recargar(); // el stock de bebidas y golosinas cambió
            }}
          />
        ) : seccion === "cancha" ? (
          <Cancha />
        ) : seccion === "caja" ? (
          <Caja actualizacion={version} />
        ) : seccion === "cuentas" ? (
          <CuentasCorrientes />
        ) : seccion === "gastos" && esDueno ? (
          <Gastos />
        ) : seccion === "finanzas" && esDueno ? (
          <Finanzas />
        ) : seccion === "actividad" && esDueno ? (
          <Actividad />
        ) : null}
      </main>

      <ConfigImpresora abierto={impresoraAbierta} onCerrar={() => setImpresoraAbierta(false)} />
    </div>
  );
}

export default function Panel({ sesion, rol }) {
  return (
    <RolContext.Provider value={rol ?? "empleado"}>
      <CajaProvider>
        <PanelContenido sesion={sesion} rol={rol} />
      </CajaProvider>
    </RolContext.Provider>
  );
}
