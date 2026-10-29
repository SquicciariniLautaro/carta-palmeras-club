import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { claveDia, fechaInput, formatearPesos, formatearPorcentaje } from "../../lib/formato";
import { descargarExcel } from "../../lib/excel";
import { hojaArqueos, hojaCobros, hojaCuentas, hojaGastos, hojaProductos, hojaVentas } from "../../lib/reportes";
import { IconoAlerta, IconoExcel } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import { RANGOS_MES, calcularRango, hoyInput, sufijoArchivo, textoPeriodo } from "./ventasUtils";

// Colores de las series (validados para daltonismo sobre el fondo del panel)
const COLOR_INGRESOS = "#2a78d6";
const COLOR_GASTOS = "#eb6834";
const COLOR_EJE = "#6b5b4e";
const COLOR_GRILLA = "#e4d4b6";

const formatoCorto = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", notation: "compact", maximumFractionDigits: 1 });

async function obtenerFinanzas({ desde, hasta }) {
  const desdeIso = desde.toISOString();
  const hastaIso = hasta.toISOString();
  const [ventas, pagos, gastos, pendientes, clientes, cajas] = await Promise.all([
    supabase
      .from("ventas")
      .select("*, venta_items(*), pagos(metodo, monto)")
      .eq("estado", "cerrado")
      .gte("created_at", desdeIso)
      .lt("created_at", hastaIso)
      .order("created_at")
      .limit(10000),
    supabase
      .from("pagos")
      .select("*, ventas(numero, turno), clientes(nombre), cajas(numero)")
      .gte("created_at", desdeIso)
      .lt("created_at", hastaIso)
      .order("created_at")
      .limit(20000),
    supabase.from("gastos").select("*").gte("fecha", fechaInput(desde)).lt("fecha", fechaInput(hasta)).order("fecha").limit(10000),
    supabase.from("gastos").select("monto, vencimiento").eq("estado", "pendiente"),
    supabase.from("clientes_saldos").select("*").order("nombre"),
    supabase.from("cajas").select("*").eq("estado", "cerrada").gte("abierta_at", desdeIso).lt("abierta_at", hastaIso).order("abierta_at"),
  ]);
  const error = [ventas, pagos, gastos, pendientes, clientes, cajas].find((r) => r.error)?.error;
  if (error) throw error;
  return {
    ventas: ventas.data,
    pagos: pagos.data,
    gastos: gastos.data,
    pendientes: pendientes.data,
    clientes: clientes.data,
    cajas: cajas.data,
  };
}

