import { Link } from "react-router";
import { useSesion } from "../../hooks/useSesion";
import Logo from "../ui/Logo";
import { IconoBolsa, IconoCandado } from "../ui/Iconos";

export default function Navbar({ cantidad, onAbrirCarrito }) {
  const { esAdmin } = useSesion();
  return (
    <header className="sticky top-0 z-30 h-[72px] bg-fondo">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-3 px-4">
        <a href="/" aria-label="Las Palmeras Club, inicio">
          <Logo className="h-12 w-auto" />
        </a>
        <div className="flex items-center gap-2">
        {esAdmin === true && (
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 rounded-full border border-borde bg-papel px-3 py-2 text-sm font-semibold text-tinta hover:bg-borde"
          >
            <IconoCandado className="size-4" /> Panel
          </Link>
        )}
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
      </div>
    </header>
  );
}
