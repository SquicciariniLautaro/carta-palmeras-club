import { formatearFechaHora, formatearPesos } from "../../lib/formato";
import { mostrarTelefono } from "../../lib/mensajesCliente";
import { IconoAnular, IconoBasura, IconoCheck, IconoEditar, IconoImpresora, IconoRecibo, IconoWhatsApp } from "../ui/Iconos";
import Modal from "../ui/Modal";
import { SelectorEstado } from "./EstadoPedido";
import { METODOS_PAGO, TURNOS, estaAbierto } from "./ventasUtils";

// La cuenta completa: productos, totales, cobros, comanda y cierre
export default function DetalleVenta({ venta, onCerrarModal, onEstado, onCobrar, onAnularCobro, onEditar, onBorrar, onImprimir, onAvisar, procesando }) {
  const pagos = venta?.pagos ?? [];
  const cobrada = venta?.estado === "cerrado";
  return (
    <Modal abierto={Boolean(venta)} onCerrar={onCerrarModal} titulo={venta ? `Cuenta #${venta.numero}` : ""} ancho="max-w-2xl">
      {venta && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr_auto_1fr]">
            <dt className="text-tinta-suave">Fecha</dt>
            <dd>{formatearFechaHora(venta.created_at)}</dd>
            <dt className="text-tinta-suave">Turno</dt>
            <dd>{TURNOS[venta.turno]?.corto ?? "—"}</dd>
            <dt className="text-tinta-suave">Cliente</dt>
            <dd>{venta.cliente_nombre || "—"}</dd>
            <dt className="text-tinta-suave">WhatsApp</dt>
            <dd>{venta.cliente_telefono ? mostrarTelefono(venta.cliente_telefono) : "—"}</dd>
            <dt className="text-tinta-suave">Origen</dt>
            <dd>{venta.origen === "manual" ? "Caja (en el local)" : "Web (WhatsApp)"}</dd>
            <dt className="self-center text-tinta-suave">Estado</dt>
            <dd>
              <SelectorEstado venta={venta} onCambiar={onEstado} disabled={procesando} />
            </dd>
            {cobrada && venta.cerrada_at && (
              <>
                <dt className="text-tinta-suave">Cobrada</dt>
                <dd>{formatearFechaHora(venta.cerrada_at)}</dd>
              </>
            )}
          </dl>

          <div className="overflow-x-auto">
            <table className="cifras w-full min-w-[420px] text-left">
              <thead className="text-xs text-tinta-suave">
                <tr className="border-b border-borde">
                  <th className="py-2 font-medium">Producto</th>
                  <th className="py-2 text-right font-medium">Cant.</th>
                  <th className="py-2 text-right font-medium">Precio</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.venta_items.map((i) => (
                  <tr key={i.id} className="border-b border-borde/60">
                    <td className="py-2">
                      {i.nombre}
                      {i.detalle && <span className="block text-xs text-tinta-suave">{i.detalle}</span>}
                      {!i.comida_id && <span className="ml-1 text-xs text-tinta-suave">(borrada)</span>}
                    </td>
                    <td className="py-2 text-right">{i.cantidad}</td>
                    <td className="py-2 text-right">{formatearPesos(i.precio_unitario)}</td>
                    <td className="py-2 text-right">{formatearPesos(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-3 text-right font-semibold">
                    Total
                  </td>
                  <td className="pt-3 text-right text-base font-bold">{formatearPesos(venta.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {venta.nota && (
            <div className="rounded-xl bg-fondo p-3">
              <p className="text-xs text-tinta-suave">Nota / entrega</p>
              <p className="whitespace-pre-line">{venta.nota}</p>
            </div>
          )}

          {cobrada && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">Cobro</p>
              {pagos.length === 0 ? (
                <p className="text-emerald-900">Cobrada antes de registrar formas de pago.</p>
              ) : (
                <ul className="cifras space-y-0.5 text-emerald-950">
                  {pagos.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span>
                        {METODOS_PAGO[p.metodo]?.nombre}
                        {p.clientes?.nombre && ` · ${p.clientes.nombre}`}
                      </span>
                      <strong>{formatearPesos(p.monto)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-borde pt-4">
            {estaAbierto(venta) && (
              <button
                type="button"
                className="boton w-full bg-emerald-600 py-3 text-base text-white hover:bg-emerald-700"
                onClick={() => onCobrar(venta)}
                disabled={procesando}
              >
                <IconoCheck className="size-5" /> Cobrar y cerrar cuenta
              </button>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="boton-secundario" onClick={() => onImprimir(venta, "comanda")}>
                <IconoImpresora className="size-4" /> Comanda
              </button>
              <button type="button" className="boton-secundario" onClick={() => onImprimir(venta, "ticket")}>
                <IconoRecibo className="size-4" /> Ticket
              </button>
              {venta.origen === "web" && estaAbierto(venta) && (
                <button type="button" className="boton-secundario" onClick={() => onAvisar(venta, "confirmado")}>
                  <IconoWhatsApp className="size-4" /> Avisar
                </button>
              )}
              {cobrada && pagos.length > 0 && (
                <button type="button" className="boton-secundario" onClick={() => onAnularCobro(venta)} disabled={procesando}>
                  <IconoAnular className="size-4" /> Anular cobro
                </button>
              )}
              {!cobrada && (
                <button type="button" className="boton-secundario" onClick={() => onEditar(venta)} disabled={procesando}>
                  <IconoEditar className="size-4" /> Editar
                </button>
              )}
              <button type="button" className="boton-secundario hover:text-rojo" onClick={() => onBorrar(venta)} disabled={procesando}>
                <IconoBasura className="size-4" /> {cobrada ? "Borrar" : "Cancelar pedido"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
