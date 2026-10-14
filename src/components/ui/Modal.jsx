import { useEffect, useRef } from "react";
import { IconoCerrar } from "./Iconos";

// Modal con <dialog> nativo: maneja el foco y se cierra con Escape solo.
export default function Modal({ abierto, onCerrar, titulo, children, ancho = "max-w-lg" }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      onClose={onCerrar}
      onClick={(e) => {
        // Click en el fondo oscuro (fuera del contenido) cierra
        if (e.target === ref.current) onCerrar();
      }}
      aria-label={titulo}
      className={`m-auto w-[calc(100%-1.5rem)] ${ancho} rounded-2xl border border-borde bg-papel p-0 text-tinta shadow-2xl`}
    >
      {abierto && (
        <div className="max-h-[85dvh] overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-borde bg-papel px-4 py-3">
            <h2 className="text-lg font-semibold">{titulo}</h2>
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-full p-1.5 text-tinta-suave hover:bg-borde hover:text-tinta"
              aria-label="Cerrar"
            >
              <IconoCerrar />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
