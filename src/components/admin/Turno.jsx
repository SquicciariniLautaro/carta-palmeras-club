import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { fechaInput } from "../../lib/formato";
import { IconoLuna, IconoSol } from "../ui/Iconos";
import ListaComidas from "./ListaComidas";
import Categorias from "./Categorias";
import Horarios from "./Horarios";
import MenuDia from "./MenuDia";
import VentasTurno from "./VentasTurno";
import { TURNOS } from "./ventasUtils";

const SUBSECCIONES = {
  noche: [
    { id: "ventas", nombre: "Pedidos y ventas" },
    { id: "comidas", nombre: "Comidas de la carta" },
    { id: "categorias", nombre: "Categorías" },
    { id: "horarios", nombre: "Horarios" },
  ],
  mediodia: [
    { id: "ventas", nombre: "Ventas" },
    { id: "menu", nombre: "Menú del día" },
    { id: "comidas", nombre: "Platos" },
    { id: "categorias", nombre: "Categorías" },
    { id: "horarios", nombre: "Horarios" },
  ],
};

// Una de las dos ventas del negocio (noche o mediodía), con sus propias
// ventas, comidas, categorías y horarios.
export default function Turno({ turno, datos, cargando, enCurso, actualizacion, onRecargarDatos, onCambioVentas }) {
  const [sub, setSub] = useState("ventas");
  const [menuHoy, setMenuHoy] = useState([]);
  const [vueltaMenu, setVueltaMenu] = useState(0);
  const noche = turno === "noche";

  const categorias = useMemo(() => datos.categorias.filter((c) => (c.turno ?? "noche") === turno), [datos.categorias, turno]);
  const comidas = useMemo(() => datos.comidas.filter((c) => (c.turno ?? "noche") === turno), [datos.comidas, turno]);
  const horarios = useMemo(() => datos.horarios.filter((h) => (h.turno ?? "noche") === turno), [datos.horarios, turno]);

  // Platos del menú de hoy: salen primero en la venta en caja del mediodía
  useEffect(() => {
    if (noche) return;
    let activo = true;
    supabase
      .from("menu_dia")
      .select("comida_id")
      .eq("fecha", fechaInput(new Date()))
      .order("orden")
      .then(({ data }) => activo && setMenuHoy((data ?? []).map((f) => f.comida_id)));
    return () => {
      activo = false;
    };
  }, [noche, vueltaMenu]);

  return (
    <div className="space-y-5">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ${
          noche ? "bg-noche text-white" : "border border-mediodia/30 bg-mediodia-suave text-mediodia"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={`grid size-10 place-items-center rounded-xl ${noche ? "bg-white/10" : "bg-white/70"}`}>
            {noche ? <IconoLuna className="size-6" /> : <IconoSol className="size-6" />}
          </span>
          <div>
            <p className="text-lg font-bold uppercase tracking-wide">{TURNOS[turno].nombre}</p>
            <p className={`text-xs ${noche ? "text-white/75" : "text-mediodia/80"}`}>
              {noche ? "Carta online, pedidos por WhatsApp y ventas en caja de la noche" : "Menú del mediodía · uso interno, no se publica en la carta online"}
            </p>
          </div>
        </div>
        {enCurso > 0 && (
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${noche ? "bg-white text-noche" : "bg-mediodia text-white"}`}>
            {enCurso} {enCurso === 1 ? "pedido en curso" : "pedidos en curso"}
          </span>
        )}
      </div>

      <nav className="sin-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-borde/50 p-1" aria-label={`Secciones de ${TURNOS[turno].nombre}`}>
        {SUBSECCIONES[turno].map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={sub === s.id}
            onClick={() => setSub(s.id)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
              sub === s.id ? "bg-papel text-tinta shadow-sm" : "text-tinta-suave hover:text-tinta"
            }`}
          >
            {s.nombre}
          </button>
        ))}
      </nav>

      {sub === "comidas" ? (
        <ListaComidas turno={turno} comidas={comidas} categorias={categorias} cargando={cargando} onCambio={onRecargarDatos} />
      ) : sub === "categorias" ? (
        <Categorias turno={turno} categorias={categorias} comidas={comidas} onCambio={onRecargarDatos} />
      ) : sub === "horarios" ? (
        <Horarios key={turno} turno={turno} horarios={horarios} onCambio={onRecargarDatos} />
      ) : sub === "menu" ? (
        <MenuDia comidas={comidas} onCambio={() => setVueltaMenu((n) => n + 1)} />
      ) : (
        <VentasTurno turno={turno} comidas={comidas} menuHoy={menuHoy} actualizacion={actualizacion} onCambio={onCambioVentas} />
      )}
    </div>
  );
}
