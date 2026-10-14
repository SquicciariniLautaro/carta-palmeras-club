import { formatearPrecio, formatearFechaHora } from "../../lib/formato";
import { IconoCheck } from "../ui/Iconos";
import Modal from "../ui/Modal";
import { ESTADOS, unidadesDeVenta } from "./ventasUtils";

export function InsigniaEstado({ estado }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTADOS[estado]?.clase}`}>
      {ESTADOS[estado]?.nombre ?? estado}
    </span>
  );
}

// Menú desplegable con los estados del pedido, pintado con el color del estado actual.
// Elegir "Cerrado" o "Cancelado" no guarda directo: abre la confirmación.
export function SelectorEstado({ venta, onCambiar, disabled = false, grande = false }) {
  return (
    <select
      value={venta.estado}
      onChange={(e) => onCambiar(venta, e.target.value)}
      disabled={disabled}
      aria-label={`Estado del pedido #${venta.numero}`}
      className={`rounded-xl border font-semibold focus:border-palmera focus:outline-none disabled:opacity-60 ${
        grande ? "w-full px-3 py-2.5 text-sm" : "px-2 py-1.5 text-xs"
      } ${ESTADOS[venta.estado]?.clase}`}
    >
      {Object.entries(ESTADOS).map(([id, e]) => (
        <option key={id} value={id} className="bg-papel text-tinta">
          {e.nombre}
        </option>
      ))}
    </select>
  );
}

// Botón grande para cerrar el pedido. Si ya se entregó, late para que nadie se olvide.
export function BotonCerrar({ venta, onCerrar, disabled = false, className = "" }) {
  const urgente = venta.estado === "entregado";
  return (
    <button
      type="button"
      onClick={() => onCerrar(venta)}
      disabled={disabled}
      className={`boton w-full bg-emerald-600 py-3 text-base text-white shadow-md hover:bg-emerald-700 ${
        urgente ? "animate-pulse ring-4 ring-emerald-300" : ""
      } ${className}`}
    >
      <IconoCheck className="size-5" /> {urgente ? "¡Ya se entregó! Cerrar pedido" : "Cerrar pedido"}
    </button>
  );
}

// Confirmación al cerrar: muestra el total bien grande para cobrar sin errores
export function ConfirmarCierre({ venta, procesando, onConfirmar, onVolver }) {
  return (
    <Modal abierto={Boolean(venta)} onCerrar={onVolver} titulo={venta ? `Cerrar pedido #${venta.numero}` : ""} ancho="max-w-md">
      {venta && (
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Total a cobrar</p>
            <p className="mt-1 text-4xl font-bold text-emerald-900">{formatearPrecio(venta.total)}</p>
            <p className="mt-1 text-sm text-emerald-900">
              {venta.cliente_nombre || "Sin nombre"} · {unidadesDeVenta(venta)} producto
              {unidadesDeVenta(venta) === 1 ? "" : "s"} · {formatearFechaHora(venta.created_at)}
            </p>
          </div>
          <ul className="space-y-1 rounded-xl bg-fondo p-3 text-sm">
            {venta.venta_items.map((i) => (
              <li key={i.id}>
                <strong>{i.cantidad}x</strong> {i.nombre}
                {i.detalle && <span className="text-tinta-suave"> · {i.detalle}</span>}
              </li>
            ))}
          </ul>
          <p className="text-sm text-tinta-suave">
            Cerralo cuando el pedido ya está <strong>entregado y cobrado</strong>. Desde ese momento cuenta en la
            facturación y sale de la lista de pedidos sin cerrar.
          </p>
          <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
            <button type="button" className="boton-secundario" onClick={onVolver} disabled={procesando}>
              Volver
            </button>
            <button
              type="button"
              className="boton bg-emerald-600 py-3 text-base text-white hover:bg-emerald-700"
              onClick={onConfirmar}
              disabled={procesando}
            >
              <IconoCheck className="size-5" /> {procesando ? "Cerrando…" : "Sí, cobrado: cerrar pedido"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
