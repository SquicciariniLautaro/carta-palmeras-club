import { formatearPrecio } from "../../lib/formato";
import { IconoBolsa } from "../ui/Iconos";

export default function BotonFlotante({ cantidad, total, visible, onClick }) {
  if (!visible || cantidad === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-full bg-queso px-5 py-3 font-semibold text-noche shadow-xl shadow-black/40 hover:bg-queso-oscuro"
      >
        <span className="flex items-center gap-2">
          <IconoBolsa className="size-5" /> Ver pedido ({cantidad})
        </span>
        <span>{formatearPrecio(total)}</span>
      </button>
    </div>
  );
}
