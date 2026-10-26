import { formatearPrecio, tienePromo } from "../../lib/formato";
import { precioDesde, tieneOpciones } from "../../lib/opciones";
import { IconoEstrella, IconoMas } from "../ui/Iconos";
import ControlCantidad from "./ControlCantidad";

// Precio del renglón: el "desde" o el precio anterior van chiquitos arriba
// para que el nombre tenga lugar en el celular.
function PrecioFila({ comida }) {
  const desde = precioDesde(comida);
  const promo = desde === null && tienePromo(comida);
  return (
    <span className="shrink-0 text-right leading-tight">
      {desde !== null && (
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-tinta-suave">Desde</span>
      )}
      {promo && (
        <s className="block text-[11px] text-tinta-suave">
          <span className="sr-only">Antes </span>
          {formatearPrecio(comida.precio)}
        </s>
      )}
      <span className={`text-[15px] font-bold ${promo ? "text-brasa" : ""}`}>
        {formatearPrecio(desde ?? (promo ? comida.precio_promo : comida.precio))}
      </span>
    </span>
  );
}

// Un renglón de la carta, sin foto: "NOMBRE ······ $precio" con la descripción
// abajo y a la derecha el botón para sumarlo al pedido.
export default function FilaProducto({ comida, cantidad, onAgregar, onSumar, onRestar, onPersonalizar, onVerDetalle }) {
  const conOpciones = tieneOpciones(comida);

  return (
    <li className="flex items-center gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={onVerDetalle}
            className="min-w-0 text-left text-sm font-bold sm:text-[15px] uppercase leading-snug tracking-wide hover:text-palmera"
          >
            {comida.nombre}
            {comida.destacado && (
              <>
                <IconoEstrella className="ml-1 inline size-3.5 -translate-y-px text-palmera" aria-hidden="true" />
                <span className="sr-only"> (destacado)</span>
              </>
            )}
          </button>
          <span className="mb-1.5 min-w-4 flex-1 border-b-2 border-dotted border-tinta/20" aria-hidden="true" />
          <PrecioFila comida={comida} />
        </div>
        {(comida.descripcion || tienePromo(comida)) && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-tinta-suave">
            {tienePromo(comida) && (
              <span className="mr-1.5 rounded-full bg-brasa px-1.5 py-px text-[10px] font-bold uppercase text-fondo">
                Promo
              </span>
            )}
            {comida.descripcion}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {!conOpciones && cantidad > 0 ? (
          <ControlCantidad cantidad={cantidad} onSumar={onSumar} onRestar={onRestar} nombre={comida.nombre} chico />
        ) : (
          <button
            type="button"
            onClick={conOpciones ? onPersonalizar : onAgregar}
            className="relative grid size-10 place-items-center rounded-full bg-palmera text-fondo shadow-sm transition hover:bg-palmera-oscuro active:scale-95"
            aria-label={conOpciones ? `Armar ${comida.nombre}` : `Agregar ${comida.nombre}`}
          >
            <IconoMas className="size-5" />
            {cantidad > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-tinta px-1 text-[11px] font-bold leading-5 text-fondo">
                {cantidad}
              </span>
            )}
          </button>
        )}
      </div>
    </li>
  );
}
