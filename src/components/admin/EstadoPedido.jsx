import { ESTADOS, ESTADOS_ABIERTOS, nombreEstado } from "./ventasUtils";

export function InsigniaEstado({ venta }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${ESTADOS[venta.estado]?.clase}`}>
      {nombreEstado(venta)}
    </span>
  );
}

// Menú para corregir el estado de un pedido sin cobrar (por ejemplo, si se avanzó
// por error). Cobrar se hace con el botón de cobro; cancelar, con el de eliminar.
export function SelectorEstado({ venta, onCambiar, disabled = false }) {
  if (!ESTADOS_ABIERTOS.includes(venta.estado)) return <InsigniaEstado venta={venta} />;
  return (
    <select
      value={venta.estado}
      onChange={(e) => onCambiar(venta, e.target.value)}
      disabled={disabled}
      aria-label={`Estado del pedido #${venta.numero}`}
      className={`rounded-xl border px-2 py-1.5 text-xs font-semibold focus:border-palmera focus:outline-none disabled:opacity-60 ${ESTADOS[venta.estado]?.clase}`}
    >
      {ESTADOS_ABIERTOS.map((id) => (
        <option key={id} value={id} className="bg-papel text-tinta">
          {nombreEstado(venta, id)}
        </option>
      ))}
    </select>
  );
}
