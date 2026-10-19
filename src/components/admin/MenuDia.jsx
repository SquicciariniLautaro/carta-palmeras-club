import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearPrecio } from "../../lib/formato";
import { IconoCalendario, IconoCerrar, IconoFlechaDerecha } from "../ui/Iconos";
import Cargando from "../ui/Cargando";

const NOMBRES_DIA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function lunesDe(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function sumarDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d;
}

const formatoCorto = (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

// Cronograma del menú del mediodía: qué platos salen cada día de la semana
export default function MenuDia({ comidas, onCambio }) {
  const [lunes, setLunes] = useState(() => lunesDe(new Date()));
  const [resultado, setResultado] = useState({ clave: null, filas: [], error: null });
  const [recarga, setRecarga] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes]);
  const desde = fechaInput(dias[0]);
  const hasta = fechaInput(dias[6]);
  const clave = `${desde}-${recarga}`;
  const hoy = fechaInput(new Date());
  const porId = useMemo(() => new Map(comidas.map((c) => [c.id, c])), [comidas]);
  const disponibles = useMemo(() => comidas.filter((c) => c.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [comidas]);

  useEffect(() => {
    let activo = true;
    supabase
      .from("menu_dia")
      .select("fecha, comida_id, orden")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("orden")
      .then(({ data, error }) => activo && setResultado({ clave, filas: data ?? [], error }));
    return () => {
      activo = false;
    };
  }, [desde, hasta, clave]);

  const cargando = resultado.clave !== clave;
  const platosDe = (fecha) => resultado.filas.filter((f) => f.fecha === fecha);

  async function cambiar(promesa, mensajeError) {
    setOcupado(true);
    const { error } = await promesa;
    setOcupado(false);
    if (error) {
      toast.error(mensajeDeError(error, mensajeError));
      return false;
    }
    setRecarga((n) => n + 1);
    onCambio?.();
    return true;
  }

  function agregar(fecha, comidaId) {
    if (!comidaId) return;
    const orden = platosDe(fecha).length + 1;
    cambiar(supabase.from("menu_dia").insert({ fecha, comida_id: comidaId, orden }), "No se pudo agregar el plato.");
  }

  function quitar(fecha, comidaId) {
    cambiar(supabase.from("menu_dia").delete().eq("fecha", fecha).eq("comida_id", comidaId), "No se pudo quitar el plato.");
  }

  // Copia los platos de la semana anterior a esta (solo en los días vacíos)
  async function copiarSemanaAnterior() {
    const { data, error } = await supabase
      .from("menu_dia")
      .select("fecha, comida_id, orden")
      .gte("fecha", fechaInput(sumarDias(lunes, -7)))
      .lte("fecha", fechaInput(sumarDias(lunes, -1)));
    if (error) return toast.error(mensajeDeError(error, "No se pudo leer la semana anterior."));
    const ocupados = new Set(resultado.filas.map((f) => f.fecha));
    const nuevas = data
      .map((f) => {
        const [a, m, d] = f.fecha.split("-").map(Number);
        return { ...f, fecha: fechaInput(sumarDias(new Date(a, m - 1, d), 7)) };
      })
      .filter((f) => !ocupados.has(f.fecha) && porId.has(f.comida_id));
    if (nuevas.length === 0) return toast("No hay platos para copiar a los días vacíos de esta semana.");
    if (await cambiar(supabase.from("menu_dia").insert(nuevas), "No se pudo copiar la semana.")) {
      toast.success(`Copiaste ${nuevas.length} platos de la semana anterior`);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Menú del día · cronograma</h1>
          <p className="text-sm text-tinta-suave">
            Elegí qué platos salen cada mediodía. El menú de hoy aparece primero al registrar una venta del mediodía.
          </p>
        </div>
        <button type="button" className="boton-secundario" onClick={copiarSemanaAnterior} disabled={ocupado || cargando}>
          Copiar semana anterior
        </button>
      </div>

      <div className="tarjeta flex items-center justify-between gap-2 p-2">
        <button type="button" className="boton-secundario px-3" onClick={() => setLunes((l) => sumarDias(l, -7))} aria-label="Semana anterior">
          <IconoFlechaDerecha className="size-4 rotate-180" />
        </button>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <IconoCalendario className="size-4 text-mediodia" />
          Semana del {formatoCorto(dias[0])} al {formatoCorto(dias[6])}
        </p>
        <div className="flex gap-1">
          <button type="button" className="boton-secundario px-3 text-xs" onClick={() => setLunes(lunesDe(new Date()))}>
            Hoy
          </button>
          <button type="button" className="boton-secundario px-3" onClick={() => setLunes((l) => sumarDias(l, 7))} aria-label="Semana siguiente">
            <IconoFlechaDerecha className="size-4" />
          </button>
        </div>
      </div>

      {comidas.length === 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Todavía no hay platos del mediodía. Cargalos en la pestaña Comidas (cuando tengas la lista completa del local) y después armá el cronograma acá.
        </p>
      )}

      {cargando ? (
        <Cargando texto="Cargando el cronograma…" />
      ) : resultado.error ? (
        <p className="tarjeta p-6 text-center text-sm text-brasa">{mensajeDeError(resultado.error, "No se pudo cargar el cronograma.")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {dias.map((d, i) => {
            const fecha = fechaInput(d);
            const platos = platosDe(fecha);
            const usados = new Set(platos.map((p) => p.comida_id));
            const esHoy = fecha === hoy;
            return (
              <div key={fecha} className={`tarjeta flex flex-col gap-2 p-3 ${esHoy ? "border-2 border-mediodia" : ""}`}>
                <div className="flex items-baseline justify-between">
                  <p className="font-semibold">{NOMBRES_DIA[i]}</p>
                  <p className="text-xs text-tinta-suave">{formatoCorto(d)}</p>
                </div>
                {esHoy && <span className="w-fit rounded-full bg-mediodia px-2 py-0.5 text-[10px] font-bold uppercase text-white">Hoy</span>}
                <ul className="flex-1 space-y-1">
                  {platos.length === 0 && <li className="text-xs text-tinta-suave">Sin platos</li>}
                  {platos.map((p) => {
                    const c = porId.get(p.comida_id);
                    return (
                      <li key={p.comida_id} className="flex items-start justify-between gap-1 rounded-lg bg-fondo px-2 py-1.5 text-sm">
                        <span className="min-w-0">
                          <span className="block leading-tight">{c?.nombre ?? "Plato borrado"}</span>
                          {c && <span className="cifras text-xs text-tinta-suave">{formatearPrecio(c.precio_promo ?? c.precio)}</span>}
                        </span>
                        <button
                          type="button"
                          className="rounded p-0.5 text-tinta-suave hover:bg-borde hover:text-rojo"
                          onClick={() => quitar(fecha, p.comida_id)}
                          disabled={ocupado}
                          aria-label={`Quitar ${c?.nombre ?? "plato"} del ${NOMBRES_DIA[i]}`}
                        >
                          <IconoCerrar className="size-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <select
                  className="campo py-1.5 text-xs"
                  value=""
                  disabled={ocupado || disponibles.length === 0}
                  onChange={(e) => agregar(fecha, e.target.value)}
                  aria-label={`Agregar plato al ${NOMBRES_DIA[i]}`}
                >
                  <option value="">+ Agregar plato…</option>
                  {disponibles
                    .filter((c) => !usados.has(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
