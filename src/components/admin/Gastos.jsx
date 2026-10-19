import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearFecha, formatearPesos, formatearPorcentaje } from "../../lib/formato";
import { descargarExcel } from "../../lib/excel";
import { hojaGastos } from "../../lib/reportes";
import { useCaja } from "../../hooks/useCaja";
import { IconoAlerta, IconoBasura, IconoCheck, IconoEditar, IconoExcel, IconoMas } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import Modal from "../ui/Modal";
import { RANGOS_MES, calcularRango, hoyInput, sufijoArchivo, textoPeriodo } from "./ventasUtils";

// Categorías contables de gastos de un local gastronómico (con su tipo habitual)
const CATEGORIAS = [
  { nombre: "Mercadería e insumos", tipo: "variable" },
  { nombre: "Bebidas", tipo: "variable" },
  { nombre: "Descartables y packaging", tipo: "variable" },
  { nombre: "Limpieza", tipo: "variable" },
  { nombre: "Sueldos y cargas sociales", tipo: "fijo" },
  { nombre: "Alquiler", tipo: "fijo" },
  { nombre: "Servicios (luz, gas, agua, internet)", tipo: "fijo" },
  { nombre: "Impuestos y tasas", tipo: "fijo" },
  { nombre: "Honorarios (contador, otros)", tipo: "fijo" },
  { nombre: "Delivery y transporte", tipo: "variable" },
  { nombre: "Mantenimiento y reparaciones", tipo: "variable" },
  { nombre: "Equipamiento", tipo: "variable" },
  { nombre: "Publicidad", tipo: "variable" },
  { nombre: "Comisiones bancarias", tipo: "variable" },
  { nombre: "Otros", tipo: "variable" },
];

const METODOS_GASTO = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta" };

