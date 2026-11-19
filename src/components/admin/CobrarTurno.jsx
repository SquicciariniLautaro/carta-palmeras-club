import { useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearFecha, formatearPesos } from "../../lib/formato";
import { leerConfigImpresora } from "../../lib/impresion";
import { useCaja, useClientes } from "../../hooks/useCaja";
import { IconoCheck } from "../ui/Iconos";
import FormPagos from "./FormPagos";
import { PAGO_INICIAL, pagoUsaCaja, pagosConMontos, validarPago } from "./pagosUtils";
import { textoPagos } from "./ventasUtils";
import { consumosDe, horario, imprimirTicketDeVenta, pagadoDe, restaDe, textoDuracion } from "./canchaUtils";

// Cobra lo que falta del turno: el alquiler más lo que consumieron (si dejó seña, solo el resto)
export default function CobrarTurno({ turno, onCerrar, onCobrado }) {
  const { caja } = useCaja();
  const { clientes, recargar: recargarClientes } = useClientes();
  const [pago, setPago] = useState(PAGO_INICIAL);
  const [conTicket, setConTicket] = useState(() => leerConfigImpresora().ticketAlCobrar);
  const [guardando, setGuardando] = useState(false);
  const total = restaDe(turno);
  const sena = pagadoDe(turno);
  const consumos = consumosDe(turno);
  const totalConsumos = consumos.reduce((acc, i) => acc + Number(i.subtotal), 0);

  async function cobrar() {
    const { error: invalido, pagos } = validarPago(pago, total);
    if (invalido) return toast.error(invalido);
    if (pagoUsaCaja(pago) && !caja) return toast.error("Abrí la caja para cobrar en efectivo o por transferencia.");
    setGuardando(true);
    const { data, error } = await supabase.rpc("cobrar_turno_cancha", { turno_id: turno.id, pagos });
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo registrar el cobro."));
    if (conTicket) await imprimirTicketDeVenta(data.id);
    toast.success(`Turno de ${turno.cliente_nombre} cobrado: ${formatearPesos(total)} (${textoPagos(pagosConMontos(pagos, total), formatearPesos)})`);
    onCobrado();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">{sena > 0 ? "Falta cobrar" : "Total a cobrar"}</p>
        <p className="cifras mt-1 text-4xl font-bold text-emerald-900">{formatearPesos(total)}</p>
        <p className="mt-1 text-sm text-emerald-900">
          {turno.cliente_nombre} · {formatearFecha(turno.fecha)} · {horario(turno)} ({textoDuracion(turno.minutos)})
        </p>
        <p className="cifras mt-1 text-xs text-emerald-800">
          Alquiler {formatearPesos(turno.precio)}
          {consumos.length > 0 && ` + consumos ${formatearPesos(totalConsumos)}`}
          {sena > 0 && ` − seña ${formatearPesos(sena)}`}
        </p>
      </div>

      {consumos.length > 0 && (
        <details className="rounded-xl bg-fondo p-3 text-sm" open>
          <summary className="cursor-pointer font-medium">Lo que consumieron</summary>
          <ul className="mt-2 space-y-1">
            {consumos.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span>
                  <strong>{i.cantidad}x</strong> {i.nombre}
                  {i.detalle && <span className="text-tinta-suave"> · {i.detalle}</span>}
                </span>
                <span className="cifras shrink-0">{i.regalo ? "Regalo" : formatearPesos(i.subtotal)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

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
          <IconoCheck className="size-5" /> {guardando ? "Registrando cobro…" : "Cobrar todo"}
        </button>
      </div>
      <p className="text-xs text-tinta-suave">El cobro queda en la caja abierta y en Finanzas como venta de la cancha (alquiler y consumos).</p>
    </div>
  );
}
