import { useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearFechaHora, formatearPesos } from "../../lib/formato";
import { imprimirTicket, leerConfigImpresora } from "../../lib/impresion";
import { useCaja, useClientes } from "../../hooks/useCaja";
import { IconoCheck } from "../ui/Iconos";
import Modal from "../ui/Modal";
import FormPagos from "./FormPagos";
import { PAGO_INICIAL, pagoUsaCaja, pagosConMontos, validarPago } from "./pagosUtils";
import { unidadesDeVenta } from "./ventasUtils";

function Contenido({ venta, onCerrar, onCobrada }) {
  const { caja } = useCaja();
  const { clientes, recargar: recargarClientes } = useClientes();
  const [pago, setPago] = useState(PAGO_INICIAL);
  const [conTicket, setConTicket] = useState(() => leerConfigImpresora().ticketAlCobrar);
  const [guardando, setGuardando] = useState(false);
  const total = Number(venta.total);
  const unidades = unidadesDeVenta(venta);

  async function cobrar() {
    const { error: invalido, pagos } = validarPago(pago, total);
    if (invalido) return toast.error(invalido);
    if (pagoUsaCaja(pago) && !caja) return toast.error("Abrí la caja para cobrar en efectivo o por transferencia.");
    setGuardando(true);
    const { error } = await supabase.rpc("cobrar_venta", { venta_id: venta.id, pagos });
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo registrar el cobro."));
    const finales = pagosConMontos(pagos, total);
    if (conTicket) imprimirTicket(venta, finales);
    toast.success(`Cuenta #${venta.numero} cobrada: ${formatearPesos(total)}`);
    onCobrada(venta, finales);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Total a cobrar</p>
        <p className="cifras mt-1 text-4xl font-bold text-emerald-900">{formatearPesos(total)}</p>
        <p className="mt-1 text-sm text-emerald-900">
          {venta.cliente_nombre || "Sin nombre"} · {unidades} producto{unidades === 1 ? "" : "s"} · {formatearFechaHora(venta.created_at)}
        </p>
      </div>

      <details className="rounded-xl bg-fondo p-3 text-sm">
        <summary className="cursor-pointer font-medium">Ver la cuenta completa</summary>
        <ul className="mt-2 space-y-1">
          {venta.venta_items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span>
                <strong>{i.cantidad}x</strong> {i.nombre}
                {i.detalle && <span className="text-tinta-suave"> · {i.detalle}</span>}
              </span>
              <span className="cifras shrink-0">{formatearPesos(i.subtotal)}</span>
            </li>
          ))}
        </ul>
      </details>

      <FormPagos total={total} valor={pago} onCambio={setPago} clientes={clientes} onClienteCreado={recargarClientes} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-palmera" checked={conTicket} onChange={(e) => setConTicket(e.target.checked)} />
        Imprimir el ticket para el cliente
      </label>

      <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Volver
        </button>
        <button type="button" className="boton bg-emerald-600 py-3 text-base text-white hover:bg-emerald-700" onClick={cobrar} disabled={guardando}>
          <IconoCheck className="size-5" /> {guardando ? "Registrando cobro…" : "Cobrar y cerrar cuenta"}
        </button>
      </div>
      <p className="text-xs text-tinta-suave">
        Al cerrar la cuenta la venta pasa a facturación y el cobro queda en el arqueo de la caja abierta.
      </p>
    </div>
  );
}

export default function CobrarVenta({ venta, onCerrar, onCobrada }) {
  return (
    <Modal abierto={Boolean(venta)} onCerrar={onCerrar} titulo={venta ? `Cerrar cuenta #${venta.numero}` : ""} ancho="max-w-lg">
      {venta && <Contenido key={venta.id} venta={venta} onCerrar={onCerrar} onCobrada={onCobrada} />}
    </Modal>
  );
}
