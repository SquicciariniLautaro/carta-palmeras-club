import { IconoMas, IconoMenos } from "../ui/Iconos";

// Control "– cantidad +"
export default function ControlCantidad({ cantidad, onSumar, onRestar, nombre, chico = false }) {
  const tamBoton = chico ? "size-8" : "size-9";
  return (
    <div className="flex items-center justify-between gap-1 rounded-xl bg-fondo p-1">
      <button
        type="button"
        onClick={onRestar}
        className={`grid ${tamBoton} place-items-center rounded-lg bg-borde text-tinta hover:bg-brasa hover:text-fondo`}
        aria-label={`Quitar una unidad de ${nombre}`}
      >
        <IconoMenos className="size-4" />
      </button>
      <span className="min-w-6 text-center text-sm font-semibold" aria-live="polite">
        {cantidad}
      </span>
      <button
        type="button"
        onClick={onSumar}
        className={`grid ${tamBoton} place-items-center rounded-lg bg-palmera text-fondo hover:bg-palmera-oscuro`}
        aria-label={`Agregar una unidad de ${nombre}`}
      >
        <IconoMas className="size-4" />
      </button>
    </div>
  );
}
