import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearFecha, formatearHora, formatearPesos } from "../../lib/formato";
import { descargarExcel } from "../../lib/excel";
import { nombreUsuario } from "../../hooks/useRol";
import { IconoExcel } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import { RANGOS, calcularRango, hoyInput, sufijoArchivo, textoPeriodo } from "./ventasUtils";

const TIPOS = {
  venta: "Ventas",
  cobro: "Cobros",
  caja: "Caja",
  cancha: "Cancha",
  stock: "Stock",
  catalogo: "Productos y precios",
  cliente: "Cuentas corrientes",
  gasto: "Gastos",
};

// Acciones que conviene mirar con atención (plata que sale o se borra)
const DELICADAS = /Anuló|Borró|Canceló|Retiro|Ajustó|Cambió el precio|no vino|Liberó/;

const LIMITE = 3000;

// Registro de actividad: quién hizo cada cosa en el panel (solo el dueño)
export default function Actividad() {
  const [rango, setRango] = useState("hoy");
  const [desdeTexto, setDesdeTexto] = useState(() => fechaInput(Date.now() - 6 * 864e5));
  const [hastaTexto, setHastaTexto] = useState(hoyInput);
  const [usuario, setUsuario] = useState("");
  const [tipo, setTipo] = useState("");
  const [soloDelicadas, setSoloDelicadas] = useState(false);
  const [resultado, setResultado] = useState({ clave: null, filas: [], error: null });

  const periodo = useMemo(() => calcularRango(rango, desdeTexto, hastaTexto), [rango, desdeTexto, hastaTexto]);
  const clave = periodo ? `${periodo.desde.getTime()}-${periodo.hasta.getTime()}` : null;

  useEffect(() => {
    if (!periodo) return;
    let activo = true;
    supabase
      .from("actividad")
      .select("*")
      .gte("created_at", periodo.desde.toISOString())
      .lt("created_at", periodo.hasta.toISOString())
      .order("created_at", { ascending: false })
      .limit(LIMITE)
      .then(({ data, error }) => activo && setResultado({ clave, filas: data ?? [], error }));
    return () => {
      activo = false;
    };
  }, [periodo, clave]);

  const usuarios = useMemo(() => [...new Set(resultado.filas.map((f) => f.usuario ?? ""))].sort(), [resultado.filas]);
  const filas = useMemo(
    () =>
      resultado.filas.filter(
        (f) =>
          (!usuario || (f.usuario ?? "") === usuario) &&
          (!tipo || f.tipo === tipo) &&
          (!soloDelicadas || DELICADAS.test(f.accion))
      ),
    [resultado.filas, usuario, tipo, soloDelicadas]
  );

  // Agrupado por día
  const dias = useMemo(() => {
    const mapa = new Map();
    for (const f of filas) {
      const dia = fechaInput(f.created_at);
      if (!mapa.has(dia)) mapa.set(dia, []);
      mapa.get(dia).push(f);
    }
    return [...mapa.entries()];
  }, [filas]);

  function exportar() {
    descargarExcel(`actividad_${sufijoArchivo(periodo)}`, [
      {
        nombre: "Actividad",
        titulo: "Registro de actividad",
        subtitulo: textoPeriodo(periodo),
        columnas: [
          { titulo: "Fecha y hora", clave: "created_at", tipo: "fechaHora", ancho: 17 },
          { titulo: "Usuario", ancho: 16, valor: (f) => nombreUsuario(f.usuario) },
          { titulo: "Rol", ancho: 10, valor: (f) => (f.rol === "dueno" ? "Dueño" : f.rol === "empleado" ? "Empleado" : "") },
          { titulo: "Área", ancho: 18, valor: (f) => TIPOS[f.tipo] ?? f.tipo },
          { titulo: "Acción", clave: "accion", ancho: 30 },
          { titulo: "Detalle", clave: "detalle", ancho: 48, ajustar: true },
          { titulo: "Importe", clave: "monto", tipo: "moneda", ancho: 15 },
        ],
        filas,
      },
    ]).catch(() => toast.error("No se pudo armar el Excel."));
  }

  const cargando = periodo && resultado.clave !== clave;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Actividad</h1>
          <p className="text-sm text-tinta-suave">
            Quién hizo cada cosa en el panel: ventas, cobros, caja, cancha, stock y cambios de precios. No se puede borrar ni modificar.
          </p>
        </div>
        <button type="button" className="boton-secundario" onClick={exportar} disabled={!periodo || filas.length === 0}>
          <IconoExcel className="size-4" /> Excel
        </button>
      </div>

      <div className="tarjeta flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="etiqueta">Período</span>
          <select className="campo" value={rango} onChange={(e) => setRango(e.target.value)}>
            {RANGOS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        {rango === "personalizado" && (
          <>
            <label>
              <span className="etiqueta">Desde</span>
              <input type="date" className="campo" value={desdeTexto} onChange={(e) => setDesdeTexto(e.target.value)} />
            </label>
            <label>
              <span className="etiqueta">Hasta</span>
              <input type="date" className="campo" value={hastaTexto} onChange={(e) => setHastaTexto(e.target.value)} />
            </label>
          </>
        )}
        <label>
          <span className="etiqueta">Usuario</span>
          <select className="campo" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u} value={u}>
                {nombreUsuario(u || null)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="etiqueta">Área</span>
          <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(TIPOS).map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-sm">
          <input type="checkbox" className="size-4 accent-palmera" checked={soloDelicadas} onChange={(e) => setSoloDelicadas(e.target.checked)} />
          Solo anulaciones, borrados y retiros
        </label>
      </div>

      {!periodo ? (
        <p className="tarjeta p-6 text-center text-sm text-tinta-suave">Elegí un período válido.</p>
      ) : cargando ? (
        <Cargando texto="Cargando actividad…" />
      ) : resultado.error ? (
        <p className="tarjeta p-6 text-center text-sm">{mensajeDeError(resultado.error, "No se pudo cargar la actividad.")}</p>
      ) : filas.length === 0 ? (
        <p className="tarjeta p-8 text-center text-sm text-tinta-suave">No hay actividad con esos filtros.</p>
      ) : (
        <div className="space-y-4">
          {dias.map(([dia, lista]) => (
            <div key={dia}>
              <p className="etiqueta">{formatearFecha(dia)}</p>
              <ul className="tarjeta divide-y divide-borde px-3">
                {lista.map((f) => (
                  <li key={f.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">
                    <span className="cifras text-xs text-tinta-suave">{formatearHora(f.created_at)}</span>
                    <span className="min-w-0">
                      <span className={`font-medium ${DELICADAS.test(f.accion) ? "text-brasa" : ""}`}>{f.accion}</span>
                      {f.detalle && <span className="block truncate text-xs text-tinta-suave">{f.detalle}</span>}
                    </span>
                    <span className="text-right">
                      <span className="block text-xs font-semibold">{nombreUsuario(f.usuario)}</span>
                      {f.monto != null && <span className="cifras text-xs text-tinta-suave">{formatearPesos(f.monto)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {resultado.filas.length >= LIMITE && (
            <p className="text-center text-xs text-tinta-suave">Se muestran las últimas {LIMITE} acciones: achicá el período para ver todo.</p>
          )}
        </div>
      )}
    </section>
  );
}
