import { formatearPrecio, tienePromo } from "../../lib/formato";
import { precioDesde } from "../../lib/opciones";

export default function Precio({ comida, grande = false }) {
  const desde = precioDesde(comida);
  if (desde !== null) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-xs text-tinta-suave">Desde</span>
        <span className={`font-bold ${grande ? "text-2xl" : "text-base"}`}>{formatearPrecio(desde)}</span>
      </div>
    );
  }
  if (tienePromo(comida)) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-bold text-brasa ${grande ? "text-2xl" : "text-base"}`}>
          {formatearPrecio(comida.precio_promo)}
        </span>
        <span className="text-xs text-tinta-suave line-through">
          <span className="sr-only">Antes </span>
          {formatearPrecio(comida.precio)}
        </span>
      </div>
    );
  }
  return (
    <span className={`font-bold ${grande ? "text-2xl" : "text-base"}`}>{formatearPrecio(comida.precio)}</span>
  );
}
