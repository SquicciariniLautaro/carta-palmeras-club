import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearFechaHora, formatearPesos, formatearPrecio } from "../../lib/formato";
import { descargarExcel } from "../../lib/excel";
import { hojaProductos, hojaVentas } from "../../lib/reportes";
import { imprimirComanda, imprimirTicket, leerConfigImpresora } from "../../lib/impresion";
import { IconoActualizar, IconoBasura, IconoExcel, IconoMas, IconoOjo, IconoWhatsApp } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import DetalleVenta from "./DetalleVenta";
import EditarVenta from "./EditarVenta";
import VentaLocal from "./VentaLocal";
import CobrarVenta from "./CobrarVenta";
import AvisoCliente from "./AvisoCliente";
import TableroPedidos from "./TableroPedidos";
import { InsigniaEstado } from "./EstadoPedido";
import { GraficoFacturacion, RankingComidas } from "./GraficoVentas";
import {
  ESTADOS_ABIERTOS,
  METODOS_PAGO,
  RANGOS,
  TURNOS,
  calcularRango,
  facturacionPorDia,
  hoyInput,
  idsDeKiosco,
  masVendidas,
  necesitaCocina,
  nombreEstado,
  sufijoArchivo,
  textoPagos,
  textoPeriodo,
  unidadesDeVenta,
} from "./ventasUtils";

const LIMITE_VENTAS = 2000;
const LIMITE_ABIERTOS = 200;
const COLUMNAS_VENTA = "*, venta_items(*), pagos(id, metodo, monto, cliente_id, usuario, clientes(nombre))";

async function obtenerVentas(turno, { desde, hasta }) {
  const { data, error } = await supabase
    .from("ventas")
    .select(COLUMNAS_VENTA)
    .eq("turno", turno)
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString())
    .order("created_at", { ascending: false })
    .limit(LIMITE_VENTAS);
  if (error) throw error;
  return data;
}

// Pedidos sin cobrar de cualquier fecha (así no se pierde ninguno de días anteriores)
async function obtenerAbiertos(turno) {
  const { data, error } = await supabase
    .from("ventas")
    .select(COLUMNAS_VENTA)
    .eq("turno", turno)
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
      <p className={`cifras mt-1 text-xl font-bold sm:text-2xl ${destacado ? "text-palmera" : ""}`}>{valor}</p>
      {detalle && <p className="text-xs text-tinta-suave">{detalle}</p>}
    </div>
  );
}

const FILTROS_ESTADO = [
  { id: "todos", nombre: "Todas" },
  { id: "cerrado", nombre: "Cobradas" },
  { id: "abiertas", nombre: "Sin cobrar" },
];