function FormGasto({ gasto, onCerrar, onGuardado }) {
  const { caja } = useCaja();
  const [v, setV] = useState(() => ({
    fecha: gasto?.fecha ?? hoyInput(),
    categoria: gasto?.categoria ?? CATEGORIAS[0].nombre,
    tipo: gasto?.tipo ?? CATEGORIAS[0].tipo,
    descripcion: gasto?.descripcion ?? "",
    proveedor: gasto?.proveedor ?? "",
    comprobante: gasto?.comprobante ?? "",
    monto: gasto ? String(Number(gasto.monto)) : "",
    estado: gasto?.estado ?? "pagado",
    metodo: gasto?.metodo ?? "efectivo",
    vencimiento: gasto?.vencimiento ?? "",
    deCaja: gasto ? Boolean(gasto.caja_id) : Boolean(caja),
  }));
  const [guardando, setGuardando] = useState(false);
  const cambiar = (campo) => (e) => setV((x) => ({ ...x, [campo]: e.target.value }));
  const categoriasConActual = CATEGORIAS.some((c) => c.nombre === v.categoria) ? CATEGORIAS : [...CATEGORIAS, { nombre: v.categoria, tipo: v.tipo }];
  const puedeCaja = v.estado === "pagado" && v.metodo === "efectivo" && (caja || gasto?.caja_id);

  async function guardar(e) {
    e.preventDefault();
    if (!v.descripcion.trim()) return toast.error("Escribí una descripción (por ejemplo: compra de carne).");
    if (!(Number(v.monto) > 0)) return toast.error("El monto tiene que ser mayor a 0.");
    if (!v.fecha) return toast.error("Poné la fecha del gasto.");
    const fila = {
      fecha: v.fecha,
      categoria: v.categoria,
      tipo: v.tipo,
      descripcion: v.descripcion.trim(),
      proveedor: v.proveedor.trim() || null,
      comprobante: v.comprobante.trim() || null,
      monto: Number(v.monto),
      estado: v.estado,
      metodo: v.estado === "pagado" ? v.metodo : null,
      vencimiento: v.estado === "pendiente" && v.vencimiento ? v.vencimiento : null,
      caja_id: puedeCaja && v.deCaja ? (gasto?.caja_id ?? caja?.id ?? null) : null,
    };
    setGuardando(true);
    const { error } = gasto ? await supabase.from("gastos").update(fila).eq("id", gasto.id) : await supabase.from("gastos").insert(fila);
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo guardar el gasto."));
    toast.success(gasto ? "Gasto actualizado" : "Gasto registrado");
    onGuardado();
  }

  return (
    <form onSubmit={guardar} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="etiqueta">Fecha *</span>
          <input type="date" className="campo" value={v.fecha} onChange={cambiar("fecha")} />
        </label>
        <label className="block">
          <span className="etiqueta">Monto *</span>
          <input type="number" min="0" step="0.01" inputMode="decimal" className="campo cifras" value={v.monto} onChange={cambiar("monto")} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="block">
          <span className="etiqueta">Categoría *</span>
          <select
            className="campo"
            value={v.categoria}
            onChange={(e) => {
              const c = categoriasConActual.find((x) => x.nombre === e.target.value);
              setV((x) => ({ ...x, categoria: e.target.value, tipo: c?.tipo ?? x.tipo }));
            }}
          >
            {categoriasConActual.map((c) => (
              <option key={c.nombre} value={c.nombre}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="etiqueta">Tipo de costo</span>
          <select className="campo" value={v.tipo} onChange={cambiar("tipo")}>
            <option value="variable">Variable</option>
            <option value="fijo">Fijo (todos los meses)</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="etiqueta">Descripción *</span>
        <input className="campo" maxLength={200} placeholder="Ej.: 20 kg de carne picada" value={v.descripcion} onChange={cambiar("descripcion")} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="etiqueta">Proveedor</span>
          <input className="campo" maxLength={120} value={v.proveedor} onChange={cambiar("proveedor")} />
        </label>
        <label className="block">
          <span className="etiqueta">N° de factura / comprobante</span>
          <input className="campo" maxLength={60} placeholder="Ej.: B 0001-00012345" value={v.comprobante} onChange={cambiar("comprobante")} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-fondo p-1" role="radiogroup" aria-label="Estado del pago">
        {[
          ["pagado", "Ya está pagado"],
          ["pendiente", "Falta pagar"],
        ].map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={v.estado === id}
            onClick={() => setV((x) => ({ ...x, estado: id }))}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${v.estado === id ? "bg-papel text-tinta shadow-sm" : "text-tinta-suave"}`}
          >
            {texto}
          </button>
        ))}
      </div>

      {v.estado === "pagado" ? (
        <div className="space-y-2">
          <label className="block">
            <span className="etiqueta">Forma de pago</span>
            <select className="campo" value={v.metodo} onChange={cambiar("metodo")}>
              {Object.entries(METODOS_GASTO).map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          {puedeCaja && (
            <label className="flex items-start gap-2 rounded-xl border border-borde p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-palmera" checked={v.deCaja} onChange={(e) => setV((x) => ({ ...x, deCaja: e.target.checked }))} />
              <span>
                Lo pagué con la plata de la caja
                <span className="block text-xs text-tinta-suave">Se descuenta del efectivo del arqueo abierto. Destildalo si lo pagó el dueño de su bolsillo.</span>
              </span>
            </label>
          )}
        </div>
      ) : (
        <label className="block">
          <span className="etiqueta">Vencimiento (opcional)</span>
          <input type="date" className="campo" value={v.vencimiento} onChange={cambiar("vencimiento")} />
        </label>
      )}

      <div className="flex justify-end gap-2 border-t border-borde pt-3">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : gasto ? "Guardar cambios" : "Registrar gasto"}
        </button>
      </div>
    </form>
  );
}

function MarcarPagado({ gasto, onCerrar, onGuardado }) {
  const { caja } = useCaja();
  const [metodo, setMetodo] = useState("transferencia");
  const [deCaja, setDeCaja] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const { error } = await supabase
      .from("gastos")
      .update({ estado: "pagado", metodo, vencimiento: null, caja_id: metodo === "efectivo" && deCaja && caja ? caja.id : null })
      .eq("id", gasto.id);
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo marcar como pagado."));
    toast.success("Gasto marcado como pagado");
    onGuardado();
  }

  return (
    <div className="space-y-3 text-sm">
      <p>
        {gasto.descripcion} · <strong className="cifras">{formatearPesos(gasto.monto)}</strong>
      </p>
      <label className="block">
        <span className="etiqueta">¿Cómo se pagó?</span>
        <select className="campo" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
          {Object.entries(METODOS_GASTO).map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
      </label>
      {metodo === "efectivo" && caja && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-palmera" checked={deCaja} onChange={(e) => setDeCaja(e.target.checked)} />
          Con la plata de la caja abierta
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Volver
        </button>
        <button type="button" className="boton-primario" onClick={guardar} disabled={guardando}>
          <IconoCheck className="size-4" /> Marcar pagado
        </button>
      </div>
    </div>
  );
}

// Gastos y costos del negocio
export default function Gastos() {
  const [rango, setRango] = useState("mes");
  const [desdeTexto, setDesdeTexto] = useState(() => fechaInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [hastaTexto, setHastaTexto] = useState(hoyInput);
  const [categoria, setCategoria] = useState("");
  const [estado, setEstado] = useState("todos");
  const [resultado, setResultado] = useState({ clave: null, gastos: [], pendientes: [], error: null });
  const [vuelta, setVuelta] = useState(0);
  const [editando, setEditando] = useState(null); // null | "nuevo" | gasto
  const [aPagar, setAPagar] = useState(null);
  const [aBorrar, setABorrar] = useState(null);
  const [borrando, setBorrando] = useState(false);

  const periodo = useMemo(() => calcularRango(rango, desdeTexto, hastaTexto), [rango, desdeTexto, hastaTexto]);
  const clave = periodo ? `${periodo.desde.getTime()}-${periodo.hasta.getTime()}-${vuelta}` : null;

  useEffect(() => {
    if (!periodo) return;
    let activo = true;
    Promise.all([
      supabase
        .from("gastos")
        .select("*")
        .gte("fecha", fechaInput(periodo.desde))
        .lt("fecha", fechaInput(periodo.hasta))
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase.from("gastos").select("id, monto, vencimiento, descripcion").eq("estado", "pendiente"),
    ]).then(([g, p]) => activo && setResultado({ clave, gastos: g.data ?? [], pendientes: p.data ?? [], error: g.error || p.error }));
    return () => {
      activo = false;
    };
  }, [periodo, clave]);

  const gastos = resultado.gastos;
  const filtrados = useMemo(
    () => gastos.filter((g) => (!categoria || g.categoria === categoria) && (estado === "todos" || g.estado === estado)),
    [gastos, categoria, estado]
  );

  const totales = useMemo(() => {
    const t = { total: 0, pagado: 0, pendiente: 0, fijo: 0, variable: 0, porCategoria: new Map() };
    for (const g of gastos) {
      const m = Number(g.monto);
      t.total += m;
      t[g.estado] += m;
      t[g.tipo] += m;
      t.porCategoria.set(g.categoria, (t.porCategoria.get(g.categoria) ?? 0) + m);
    }
    t.categorias = [...t.porCategoria.entries()].sort((a, b) => b[1] - a[1]);
    return t;
  }, [gastos]);

  const hoy = hoyInput();
  const totalPorPagar = resultado.pendientes.reduce((acc, g) => acc + Number(g.monto), 0);
  const vencidos = resultado.pendientes.filter((g) => g.vencimiento && g.vencimiento < hoy);
  const recargar = () => setVuelta((n) => n + 1);

  async function borrar() {
    setBorrando(true);
    const { error } = await supabase.from("gastos").delete().eq("id", aBorrar.id);
    setBorrando(false);
    setABorrar(null);
    if (error) return toast.error(mensajeDeError(error, "No se pudo borrar el gasto."));
    toast.success("Gasto borrado");
    recargar();
  }

  async function exportar() {
    if (filtrados.length === 0) return toast.error("No hay gastos para exportar con estos filtros.");
    try {
      await descargarExcel(`gastos_${sufijoArchivo(periodo)}`, [hojaGastos(filtrados, textoPeriodo(periodo))]);
      toast.success("Excel de gastos descargado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo generar el Excel.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Gastos y costos</h1>
          <p className="text-sm text-tinta-suave">Todo lo que sale del negocio: compras, sueldos, alquiler, servicios e impuestos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario" onClick={exportar}>
            <IconoExcel className="size-4" /> Descargar Excel
          </button>
          <button type="button" className="boton-primario" onClick={() => setEditando("nuevo")}>
            <IconoMas className="size-4" /> Registrar gasto
          </button>
        </div>
      </div>

      {vencidos.length > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-rojo/30 bg-rojo/10 p-3 text-sm font-medium text-rojo">
          <IconoAlerta className="size-4 shrink-0" />
          {vencidos.length === 1 ? "Hay 1 factura vencida sin pagar" : `Hay ${vencidos.length} facturas vencidas sin pagar`} por{" "}
          {formatearPesos(vencidos.reduce((acc, g) => acc + Number(g.monto), 0))}.
        </p>
      )}

      <div className="tarjeta flex flex-wrap items-end gap-3 p-3">
        <div className="sin-scrollbar flex gap-1 overflow-x-auto" role="group" aria-label="Período">
          {RANGOS_MES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={rango === r.id}
              onClick={() => setRango(r.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${rango === r.id ? "bg-tinta text-fondo" : "bg-fondo text-tinta-suave hover:text-tinta"}`}
            >
              {r.nombre}
            </button>
          ))}
        </div>
        {rango === "personalizado" && (
          <div className="flex gap-2">
            <label>
              <span className="etiqueta">Desde</span>
              <input type="date" className="campo py-1.5" value={desdeTexto} max={hastaTexto} onChange={(e) => setDesdeTexto(e.target.value)} />
            </label>
            <label>
              <span className="etiqueta">Hasta</span>
              <input type="date" className="campo py-1.5" value={hastaTexto} min={desdeTexto} onChange={(e) => setHastaTexto(e.target.value)} />
            </label>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <select className="campo w-auto py-1.5" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {[...new Set([...CATEGORIAS.map((c) => c.nombre), ...gastos.map((g) => g.categoria)])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="campo w-auto py-1.5" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
            <option value="todos">Pagados y pendientes</option>
            <option value="pagado">Solo pagados</option>
            <option value="pendiente">Solo pendientes</option>
          </select>
        </div>
      </div>

      {!periodo ? (
        <p className="tarjeta p-6 text-center text-sm text-tinta-suave">Elegí un rango de fechas válido.</p>
      ) : resultado.clave !== clave ? (
        <Cargando texto="Cargando gastos…" />
      ) : resultado.error ? (
        <p className="tarjeta p-6 text-center text-sm text-brasa">{mensajeDeError(resultado.error, "No se pudieron cargar los gastos.")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="tarjeta border-2 border-tinta p-4">
              <p className="text-xs text-tinta-suave">Gastos del período</p>
              <p className="cifras mt-1 text-2xl font-bold">{formatearPesos(totales.total)}</p>
              <p className="text-xs text-tinta-suave">{textoPeriodo(periodo)}</p>
            </div>
            <div className="tarjeta p-4">
              <p className="text-xs text-tinta-suave">Costos fijos / variables</p>
              <p className="cifras mt-1 text-sm">
                <strong>{formatearPesos(totales.fijo)}</strong> fijos
              </p>
              <p className="cifras text-sm">
                <strong>{formatearPesos(totales.variable)}</strong> variables
              </p>
            </div>
            <div className="tarjeta p-4">
              <p className="text-xs text-tinta-suave">Pagado en el período</p>
              <p className="cifras mt-1 text-xl font-bold text-emerald-700">{formatearPesos(totales.pagado)}</p>
            </div>
            <div className="tarjeta p-4">
              <p className="text-xs text-tinta-suave">Por pagar (todas las fechas)</p>
              <p className="cifras mt-1 text-xl font-bold text-brasa">{formatearPesos(totalPorPagar)}</p>
              <p className="text-xs text-tinta-suave">{resultado.pendientes.length} facturas pendientes</p>
            </div>
          </div>

          {totales.categorias.length > 0 && (
            <div className="tarjeta p-4">
              <h2 className="mb-3 text-sm font-semibold">En qué se va la plata</h2>
              <ul className="space-y-2.5">
                {totales.categorias.map(([nombre, monto]) => (
                  <li key={nombre}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{nombre}</span>
                      <span className="cifras shrink-0">
                        <strong>{formatearPesos(monto)}</strong>
                        <span className="ml-2 text-xs text-tinta-suave">{formatearPorcentaje(monto / totales.total)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-borde">
                      <div className="h-2 rounded-full bg-tinta" style={{ width: `${(monto / totales.categorias[0][1]) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filtrados.length === 0 ? (
            <div className="tarjeta p-8 text-center text-tinta-suave">No hay gastos en este período con ese filtro.</div>
          ) : (
            <div className="tarjeta overflow-x-auto">
              <table className="cifras w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs text-tinta-suave">
                  <tr className="border-b border-borde">
                    <th className="px-3 py-2.5 font-medium">Fecha</th>
                    <th className="px-3 py-2.5 font-medium">Descripción</th>
                    <th className="px-3 py-2.5 font-medium">Categoría</th>
                    <th className="px-3 py-2.5 font-medium">Estado</th>
                    <th className="px-3 py-2.5 text-right font-medium">Monto</th>
                    <th className="px-3 py-2.5 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((g) => {
                    const vencido = g.estado === "pendiente" && g.vencimiento && g.vencimiento < hoy;
                    return (
                      <tr key={g.id} className="border-b border-borde/60 last:border-0 hover:bg-borde/30">
                        <td className="px-3 py-2.5 whitespace-nowrap">{formatearFecha(g.fecha)}</td>
                        <td className="max-w-64 px-3 py-2.5">
                          <span className="block truncate font-medium">{g.descripcion}</span>
                          <span className="block truncate text-xs text-tinta-suave">
                            {[g.proveedor, g.comprobante && `Comp. ${g.comprobante}`].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="block">{g.categoria}</span>
                          <span className="text-xs text-tinta-suave">{g.tipo === "fijo" ? "Fijo" : "Variable"}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          {g.estado === "pagado" ? (
                            <span className="text-xs">
                              <span className="font-semibold text-emerald-700">Pagado</span>
                              <span className="block text-tinta-suave">
                                {METODOS_GASTO[g.metodo]}
                                {g.caja_id && " · de la caja"}
                              </span>
                            </span>
                          ) : (
                            <span className={`text-xs font-semibold ${vencido ? "text-rojo" : "text-brasa"}`}>
                              {vencido ? "Vencido" : "Pendiente"}
                              {g.vencimiento && <span className="block font-normal text-tinta-suave">Vence {formatearFecha(g.vencimiento)}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{formatearPesos(g.monto)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-1">
                            {g.estado === "pendiente" && (
                              <button type="button" className="boton-secundario px-2.5 py-1.5 text-xs" onClick={() => setAPagar(g)}>
                                <IconoCheck className="size-4" /> Pagar
                              </button>
                            )}
                            <button type="button" className="boton-secundario px-2.5 py-1.5" onClick={() => setEditando(g)} aria-label="Editar gasto" title="Editar">
                              <IconoEditar className="size-4" />
                            </button>
                            <button type="button" className="boton-secundario px-2.5 py-1.5 hover:text-rojo" onClick={() => setABorrar(g)} aria-label="Borrar gasto" title="Borrar">
                              <IconoBasura className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal abierto={Boolean(editando)} onCerrar={() => setEditando(null)} titulo={editando === "nuevo" ? "Registrar gasto" : "Editar gasto"} ancho="max-w-xl">
        {editando && (
          <FormGasto
            key={editando === "nuevo" ? "nuevo" : editando.id}
            gasto={editando === "nuevo" ? null : editando}
            onCerrar={() => setEditando(null)}
            onGuardado={() => {
              setEditando(null);
              recargar();
            }}
          />
        )}
      </Modal>

      <Modal abierto={Boolean(aPagar)} onCerrar={() => setAPagar(null)} titulo="Marcar gasto como pagado" ancho="max-w-md">
        {aPagar && (
          <MarcarPagado
            key={aPagar.id}
            gasto={aPagar}
            onCerrar={() => setAPagar(null)}
            onGuardado={() => {
              setAPagar(null);
              recargar();
            }}
          />
        )}
      </Modal>

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="Borrar gasto"
        mensaje={`¿Borrar "${aBorrar?.descripcion ?? ""}" por ${formatearPesos(aBorrar?.monto)}? Si se pagó con una caja ya cerrada, no se puede borrar.`}
        textoConfirmar="Borrar"
        procesando={borrando}
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </section>
  );
}
