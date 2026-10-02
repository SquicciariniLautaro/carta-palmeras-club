import { formatearFechaHora, formatearPrecio } from "../../lib/formato";
import Modal from "../ui/Modal";
import { ESTADOS } from "./ventasUtils";

export default function DetalleVenta({ venta, onCerrar, onConfirmar, onCancelar, procesando }) {
  return (
    <Modal abierto={Boolean(venta)} onCerrar={onCerrar} titulo={venta ? `Pedido #${venta.numero}` : ""}>
      {venta && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-tinta-suave">Fecha</dt>
            <dd>{formatearFechaHora(venta.created_at)}</dd>
            <dt className="text-tinta-suave">Cliente</dt>
            <dd>{venta.cliente_nombre || "—"}</dd>
            <dt className="text-tinta-suave">Estado</dt>
            <dd>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADOS[venta.estado]?.clase}`}>
                {ESTADOS[venta.estado]?.nombre}
              </span>
            </dd>
            <dt className="text-tinta-suave">Origen</dt>
            <dd>{venta.origen === "manual" ? "Manual (en el local)" : "Web (WhatsApp)"}</dd>
          </dl>

          <table className="w-full text-left">
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
                    {!i.comida_id && <span className="ml-1 text-xs text-tinta-suave">(borrada)</span>}
                  </td>
                  <td className="py-2 text-right">{i.cantidad}</td>
                  <td className="py-2 text-right">{formatearPrecio(i.precio_unitario)}</td>
                  <td className="py-2 text-right">{formatearPrecio(i.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-3 text-right font-semibold">
                  Total
                </td>
                <td className="pt-3 text-right text-base font-bold">{formatearPrecio(venta.total)}</td>
              </tr>
            </tfoot>
          </table>

          {venta.nota && (
            <div className="rounded-xl bg-fondo p-3">
              <p className="text-xs text-tinta-suave">Nota</p>
              <p className="whitespace-pre-line">{venta.nota}</p>
            </div>
          )}

          {venta.estado !== "cancelada" && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4">
              <button type="button" className="boton-peligro" onClick={() => onCancelar(venta)} disabled={procesando}>
                {venta.estado === "confirmada" ? "Cancelar y devolver stock" : "Cancelar pedido"}
              </button>
              {venta.estado === "pendiente" && (
                <button type="button" className="boton-primario" onClick={() => onConfirmar(venta)} disabled={procesando}>
                  Confirmar y descontar stock
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
