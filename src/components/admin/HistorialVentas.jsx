import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearFechaHora, formatearPrecio } from "../../lib/formato";
import { IconoActualizar, IconoDescargar, IconoMas } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import DetalleVenta from "./DetalleVenta";
import VentaManual from "./VentaManual";
import { GraficoFacturacion, RankingComidas } from "./GraficoVentas";
import {
  ESTADOS,
  RANGOS,
  calcularRango,
  descargarArchivo,
  facturacionPorDia,
  hoyInput,
  masVendidas,
  unidadesDeVenta,
  ventasACsv,
} from "./ventasUtils";

const LIMITE_VENTAS = 2000;

async function obtenerVentas({ desde, hasta }) {
  const { data, error } = await supabase
    .from("ventas")
    .select("*, venta_items(*)")
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString())
    .order("created_at", { ascending: false })
    .limit(LIMITE_VENTAS);
  if (error) throw error;
  return data;
}

function Resumen({ titulo, valor, detalle }) {
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-tinta-suave">{titulo}</p>
      <p className="mt-1 text-xl font-bold sm:text-2xl">{valor}</p>
      {detalle && <p className="text-xs text-tinta-suave">{detalle}</p>}
    </div>
  );
}

export default function HistorialVentas({ comidas, onStockCambiado }) {
  const [rango, setRango] = useState("7");
  const [desdeTexto, setDesdeTexto] = useState(() => fechaInput(Date.now() - 6 * 864e5));
  const [hastaTexto, setHastaTexto] = useState(hoyInput);
  const [estadoFiltro, setEstadoFiltro] = useState("todos");
  const [resultado, setResultado] = useState({ clave: null, ventas: [], error: null });
  const [recarga, setRecarga] = useState(0);
  const [detalleId, setDetalleId] = useState(null);
  const [aCancelar, setACancelar] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [manualAbierta, setManualAbierta] = useState(false);

  const periodo = useMemo(() => calcularRango(rango, desdeTexto, hastaTexto), [rango, desdeTexto, hastaTexto]);
  const clave = periodo ? `${periodo.desde.getTime()}-${periodo.hasta.getTime()}-${recarga}` : null;

  useEffect(() => {
    if (!periodo) return;
    let activo = true;
    obtenerVentas(periodo)
      .then((ventas) => activo && setResultado({ clave, ventas, error: null }))
      .catch((error) => activo && setResultado({ clave, ventas: [], error }));
    return () => {
      activo = false;
    };
  }, [periodo, clave]);

  const cargando = periodo && resultado.clave !== clave;
  const ventas = resultado.ventas;

  const filtradas = useMemo(
    () => (estadoFiltro === "todos" ? ventas : ventas.filter((v) => v.estado === estadoFiltro)),
    [ventas, estadoFiltro]
  );

  const resumen = useMemo(() => {
    const confirmadas = ventas.filter((v) => v.estado === "confirmada");
    const facturado = confirmadas.reduce((acc, v) => acc + Number(v.total), 0);
    return {
      confirmadas: confirmadas.length,
      facturado,
      ticket: confirmadas.length ? facturado / confirmadas.length : 0,
      pendientes: ventas.filter((v) => v.estado === "pendiente").length,
    };
  }, [ventas]);

  const dias = useMemo(() => (periodo ? facturacionPorDia(ventas, periodo.desde, periodo.hasta) : []), [ventas, periodo]);
  const ranking = useMemo(() => masVendidas(ventas), [ventas]);

  const recargar = () => setRecarga((n) => n + 1);

  async function confirmar(venta) {
    setProcesando(true);
    const { error } = await supabase.rpc("confirmar_venta", { venta_id: venta.id });
    setProcesando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo confirmar la venta."));
      return;
    }
    toast.success(`Pedido #${venta.numero} confirmado. Se descontó el stock.`);
    recargar();
    onStockCambiado();
  }

  async function cancelar() {
    const venta = aCancelar;
    setProcesando(true);
    const { error } = await supabase.rpc("cancelar_venta", { venta_id: venta.id });
    setProcesando(false);
    setACancelar(null);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo cancelar la venta."));
      return;
    }
    toast.success(
      venta.estado === "confirmada"
        ? `Pedido #${venta.numero} cancelado. Se devolvió el stock.`
        : `Pedido #${venta.numero} cancelado.`
    );
    recargar();
    if (venta.estado === "confirmada") onStockCambiado();
  }

  function exportar() {
    if (filtradas.length === 0) {
      toast.error("No hay ventas para exportar con estos filtros.");
      return;
    }
    const nombre = `ventas-${fechaInput(periodo.desde)}-a-${fechaInput(periodo.hasta - 864e5)}.csv`;
    descargarArchivo(ventasACsv(filtradas), nombre);
    toast.success(`Exportaste ${filtradas.length} ventas`);
  }

  const detalle = detalleId ? ventas.find((v) => v.id === detalleId) : null;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Ventas</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario px-3" onClick={recargar} aria-label="Actualizar ventas">
            <IconoActualizar className="size-4" />
          </button>
          <button type="button" className="boton-secundario" onClick={exportar} disabled={cargando}>
            <IconoDescargar className="size-4" /> Exportar CSV
          </button>
          <button type="button" className="boton-primario" onClick={() => setManualAbierta(true)}>
            <IconoMas className="size-4" /> Venta manual
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="tarjeta flex flex-wrap items-end gap-3 p-3">
        <div className="sin-scrollbar flex gap-1 overflow-x-auto" role="group" aria-label="Período">
          {RANGOS.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={rango === r.id}
              onClick={() => setRango(r.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                rango === r.id ? "bg-palmera text-fondo" : "bg-fondo text-tinta-suave hover:text-tinta"
              }`}
            >
              {r.nombre}
            </button>
          ))}
        </div>
        {rango === "personalizado" && (
          <div className="flex gap-2">
            <div>
              <label htmlFor="desde" className="etiqueta">
                Desde
              </label>
              <input id="desde" type="date" className="campo py-1.5" value={desdeTexto} max={hastaTexto} onChange={(e) => setDesdeTexto(e.target.value)} />
            </div>
            <div>
              <label htmlFor="hasta" className="etiqueta">
                Hasta
              </label>
              <input id="hasta" type="date" className="campo py-1.5" value={hastaTexto} min={desdeTexto} onChange={(e) => setHastaTexto(e.target.value)} />
            </div>
          </div>
        )}
        <div className="ml-auto">
          <label htmlFor="estado" className="etiqueta">
            Estado
          </label>
          <select id="estado" className="campo py-1.5" value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
            <option value="todos">Todos</option>
            {Object.entries(ESTADOS).map(([id, e]) => (
              <option key={id} value={id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!periodo ? (
        <p className="tarjeta p-6 text-center text-sm text-tinta-suave">Elegí un rango de fechas válido.</p>
      ) : cargando ? (
        <Cargando texto="Cargando ventas…" />
      ) : resultado.error ? (
        <div className="tarjeta p-6 text-center">
          <p className="font-semibold">No pudimos cargar las ventas.</p>
          <p className="text-sm text-tinta-suave">{mensajeDeError(resultado.error)}</p>
          <button type="button" className="boton-primario mt-4" onClick={recargar}>
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Resumen titulo="Ventas confirmadas" valor={resumen.confirmadas} />
            <Resumen titulo="Total facturado" valor={formatearPrecio(resumen.facturado)} />
            <Resumen titulo="Ticket promedio" valor={formatearPrecio(resumen.ticket)} />
            <Resumen titulo="Pedidos pendientes" valor={resumen.pendientes} detalle="Para confirmar o cancelar" />
          </div>

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <GraficoFacturacion dias={dias} />
            <RankingComidas ranking={ranking} />
          </div>

          {ventas.length >= LIMITE_VENTAS && (
            <p className="text-xs text-brasa">
              Se muestran las últimas {LIMITE_VENTAS} ventas del período. Elegí un rango más corto para ver todo.
            </p>
          )}

          {filtradas.length === 0 ? (
            <div className="tarjeta p-8 text-center text-tinta-suave">No hay ventas en este período con ese estado.</div>
          ) : (
            <div className="tarjeta overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs text-tinta-suave">
                  <tr className="border-b border-borde">
                    <th className="px-3 py-2.5 font-medium">#</th>
                    <th className="px-3 py-2.5 font-medium">Fecha y hora</th>
                    <th className="px-3 py-2.5 font-medium">Cliente</th>
                    <th className="px-3 py-2.5 text-right font-medium">Ítems</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="px-3 py-2.5 font-medium">Estado</th>
                    <th className="px-3 py-2.5 font-medium">Origen</th>
                    <th className="px-3 py-2.5 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((v) => (
                    <tr key={v.id} className="border-b border-borde/60 last:border-0 hover:bg-borde/30">
                      <td className="px-3 py-2.5 font-semibold">
                        <button type="button" className="underline-offset-2 hover:underline" onClick={() => setDetalleId(v.id)}>
                          {v.numero}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{formatearFechaHora(v.created_at)}</td>
                      <td className="max-w-40 truncate px-3 py-2.5">{v.cliente_nombre || "—"}</td>
                      <td className="px-3 py-2.5 text-right">{unidadesDeVenta(v)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{formatearPrecio(v.total)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADOS[v.estado]?.clase}`}>
                          {ESTADOS[v.estado]?.nombre}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-tinta-suave">{v.origen === "manual" ? "Manual" : "Web"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button type="button" className="boton-secundario px-2.5 py-1.5 text-xs" onClick={() => setDetalleId(v.id)}>
                            Ver
                          </button>
                          {v.estado === "pendiente" && (
                            <button
                              type="button"
                              className="boton-primario px-2.5 py-1.5 text-xs"
                              onClick={() => confirmar(v)}
                              disabled={procesando}
                            >
                              Confirmar
                            </button>
                          )}
                          {v.estado !== "cancelada" && (
                            <button
                              type="button"
                              className="boton-secundario px-2.5 py-1.5 text-xs hover:text-brasa"
                              onClick={() => setACancelar(v)}
                              disabled={procesando}
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <DetalleVenta
        venta={detalle}
        onCerrar={() => setDetalleId(null)}
        onConfirmar={confirmar}
        onCancelar={(v) => setACancelar(v)}
        procesando={procesando}
      />

      <Confirmar
        abierto={Boolean(aCancelar)}
        titulo={`Cancelar pedido #${aCancelar?.numero ?? ""}`}
        mensaje={
          aCancelar?.estado === "confirmada"
            ? "La venta ya estaba confirmada: al cancelarla se devuelve el stock de cada producto."
            : "El pedido queda como cancelado. No cambia el stock."
        }
        textoConfirmar="Cancelar pedido"
        procesando={procesando}
        onConfirmar={cancelar}
        onCancelar={() => setACancelar(null)}
      />

      <VentaManual
        abierto={manualAbierta}
        comidas={comidas}
        onCerrar={() => setManualAbierta(false)}
        onRegistrada={() => {
          setManualAbierta(false);
          recargar();
          onStockCambiado();
        }}
      />
    </section>
  );
}