function calcular(d) {
  const suma = (lista, f = (x) => x.monto) => lista.reduce((acc, x) => acc + Number(f(x) || 0), 0);
  const ventas = suma(d.ventas, (v) => v.total);
  const ventasNoche = suma(d.ventas.filter((v) => v.turno === "noche"), (v) => v.total);
  const ventasCancha = suma(d.ventas.filter((v) => v.turno === "cancha"), (v) => v.total);
  const ventasMediodia = ventas - ventasNoche - ventasCancha;
  const ingresos = d.pagos.filter((p) => p.metodo !== "cuenta_corriente");
  const cobradoEfectivo = suma(ingresos.filter((p) => p.metodo === "efectivo"));
  const cobradoTransferencia = suma(ingresos.filter((p) => p.metodo === "transferencia"));
  const cobrado = cobradoEfectivo + cobradoTransferencia;
  const fiado = suma(d.pagos.filter((p) => p.metodo === "cuenta_corriente"));
  const gastos = suma(d.gastos);
  const gastosFijos = suma(d.gastos.filter((g) => g.tipo === "fijo"));
  const gastosPagados = suma(d.gastos.filter((g) => g.estado === "pagado"));
  const porPagar = suma(d.pendientes);
  const porCobrar = d.clientes.reduce((acc, c) => acc + Math.max(0, Number(c.saldo)), 0);
  const ganancia = ventas - gastos;
  const flujo = cobrado - gastosPagados;
  const libre = flujo - porPagar;
  const porCategoria = new Map();
  for (const g of d.gastos) porCategoria.set(g.categoria, (porCategoria.get(g.categoria) ?? 0) + Number(g.monto));
  return {
    ventas,
    ventasNoche,
    ventasMediodia,
    ventasCancha,
    cantidadVentas: d.ventas.length,
    cobrado,
    cobradoEfectivo,
    cobradoTransferencia,
    fiado,
    gastos,
    gastosFijos,
    gastosVariables: gastos - gastosFijos,
    gastosPagados,
    porPagar,
    vencidos: d.pendientes.filter((g) => g.vencimiento && g.vencimiento < hoyInput()).length,
    porCobrar,
    ganancia,
    margen: ventas > 0 ? ganancia / ventas : null,
    flujo,
    libre,
    categorias: [...porCategoria.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// Ingresos cobrados y gastos por día (o por mes si el período es largo)
function serie(d, periodo) {
  const porMes = periodo.hasta - periodo.desde > 62 * 864e5;
  const clave = (fecha) => (porMes ? claveDia(fecha).slice(0, 7) : claveDia(fecha));
  const mapa = new Map();
  const cursor = new Date(periodo.desde);
  while (cursor < periodo.hasta) {
    const k = clave(cursor);
    if (!mapa.has(k)) mapa.set(k, { clave: k, fecha: new Date(cursor), ingresos: 0, gastos: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const p of d.pagos) {
    if (p.metodo === "cuenta_corriente") continue;
    const fila = mapa.get(clave(p.created_at));
    if (fila) fila.ingresos += Number(p.monto);
  }
  for (const g of d.gastos) {
    const [a, m, dia] = g.fecha.split("-").map(Number);
    const fila = mapa.get(clave(new Date(a, m - 1, dia)));
    if (fila) fila.gastos += Number(g.monto);
  }
  const etiqueta = (f) =>
    porMes ? f.fecha.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }) : f.fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  return { porMes, filas: [...mapa.values()].map((f) => ({ ...f, etiqueta: etiqueta(f) })) };
}

function TooltipSerie({ active, payload, porMes }) {
  if (!active || !payload?.length) return null;
  const f = payload[0].payload;
  return (
    <div className="cifras rounded-lg border border-borde bg-fondo px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-tinta-suave">
        {porMes ? f.fecha.toLocaleDateString("es-AR", { month: "long", year: "numeric" }) : f.fecha.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <p className="flex items-center gap-2 text-tinta">
        <span className="size-2.5 rounded-sm" style={{ background: COLOR_INGRESOS }} /> Cobrado: <strong>{formatearPesos(f.ingresos)}</strong>
      </p>
      <p className="flex items-center gap-2 text-tinta">
        <span className="size-2.5 rounded-sm" style={{ background: COLOR_GASTOS }} /> Gastos: <strong>{formatearPesos(f.gastos)}</strong>
      </p>
      <p className="mt-1 border-t border-borde pt-1 text-tinta">
        Resultado: <strong>{formatearPesos(f.ingresos - f.gastos)}</strong>
      </p>
    </div>
  );
}

function Tarjeta({ titulo, valor, detalle, tono = "", grande = false }) {
  return (
    <div className={`tarjeta p-4 ${grande ? "border-2 border-tinta" : ""}`}>
      <p className="text-xs text-tinta-suave">{titulo}</p>
      <p className={`cifras mt-1 font-bold ${grande ? "text-3xl" : "text-xl"} ${tono}`}>{valor}</p>
      {detalle && <div className="mt-1 text-xs text-tinta-suave">{detalle}</div>}
    </div>
  );
}

function hojaResumen(r, periodo) {
  return {
    tipo: "resumen",
    nombre: "Resumen",
    titulo: "Resumen financiero",
    subtitulo: `Período: ${textoPeriodo(periodo)}`,
    filas: [
      { seccion: "Resultado (devengado)" },
      { concepto: "Ventas cobradas del período", valor: r.ventas, detalle: `${r.cantidadVentas} ventas cerradas (incluye lo vendido a cuenta corriente)` },
      { concepto: "   Venta noche", valor: r.ventasNoche },
      { concepto: "   Venta mediodía", valor: r.ventasMediodia },
      { concepto: "   Cancha (alquileres)", valor: r.ventasCancha },
      { concepto: "Gastos del período", valor: r.gastos, detalle: "Pagados y pendientes, por fecha del gasto" },
      { concepto: "   Costos fijos", valor: r.gastosFijos },
      { concepto: "   Costos variables", valor: r.gastosVariables },
      { concepto: "GANANCIA DEL PERÍODO", valor: r.ganancia, destacado: true, detalle: "Ventas − gastos" },
      { concepto: "Margen sobre ventas", valor: r.margen ?? 0, tipo: "porcentaje" },
      { seccion: "Dinero (percibido)" },
      { concepto: "Cobrado en efectivo", valor: r.cobradoEfectivo, detalle: "Ventas y pagos de cuentas corrientes" },
      { concepto: "Cobrado por transferencia", valor: r.cobradoTransferencia },
      { concepto: "Total cobrado", valor: r.cobrado },
      { concepto: "Gastos pagados", valor: r.gastosPagados },
      { concepto: "DINERO QUE QUEDÓ", valor: r.flujo, destacado: true, detalle: "Total cobrado − gastos pagados" },
      { seccion: "Saldos a la fecha" },
      { concepto: "Por cobrar (cuentas corrientes)", valor: r.porCobrar },
      { concepto: "Por pagar (gastos pendientes)", valor: r.porPagar },
      { concepto: "Vendido a cuenta corriente en el período", valor: r.fiado },
      { concepto: "LIBRE PARA GASTAR", valor: r.libre, destacado: true, detalle: "Dinero que quedó − gastos pendientes de pago" },
    ],
  };
}

// Finanzas: cuánto se vende, cuánto se gana y cuánto se puede gastar
export default function Finanzas() {
  const [rango, setRango] = useState("mes");
  const [desdeTexto, setDesdeTexto] = useState(() => fechaInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [hastaTexto, setHastaTexto] = useState(hoyInput);
  const [resultado, setResultado] = useState({ clave: null, datos: null, error: null });
  const [verTabla, setVerTabla] = useState(false);
  const [exportando, setExportando] = useState(false);

  const periodo = useMemo(() => calcularRango(rango, desdeTexto, hastaTexto), [rango, desdeTexto, hastaTexto]);
  const clave = periodo ? `${periodo.desde.getTime()}-${periodo.hasta.getTime()}` : null;

  useEffect(() => {
    if (!periodo) return;
    let activo = true;
    obtenerFinanzas(periodo)
      .then((datos) => activo && setResultado({ clave, datos, error: null }))
      .catch((error) => activo && setResultado({ clave, datos: null, error }));
    return () => {
      activo = false;
    };
  }, [periodo, clave]);

  const datos = resultado.clave === clave ? resultado.datos : null;
  const r = useMemo(() => (datos ? calcular(datos) : null), [datos]);
  const grafico = useMemo(() => (datos && periodo ? serie(datos, periodo) : null), [datos, periodo]);

  async function exportar() {
    if (!datos) return;
    setExportando(true);
    try {
      const sub = textoPeriodo(periodo);
      await descargarExcel(`reporte-contable_${sufijoArchivo(periodo)}`, [
        hojaResumen(r, periodo),
        hojaVentas(datos.ventas, sub),
        hojaProductos(datos.ventas, sub),
        hojaCobros(datos.pagos, sub),
        hojaGastos(datos.gastos, sub),
        hojaArqueos(datos.cajas, sub),
        hojaCuentas(datos.clientes, `Saldos al ${new Date().toLocaleDateString("es-AR")}`),
      ]);
      toast.success("Reporte para el contador descargado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Finanzas</h1>
          <p className="text-sm text-tinta-suave">Cuánto vendés, cuánto ganás y cuánto podés gastar, con los números de la caja y los gastos.</p>
        </div>
        <button type="button" className="boton-primario" onClick={exportar} disabled={!datos || exportando}>
          <IconoExcel className="size-4" /> {exportando ? "Generando…" : "Reporte para el contador (Excel)"}
        </button>
      </div>

      <div className="tarjeta flex flex-wrap items-end gap-3 p-3">
        <div className="sin-scrollbar flex gap-1 overflow-x-auto" role="group" aria-label="Período">
          {RANGOS_MES.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={rango === x.id}
              onClick={() => setRango(x.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${rango === x.id ? "bg-tinta text-fondo" : "bg-fondo text-tinta-suave hover:text-tinta"}`}
            >
              {x.nombre}
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
        {periodo && <p className="ml-auto text-xs text-tinta-suave">{textoPeriodo(periodo)}</p>}
      </div>

      {!periodo ? (
        <p className="tarjeta p-6 text-center text-sm text-tinta-suave">Elegí un rango de fechas válido.</p>
      ) : resultado.error && resultado.clave === clave ? (
        <p className="tarjeta p-6 text-center text-sm text-brasa">{mensajeDeError(resultado.error, "No se pudieron cargar los números.")}</p>
      ) : !r ? (
        <Cargando texto="Calculando…" />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={`rounded-2xl border-2 p-5 ${r.ganancia >= 0 ? "border-emerald-500 bg-emerald-50" : "border-rojo bg-rojo/5"}`}>
              <p className="text-sm font-semibold text-tinta-suave">Ganancia del período</p>
              <p className={`cifras mt-1 text-4xl font-bold ${r.ganancia >= 0 ? "text-emerald-800" : "text-rojo"}`}>{formatearPesos(r.ganancia)}</p>
              <p className="mt-1 text-sm text-tinta-suave">
                Ventas {formatearPesos(r.ventas)} − gastos {formatearPesos(r.gastos)}
                {r.margen != null && ` · margen ${formatearPorcentaje(r.margen)}`}
              </p>
            </div>
            <div className={`rounded-2xl border-2 p-5 ${r.libre >= 0 ? "border-tinta bg-papel" : "border-rojo bg-rojo/5"}`}>
              <p className="text-sm font-semibold text-tinta-suave">Libre para gastar</p>
              <p className={`cifras mt-1 text-4xl font-bold ${r.libre >= 0 ? "text-tinta" : "text-rojo"}`}>{formatearPesos(r.libre)}</p>
              <p className="mt-1 text-sm text-tinta-suave">
                Cobrado {formatearPesos(r.cobrado)} − gastos pagados {formatearPesos(r.gastosPagados)} − facturas por pagar {formatearPesos(r.porPagar)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tarjeta
              titulo="Ventas cobradas"
              valor={formatearPesos(r.ventas)}
              detalle={
                <>
                  Noche {formatearPesos(r.ventasNoche)} · Mediodía {formatearPesos(r.ventasMediodia)} · Cancha{" "}
                  {formatearPesos(r.ventasCancha)}
                </>
              }
            />
            <Tarjeta
              titulo="Dinero que entró"
              valor={formatearPesos(r.cobrado)}
              detalle={
                <>
                  Efectivo {formatearPesos(r.cobradoEfectivo)} · Transf. {formatearPesos(r.cobradoTransferencia)}
                </>
              }
            />
            <Tarjeta
              titulo="Gastos"
              valor={formatearPesos(r.gastos)}
              detalle={
                <>
                  Fijos {formatearPesos(r.gastosFijos)} · Variables {formatearPesos(r.gastosVariables)}
                </>
              }
            />
            <Tarjeta titulo="Dinero que quedó" valor={formatearPesos(r.flujo)} tono={r.flujo < 0 ? "text-rojo" : ""} detalle="Lo que entró menos lo que se pagó" />
            <Tarjeta titulo="Por cobrar (cuentas corrientes)" valor={formatearPesos(r.porCobrar)} detalle={`Fiado en el período: ${formatearPesos(r.fiado)}`} />
            <Tarjeta
              titulo="Por pagar (facturas pendientes)"
              valor={formatearPesos(r.porPagar)}
              tono={r.porPagar > 0 ? "text-brasa" : ""}
              detalle={
                r.vencidos > 0 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-rojo">
                    <IconoAlerta className="size-3.5" /> {r.vencidos} vencidas
                  </span>
                ) : (
                  "Todas las fechas"
                )
              }
            />
            <Tarjeta titulo="Ticket promedio" valor={formatearPesos(r.cantidadVentas ? r.ventas / r.cantidadVentas : 0)} detalle={`${r.cantidadVentas} ventas`} />
            <Tarjeta titulo="Costos fijos sobre ventas" valor={r.ventas > 0 ? formatearPorcentaje(r.gastosFijos / r.ventas) : "—"} detalle="Cuánto de cada peso vendido va a fijos" />
          </div>

          <div className="tarjeta p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Dinero que entró y gastos {grafico.porMes ? "por mes" : "por día"}</h2>
                <div className="mt-1 flex gap-4 text-xs text-tinta-suave">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: COLOR_INGRESOS }} /> Cobrado
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: COLOR_GASTOS }} /> Gastos
                  </span>
                </div>
              </div>
              <button type="button" className="text-xs font-medium text-tinta-suave underline-offset-2 hover:text-tinta hover:underline" onClick={() => setVerTabla((v) => !v)}>
                {verTabla ? "Ver gráfico" : "Ver como tabla"}
              </button>
            </div>
            {verTabla ? (
              <div className="max-h-80 overflow-auto">
                <table className="cifras w-full text-left text-sm">
                  <thead className="sticky top-0 bg-papel text-xs text-tinta-suave">
                    <tr className="border-b border-borde">
                      <th className="py-2 font-medium">{grafico.porMes ? "Mes" : "Día"}</th>
                      <th className="py-2 text-right font-medium">Cobrado</th>
                      <th className="py-2 text-right font-medium">Gastos</th>
                      <th className="py-2 text-right font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grafico.filas.map((f) => (
                      <tr key={f.clave} className="border-b border-borde/60">
                        <td className="py-1.5">{f.etiqueta}</td>
                        <td className="py-1.5 text-right">{formatearPesos(f.ingresos)}</td>
                        <td className="py-1.5 text-right">{formatearPesos(f.gastos)}</td>
                        <td className={`py-1.5 text-right font-semibold ${f.ingresos - f.gastos < 0 ? "text-rojo" : ""}`}>{formatearPesos(f.ingresos - f.gastos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : grafico.filas.some((f) => f.ingresos || f.gastos) ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={grafico.filas} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke={COLOR_GRILLA} />
                    <XAxis dataKey="etiqueta" tick={{ fill: COLOR_EJE, fontSize: 11 }} axisLine={{ stroke: COLOR_GRILLA }} tickLine={false} minTickGap={12} />
                    <YAxis tickFormatter={(v) => formatoCorto.format(v)} tick={{ fill: COLOR_EJE, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip content={<TooltipSerie porMes={grafico.porMes} />} cursor={{ fill: "rgb(43 33 27 / 0.06)" }} />
                    <Bar dataKey="ingresos" name="Cobrado" fill={COLOR_INGRESOS} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="gastos" name="Gastos" fill={COLOR_GASTOS} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="grid h-40 place-items-center text-sm text-tinta-suave">Sin cobros ni gastos en este período.</p>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="tarjeta p-4">
              <h2 className="mb-3 text-sm font-semibold">En qué se va la plata</h2>
              {r.categorias.length === 0 ? (
                <p className="py-6 text-center text-sm text-tinta-suave">Sin gastos cargados en este período.</p>
              ) : (
                <ul className="space-y-2.5">
                  {r.categorias.slice(0, 8).map(([nombre, monto]) => (
                    <li key={nombre}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate">{nombre}</span>
                        <span className="cifras shrink-0">
                          <strong>{formatearPesos(monto)}</strong>
                          <span className="ml-2 text-xs text-tinta-suave">{formatearPorcentaje(monto / r.gastos)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-borde">
                        <div className="h-2 rounded-full" style={{ width: `${(monto / r.categorias[0][1]) * 100}%`, background: COLOR_GASTOS }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="tarjeta space-y-2 p-4 text-sm">
              <h2 className="text-sm font-semibold">Cómo leer estos números</h2>
              <p>
                <strong>Ganancia:</strong> lo que vendiste menos lo que gastaste en el período. Incluye lo vendido a cuenta corriente y las facturas que todavía no pagaste.
              </p>
              <p>
                <strong>Dinero que quedó:</strong> la plata que realmente entró (efectivo y transferencias, incluidos los pagos de cuentas corrientes) menos los gastos que ya pagaste.
              </p>
              <p>
                <strong>Libre para gastar:</strong> el dinero que quedó menos las facturas pendientes de pago. Es lo que podés usar sin quedarte corto.
              </p>
              <p className="text-xs text-tinta-suave">Las ventas cuentan cuando se cobran (cuenta cerrada). Para que los números den bien, cargá todos los gastos, incluidos sueldos, alquiler e impuestos.</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
