import { tienePromo } from "../../lib/formato";
import { urlImagen } from "../../lib/imagenes";
import { tieneOpciones } from "../../lib/opciones";
import { IconoEstrella } from "../ui/Iconos";
import ControlCantidad from "./ControlCantidad";
import Precio from "./Precio";

// Foto de la comida, siempre centrada en su recuadro. "proporcion" y "ancho"
// tienen que coincidir con el recuadro (ej. aspect-square → "1:1").
export function ImagenComida({ comida, className = "", proporcion = "1:1", ancho = 600 }) {
  if (!comida.imagen_url) {
    return (
      <div className={`grid place-items-center bg-borde text-center text-xs text-tinta-suave ${className}`}>
        Sin imagen
      </div>
    );
  }
  return (
    <img
      src={urlImagen(comida.imagen_url, { ancho, proporcion })}
      alt={comida.nombre}
      loading="lazy"
      decoding="async"
      className={`block object-cover object-center ${className}`}
    />
  );
}

export default function TarjetaProducto({ comida, cantidad, onAgregar, onSumar, onRestar, onPersonalizar, onVerDetalle }) {
  const conOpciones = tieneOpciones(comida);

  return (
    <article className="tarjeta flex flex-col overflow-hidden">
      <button
        type="button"
        onClick={onVerDetalle}
        className="relative block text-left"
        aria-label={`Ver detalle de ${comida.nombre}`}
      >
        <ImagenComida comida={comida} className="aspect-square w-full" />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {tienePromo(comida) && (
            <span className="rounded-full bg-brasa px-2 py-0.5 text-[11px] font-bold text-fondo">¡Promo!</span>
          )}
          {comida.destacado && (
            <span className="inline-flex items-center gap-1 rounded-full bg-fondo/85 px-2 py-0.5 text-[11px] font-semibold text-palmera">
              <IconoEstrella className="size-3" /> Destacado
            </span>
          )}
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{comida.nombre}</h3>
        <div className="mt-auto">
          <Precio comida={comida} />
        </div>
        {conOpciones ? (
          <button type="button" onClick={onPersonalizar} className="boton-primario w-full px-2">
            {cantidad > 0 ? `Agregar otra (${cantidad})` : "Armar mi pedido"}
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
      <div className="aspect-square bg-borde" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-3/4 rounded bg-borde" />
        <div className="h-3 w-1/3 rounded bg-borde" />
        <div className="h-9 rounded-xl bg-borde" />
      </div>
    </div>
  );
}
