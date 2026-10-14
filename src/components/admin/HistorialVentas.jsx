import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearFechaHora, formatearPrecio } from "../../lib/formato";
import { IconoActualizar, IconoBasura, IconoDescargar, IconoEditar, IconoMas, IconoOjo } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import DetalleVenta from "./DetalleVenta";
import EditarVenta from "./EditarVenta";
import VentaManual from "./VentaManual";
import PedidosAbiertos from "./PedidosAbiertos";
import { ConfirmarCierre, SelectorEstado } from "./EstadoPedido";
import { GraficoFacturacion, RankingComidas } from "./GraficoVentas";
import {
  ESTADOS,
  ESTADOS_ABIERTOS,
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
const LIMITE_ABIERTOS = 200;

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

// Pedidos sin cerrar de cualquier fecha (así no se pierde ninguno de días anteriores)
async function obtenerAbiertos() {
  const { data, error } = await supabase
    .from("ventas")
    .select("*, venta_items(*)")
    .in("estado", ESTADOS_ABIERTOS)
    .order("created_at", { ascending: true })
    .limit(LIMITE_ABIERTOS);
  if (error) throw error;
  return data;
}

function Resumen({ titulo, valor, detalle, destacado = false }) {
  return (
    <div className={`tarjeta p-4 ${destacado ? "border-2 border-palmera" : ""}`}>
      <p className="text-xs text-tinta-suave">{titulo}</p>
      <p className={`mt-1 text-xl font-bold sm:text-2xl ${destacado ? "text-palmera" : ""}`}>{valor}</p>
      {detalle && <p className="text-xs text-tinta-suave">{detalle}</p>}
    </div>
  );
}

function BotonIcono({ onClick, etiqueta, children, peligro = false, disabled }) {
  return (
    <button
      type="button"
      className={`boton-secundario px-2.5 py-1.5 text-xs ${peligro ? "hover:text-rojo" : ""}`}
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// actualizacion: cambia cuando el panel se entera de pedidos nuevos o modificados (tiempo real)
// onCambio: avisa al panel que hubo un cambio acá (para el contador de la pestaña)
export default function HistorialVentas({ comidas, actualizacion = 0, onCambio }) {
  const [rango, setRango] = useState("7");
  const [desdeTexto, setDesdeTexto] = useState(() => fechaInput(Date.now() - 6 * 864e5));
  const [hastaTexto, setHastaTexto] = useState(hoyInput);
  const [estadoFiltro, setEstadoFiltro] = useState("todos");
  const [resultado, setResultado] = useState({ clave: null, ventas: [], error: null });
  const [abiertos, setAbiertos] = useState({ vuelta: null, ventas: [], error: null });
  const [recarga, setRecarga] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  const [detalleId, setDetalleId] = useState(null);
  const [editando, setEditando] = useState(null);
  const [aCerrar, setACerrar] = useState(null);
  const [aCancelar, setACancelar] = useState(null);
  const [aBorrar, setABorrar] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [manualAbierta, setManualAbierta] = useState(false);

  const periodo = useMemo(() => calcularRango(rango, desdeTexto, hastaTexto), [rango, desdeTexto, hastaTexto]);
  const vuelta = `${recarga}-${actualizacion}`;
  const clave = periodo ? `${periodo.desde.getTime()}-${periodo.hasta.getTime()}-${vuelta}` : null;

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

  useEffect(() => {
    let activo = true;
    obtenerAbiertos()
      .then((ventas) => activo && setAbiertos({ vuelta, ventas, error: null }))
      .catch((error) => activo && setAbiertos({ vuelta, ventas: [], error }));
    return () => {
      activo = false;
    };
  }, [vuelta]);

  // Reloj para el "hace X min" de los pedidos abiertos
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cargando = periodo && resultado.clave !== clave;
  const cargandoAbiertos = abiertos.vuelta !== vuelta && abiertos.ventas.length === 0;
  const ventas = resultado.ventas;

  const filtradas = useMemo(
    () => (estadoFiltro === "todos" ? ventas : ventas.filter((v) => v.estado === estadoFiltro)),
    [ventas, estadoFiltro]
  );

  const resumen = useMemo(() => {
    const cerradas = ventas.filter((v) => v.estado === "cerrado");
    const facturado = cerradas.reduce((acc, v) => acc + Number(v.total), 0);
    return {
      cerradas: cerradas.length,
      facturado,
      ticket: cerradas.length ? facturado / cerradas.length : 0,
    };
  }, [ventas]);

  const dias = useMemo(() => (periodo ? facturacionPorDia(ventas, periodo.desde, periodo.hasta) : []), [ventas, periodo]);
  const ranking = useMemo(() => masVendidas(ventas), [ventas]);

  const recargar = () => {
    setRecarga((n) => n + 1);
    setAhora(Date.now());
    onCambio?.();
  };

  // Un pedido puede estar en las dos listas: se busca primero en los abiertos
  const buscar = (id) => abiertos.ventas.find((v) => v.id === id) ?? ventas.find((v) => v.id === id) ?? null;
  const detalle = detalleId ? buscar(detalleId) : null;

  async function guardarEstado(venta, estado, mensaje = `Pedido #${venta.numero}: ${ESTADOS[estado].nombre}`) {
    setProcesando(true);
    const { error } = await supabase.from("ventas").update({ estado }).eq("id", venta.id);
    setProcesando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo cambiar el estado del pedido."));
      return false;
    }
    toast.success(mensaje);
    recargar();
    return true;
  }

  // Cerrar y cancelar piden confirmación; el resto se guarda directo
  function cambiarEstado(venta, estado) {
    if (estado === venta.estado) return;
    if (estado === "cerrado") return setACerrar(venta);
    if (estado === "cancelado") return setACancelar(venta);
    guardarEstado(venta, estado);
  }

  async function cerrar() {
    const venta = aCerrar;
    if (await guardarEstado(venta, "cerrado", `¡Pedido #${venta.numero} cerrado! Ya cuenta en la facturación.`)) {
      setDetalleId(null);
    }
    setACerrar(null);
  }

  async function cancelar() {
    await guardarEstado(aCancelar, "cancelado");
    setACancelar(null);
  }

  async function borrar() {
    const venta = aBorrar;
    setProcesando(true);
    const { error } = await supabase.from("ventas").delete().eq("id", venta.id);
    setProcesando(false);
    setABorrar(null);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo borrar el pedido."));
      return;
    }
    toast.success(`Borraste el pedido #${venta.numero}`);
    setDetalleId(null);
    recargar();
  }

  function editar(venta) {
    setDetalleId(null);
    setEditando(venta);
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

  const acciones = {
    procesando,
    onEstado: cambiarEstado,
    onCerrar: (v) => setACerrar(v),
    onVer: (v) => setDetalleId(v.id),
    onEditar: editar,
    onBorrar: (v) => setABorrar(v),
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Pedidos y ventas</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario px-3" onClick={recargar} aria-label="Actualizar pedidos">
            <IconoActualizar className="size-4" /> <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button type="button" className="boton-secundario" onClick={exportar} disabled={cargando}>
            <IconoDescargar className="size-4" /> Exportar CSV
          </button>
          <button type="button" className="boton-primario" onClick={() => setManualAbierta(true)}>
            <IconoMas className="size-4" /> Venta manual
          </button>
        </div>
      </div>

      <PedidosAbiertos
        pedidos={abiertos.ventas}
        cargando={cargandoAbiertos}
        error={abiertos.error}
        ahora={ahora}
        {...acciones}
      />

      <h2 className="pt-2 text-lg font-semibold">Historial</h2>

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
            <Resumen titulo="Pedidos cerrados" valor={resumen.cerradas} />
            <Resumen titulo="Total facturado" valor={formatearPrecio(resumen.facturado)} detalle="Solo pedidos cerrados" />
            <Resumen titulo="Ticket promedio" valor={formatearPrecio(resumen.ticket)} />
            <Resumen
              titulo="Sin cerrar (todas las fechas)"
              valor={abiertos.ventas.length}
              detalle="Cerralos al cobrarlos"
              destacado={abiertos.ventas.length > 0}
            />
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
              <table className="w-full min-w-[780px] text-left text-sm">
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
                        <SelectorEstado venta={v} onCambiar={cambiarEstado} disabled={procesando} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-tinta-suave">{v.origen === "manual" ? "Manual" : "Web"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <BotonIcono onClick={() => setDetalleId(v.id)} etiqueta={`Ver pedido #${v.numero}`}>
                            <IconoOjo className="size-4" />
                          </BotonIcono>
                          {v.estado !== "cancelado" && (
                            <BotonIcono onClick={() => editar(v)} etiqueta={`Editar pedido #${v.numero}`} disabled={procesando}>
                              <IconoEditar className="size-4" />
                            </BotonIcono>
                          )}
                          <BotonIcono onClick={() => setABorrar(v)} etiqueta={`Borrar pedido #${v.numero}`} disabled={procesando} peligro>
                            <IconoBasura className="size-4" />
                          </BotonIcono>
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
        onCerrarModal={() => setDetalleId(null)}
        onEstado={cambiarEstado}
        onCerrarPedido={(v) => setACerrar(v)}
        onEditar={editar}
        onBorrar={(v) => setABorrar(v)}
        procesando={procesando}
      />

      <EditarVenta
        venta={editando}
        comidas={comidas}
        onCerrar={() => setEditando(null)}
        onGuardada={() => {
          setEditando(null);
          recargar();
        }}
      />

      <ConfirmarCierre venta={aCerrar} procesando={procesando} onConfirmar={cerrar} onVolver={() => setACerrar(null)} />

      <Confirmar
        abierto={Boolean(aCancelar)}
        titulo={`Cancelar pedido #${aCancelar?.numero ?? ""}`}
        mensaje="El pedido queda como cancelado y no cuenta en la facturación. Si te equivocaste, podés cambiarle el estado después."
        textoConfirmar="Cancelar pedido"
        procesando={procesando}
        onConfirmar={cancelar}
        onCancelar={() => setACancelar(null)}
      />

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo={`Borrar pedido #${aBorrar?.numero ?? ""}`}
        mensaje="Se borra para siempre, con todos sus productos, y deja de aparecer en el historial y en la facturación. Si el cliente no lo quiso, mejor marcalo como Cancelado."
        textoConfirmar="Borrar para siempre"
        procesando={procesando}
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />

      <VentaManual
        abierto={manualAbierta}
        comidas={comidas}
        onCerrar={() => setManualAbierta(false)}
        onRegistrada={() => {
          setManualAbierta(false);
          recargar();
        }}
      />
    </section>
  );
}