// actualizacion: cambia cuando el panel se entera de pedidos nuevos o modificados (tiempo real)
// onCambio: avisa al panel que hubo un cambio acá (para los contadores)
export default function VentasTurno({ turno, comidas, categorias = [], menuHoy, actualizacion = 0, onCambio }) {
  const [rango, setRango] = useState("hoy");
  const [desdeTexto, setDesdeTexto] = useState(() => fechaInput(Date.now() - 6 * 864e5));
  const [hastaTexto, setHastaTexto] = useState(hoyInput);
  const [estadoFiltro, setEstadoFiltro] = useState("todos");
  const [resultado, setResultado] = useState({ clave: null, ventas: [], error: null });
  const [abiertos, setAbiertos] = useState({ vuelta: null, ventas: [], error: null });
  const [recarga, setRecarga] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  const [detalleId, setDetalleId] = useState(null);
  const [editando, setEditando] = useState(null);
  const [aCobrar, setACobrar] = useState(null);
  const [aCancelar, setACancelar] = useState(null);
  const [aAnular, setAAnular] = useState(null);
  const [aviso, setAviso] = useState(null); // { venta, plantilla }
  const [procesando, setProcesando] = useState(false);
  const [ventaAbierta, setVentaAbierta] = useState(false);
  const [exportando, setExportando] = useState(false);

  const periodo = useMemo(() => calcularRango(rango, desdeTexto, hastaTexto), [rango, desdeTexto, hastaTexto]);
  const kiosco = useMemo(() => idsDeKiosco(categorias, comidas), [categorias, comidas]);
  const vuelta = `${turno}-${recarga}-${actualizacion}`;
  const clave = periodo ? `${periodo.desde.getTime()}-${periodo.hasta.getTime()}-${vuelta}` : null;

  useEffect(() => {
    if (!periodo) return;
    let activo = true;
    obtenerVentas(turno, periodo)
      .then((ventas) => activo && setResultado({ clave, ventas, error: null }))
      .catch((error) => activo && setResultado({ clave, ventas: [], error }));
    return () => {
      activo = false;
    };
  }, [turno, periodo, clave]);

  useEffect(() => {
    let activo = true;
    obtenerAbiertos(turno)
      .then((ventas) => activo && setAbiertos({ vuelta, ventas, error: null }))
      .catch((error) => activo && setAbiertos({ vuelta, ventas: [], error }));
    return () => {
      activo = false;
    };
  }, [turno, vuelta]);

  // Reloj para el "hace X min" y las alertas de demora
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const cargando = periodo && resultado.clave !== clave;
  const cargandoAbiertos = abiertos.vuelta !== vuelta && abiertos.ventas.length === 0;
  const ventas = resultado.ventas;

  const filtradas = useMemo(() => {
    if (estadoFiltro === "cerrado") return ventas.filter((v) => v.estado === "cerrado");
    if (estadoFiltro === "abiertas") return ventas.filter((v) => v.estado !== "cerrado");
    return ventas;
  }, [ventas, estadoFiltro]);

  const resumen = useMemo(() => {
    const cobradas = ventas.filter((v) => v.estado === "cerrado");
    const facturado = cobradas.reduce((acc, v) => acc + Number(v.total), 0);
    const porMetodo = { efectivo: 0, transferencia: 0, cuenta_corriente: 0 };
    for (const v of cobradas) for (const p of v.pagos ?? []) porMetodo[p.metodo] += Number(p.monto);
    return { cobradas: cobradas.length, facturado, ticket: cobradas.length ? facturado / cobradas.length : 0, porMetodo };
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

  async function guardarEstado(venta, estado) {
    setProcesando(true);
    const { error } = await supabase.from("ventas").update({ estado }).eq("id", venta.id);
    setProcesando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo cambiar el estado del pedido."));
      return false;
    }
    recargar();
    return true;
  }

  // Botón principal de cada tarjeta: avanza al siguiente estado
  async function avanzar(venta, estado) {
    if (estado === "cerrado") return setACobrar(venta);
    if (!(await guardarEstado(venta, estado))) return;
    const actualizada = { ...venta, estado };
    toast.success(`Pedido #${venta.numero}: ${nombreEstado(actualizada)}`);
    const config = leerConfigImpresora();
    // Un pedido solo de bebidas o golosinas no va a la cocina (salvo que se pida en Ticketera)
    const paraCocina = config.comandaKiosco || necesitaCocina(venta.venta_items ?? [], kiosco);
    if (estado === "en_preparacion" && config.comandaAlConfirmar && paraCocina) imprimirComanda(venta);
    // Al confirmar un pedido web se abre el mensaje para avisarle al cliente
    if (venta.origen === "web" && estado === "en_preparacion") setAviso({ venta: actualizada, plantilla: "confirmado" });
    if (venta.origen === "web" && estado === "enviado") {
      toast(
        (t) => (
          <span className="flex items-center gap-3">
            <span className="text-sm">¿Le avisás al cliente que el pedido #{venta.numero} {nombreEstado(actualizada).toLowerCase()}?</span>
            <button
              type="button"
              className="boton-whatsapp px-3 py-1.5 text-xs"
              onClick={() => {
                setAviso({ venta: actualizada, plantilla: "en_camino" });
                toast.dismiss(t.id);
              }}
            >
              <IconoWhatsApp className="size-4" /> Avisar
            </button>
          </span>
        ),
        { duration: 10_000 }
      );
    }
  }

  // Corrección desde el detalle (menú de estados)
  function cambiarEstado(venta, estado) {
    if (estado !== venta.estado) guardarEstado(venta, estado).then((ok) => ok && toast.success(`Pedido #${venta.numero} actualizado`));
  }

  // Cancelar = eliminar: los pedidos cancelados no quedan guardados
  async function cancelar() {
    const venta = aCancelar;
    setProcesando(true);
    const { error } = await supabase.from("ventas").delete().eq("id", venta.id);
    setProcesando(false);
    setACancelar(null);
    if (error) return toast.error(mensajeDeError(error, "No se pudo eliminar el pedido."));
    toast.success(venta.estado === "cerrado" ? `Borraste la venta #${venta.numero}` : `Pedido #${venta.numero} cancelado y eliminado`);
    setDetalleId(null);
    recargar();
  }

  async function anularCobro() {
    const venta = aAnular;
    setProcesando(true);
    const { error } = await supabase.rpc("anular_cobro", { venta_id: venta.id });
    setProcesando(false);
    setAAnular(null);
    if (error) return toast.error(mensajeDeError(error, "No se pudo anular el cobro."));
    toast.success(`Anulaste el cobro de la venta #${venta.numero}. Volvió al tablero como entregada.`);
    recargar();
  }

  function imprimir(venta, tipo) {
    if (tipo === "comanda") imprimirComanda(venta);
    else imprimirTicket(venta, venta.pagos ?? []);
  }

  function editar(venta) {
    setDetalleId(null);
    setEditando(venta);
  }

  async function exportar() {
    if (filtradas.length === 0) return toast.error("No hay ventas para exportar con estos filtros.");
    setExportando(true);
    try {
      const subtitulo = `${TURNOS[turno].nombre} · ${textoPeriodo(periodo)}`;
      await descargarExcel(`ventas-${turno}_${sufijoArchivo(periodo)}`, [hojaVentas(filtradas, subtitulo), hojaProductos(filtradas, subtitulo)]);
      toast.success(`Exportaste ${filtradas.length} ventas a Excel`);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const accionesTablero = {
    procesando,
    onAvanzar: avanzar,
    onCobrar: (v) => setACobrar(v),
    onVer: (v) => setDetalleId(v.id),
    onEditar: editar,
    onCancelar: (v) => setACancelar(v),
    onAvisar: (v, plantilla) => setAviso({ venta: v, plantilla }),
    onImprimir: imprimir,
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{turno === "noche" ? "Pedidos y ventas de la noche" : "Ventas del mediodía"}</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario px-3" onClick={recargar} aria-label="Actualizar pedidos">
            <IconoActualizar className="size-4" /> <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button type="button" className="boton-primario" onClick={() => setVentaAbierta(true)}>
            <IconoMas className="size-4" /> Nueva venta en caja
          </button>
        </div>
      </div>

      <TableroPedidos pedidos={abiertos.ventas} cargando={cargandoAbiertos} error={abiertos.error} ahora={ahora} {...accionesTablero} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h2 className="text-lg font-semibold">Historial de ventas</h2>
        <button type="button" className="boton-secundario" onClick={exportar} disabled={cargando || exportando}>
          <IconoExcel className="size-4" /> {exportando ? "Generando…" : "Descargar Excel"}
        </button>
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
                rango === r.id ? "bg-tinta text-fondo" : "bg-fondo text-tinta-suave hover:text-tinta"
              }`}
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
        <div className="ml-auto flex gap-1" role="group" aria-label="Estado">
          {FILTROS_ESTADO.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={estadoFiltro === f.id}
              onClick={() => setEstadoFiltro(f.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                estadoFiltro === f.id ? "bg-tinta text-fondo" : "bg-fondo text-tinta-suave hover:text-tinta"
              }`}
            >
              {f.nombre}
            </button>
          ))}
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
            <Resumen titulo="Ventas cobradas" valor={resumen.cobradas} detalle={textoPeriodo(periodo)} />
            <Resumen titulo="Total facturado" valor={formatearPrecio(resumen.facturado)} detalle="Solo ventas cobradas" destacado />
            <Resumen titulo="Ticket promedio" valor={formatearPrecio(resumen.ticket)} />
            <div className="tarjeta p-4">
              <p className="text-xs text-tinta-suave">Por forma de pago</p>
              <ul className="cifras mt-1 space-y-0.5 text-sm">
                {Object.entries(resumen.porMetodo).map(([m, monto]) => (
                  <li key={m} className="flex justify-between gap-2">
                    <span className="text-tinta-suave">{METODOS_PAGO[m].nombre}</span>
                    <strong>{formatearPrecio(monto)}</strong>
                  </li>
                ))}
              </ul>
            </div>
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
            <div className="tarjeta p-8 text-center text-tinta-suave">No hay ventas en este período con ese filtro.</div>
          ) : (
            <div className="tarjeta overflow-x-auto">
              <table className="cifras w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs text-tinta-suave">
                  <tr className="border-b border-borde">
                    <th className="px-3 py-2.5 font-medium">N°</th>
                    <th className="px-3 py-2.5 font-medium">Fecha y hora</th>
                    <th className="px-3 py-2.5 font-medium">Cliente</th>
                    <th className="px-3 py-2.5 text-right font-medium">Unid.</th>
                    <th className="px-3 py-2.5 font-medium">Forma de pago</th>
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
                      <td className="max-w-52 truncate px-3 py-2.5 text-xs text-tinta-suave">
                        {v.pagos?.length ? textoPagos(v.pagos, formatearPesos) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{formatearPrecio(v.total)}</td>
                      <td className="px-3 py-2.5">
                        <InsigniaEstado venta={v} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-tinta-suave">{v.origen === "manual" ? "Caja" : "Web"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="boton-secundario px-2.5 py-1.5 text-xs"
                            onClick={() => setDetalleId(v.id)}
                            aria-label={`Ver la cuenta #${v.numero}`}
                            title="Ver la cuenta"
                          >
                            <IconoOjo className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="boton-secundario px-2.5 py-1.5 text-xs hover:text-rojo"
                            onClick={() => setACancelar(v)}
                            aria-label={`Borrar la venta #${v.numero}`}
                            title="Borrar"
                            disabled={procesando}
                          >
                            <IconoBasura className="size-4" />
                          </button>
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
        onCobrar={(v) => setACobrar(v)}
        onAnularCobro={(v) => setAAnular(v)}
        onEditar={editar}
        onBorrar={(v) => setACancelar(v)}
        onImprimir={imprimir}
        onAvisar={(v, plantilla) => setAviso({ venta: v, plantilla })}
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

      <CobrarVenta
        venta={aCobrar}
        onCerrar={() => setACobrar(null)}
        onCobrada={() => {
          setACobrar(null);
          setDetalleId(null);
          recargar();
        }}
      />

      <AvisoCliente aviso={aviso} onCerrar={() => setAviso(null)} />

      <Confirmar
        abierto={Boolean(aCancelar)}
        titulo={aCancelar?.estado === "cerrado" ? `Borrar la venta #${aCancelar?.numero}` : `Cancelar el pedido #${aCancelar?.numero ?? ""}`}
        mensaje={
          aCancelar?.estado === "cerrado"
            ? "Se borra para siempre junto con su cobro, y deja de contar en la facturación y en la caja. Si el cobro ya está en un arqueo cerrado, no se puede borrar."
            : "El pedido cancelado se elimina automáticamente: no queda en el historial ni cuenta en la facturación."
        }
        textoConfirmar={aCancelar?.estado === "cerrado" ? "Borrar venta" : "Cancelar y eliminar"}
        procesando={procesando}
        onConfirmar={cancelar}
        onCancelar={() => setACancelar(null)}
      />

      <Confirmar
        abierto={Boolean(aAnular)}
        titulo={`Anular el cobro de la venta #${aAnular?.numero ?? ""}`}
        mensaje="Se borra el cobro registrado (sale de la caja y de la cuenta corriente, si se había fiado) y la venta vuelve al tablero como entregada para corregirla y cobrarla de nuevo."
        textoConfirmar="Anular cobro"
        procesando={procesando}
        onConfirmar={anularCobro}
        onCancelar={() => setAAnular(null)}
      />

      <VentaLocal
        abierto={ventaAbierta}
        turno={turno}
        comidas={comidas}
        kiosco={kiosco}
        menuHoy={menuHoy}
        onCerrar={() => setVentaAbierta(false)}
        onRegistrada={() => {
          setVentaAbierta(false);
          recargar();
        }}
      />
    </section>
  );
}
