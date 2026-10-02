import { STOCK_BAJO } from "../../config";
import { tienePromo } from "../../lib/formato";
import { IconoEstrella, IconoWhatsApp } from "../ui/Iconos";
import ControlCantidad from "./ControlCantidad";
import Precio from "./Precio";

export function ImagenComida({ comida, className = "" }) {
  if (!comida.imagen_url) {
    return (
      <div className={`grid place-items-center bg-noche-3 text-xs text-crema-suave ${className}`}>Sin imagen</div>
    );
  }
  return (
    <img
      src={comida.imagen_url}
      alt={comida.nombre}
      loading="lazy"
      decoding="async"
      className={`object-cover ${className}`}
    />
  );
}

export default function TarjetaProducto({ comida, cantidad, onAgregar, onSumar, onRestar, onVerDetalle, onConsultar }) {
  const agotado = comida.stock <= 0;
  const pocas = !agotado && comida.stock <= STOCK_BAJO;

  return (
    <article className={`tarjeta flex flex-col overflow-hidden ${agotado ? "opacity-55" : ""}`}>
      <button
        type="button"
        onClick={onVerDetalle}
        className="relative block text-left"
        aria-label={`Ver detalle de ${comida.nombre}`}
      >
        <ImagenComida comida={comida} className="aspect-square w-full" />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {tienePromo(comida) && (
            <span className="rounded-full bg-naranja px-2 py-0.5 text-[11px] font-bold text-noche">¡Promo!</span>
          )}
          {comida.destacado && (
            <span className="inline-flex items-center gap-1 rounded-full bg-noche/85 px-2 py-0.5 text-[11px] font-semibold text-queso">
              <IconoEstrella className="size-3" /> Destacado
            </span>
          )}
        </div>
        {agotado && (
          <span className="absolute inset-x-0 bottom-0 bg-noche/85 py-1 text-center text-xs font-bold uppercase tracking-wider">
            Agotado
          </span>
        )}
        {pocas && (
          <span className="absolute bottom-2 right-2 rounded-full bg-noche/85 px-2 py-0.5 text-[11px] font-semibold text-naranja">
            Quedan {comida.stock}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{comida.nombre}</h3>
        <div className="mt-auto">
          <Precio comida={comida} />
        </div>
        {agotado ? (
          <button type="button" onClick={onConsultar} className="boton-secundario w-full px-2 text-xs">
            <IconoWhatsApp className="size-4 text-whatsapp" /> Consultar
          </button>
        ) : cantidad > 0 ? (
          <ControlCantidad cantidad={cantidad} onSumar={onSumar} onRestar={onRestar} nombre={comida.nombre} chico />
        ) : (
          <button type="button" onClick={onAgregar} className="boton-primario w-full px-2">
            Agregar
          </button>
        )}
      </div>
    </article>
  );
}

export function TarjetaEsqueleto() {
  return (
    <div className="tarjeta animate-pulse overflow-hidden" aria-hidden="true">
      <div className="aspect-square bg-noche-3" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-3/4 rounded bg-noche-3" />
        <div className="h-3 w-1/3 rounded bg-noche-3" />
        <div className="h-9 rounded-xl bg-noche-3" />
      </div>
    </div>
  );
}
