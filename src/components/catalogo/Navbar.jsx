import Logo from "../ui/Logo";
import { IconoBolsa } from "../ui/Iconos";

export default function Navbar({ cantidad, onAbrirCarrito }) {
  return (
    <header className="sticky top-0 z-30 h-[72px] bg-fondo">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-3 px-4">
        <a href="/" aria-label="Las Palmeras Club, inicio">
          <Logo className="h-12 w-auto" />
        </a>
        <button
          type="button"
          onClick={onAbrirCarrito}
          className="relative inline-flex items-center gap-2 rounded-full bg-palmera px-4 py-2 text-sm font-semibold text-fondo hover:bg-palmera-oscuro"
          aria-label={`Mi pedido, ${cantidad} ${cantidad === 1 ? "producto" : "productos"}`}
        >
          <IconoBolsa className="size-5" />
          <span>Mi pedido</span>
          <span className="grid min-w-6 place-items-center rounded-full bg-fondo px-1.5 text-xs text-tinta">
            {cantidad}
          </span>
        </button>
      </div>
    </header>
  );
}
