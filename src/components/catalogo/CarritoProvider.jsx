import { useEffect, useMemo, useReducer } from "react";
import {
  CarritoContext,
  carritoReducer,
  guardarCarrito,
  leerCarritoGuardado,
} from "../../hooks/useCarrito";

export default function CarritoProvider({ children }) {
  const [items, dispatch] = useReducer(carritoReducer, undefined, leerCarritoGuardado);

  // Persistimos en localStorage cada vez que cambia
  useEffect(() => {
    guardarCarrito(items);
  }, [items]);

  const valor = useMemo(
    () => ({
      items,
      agregar: (id) => dispatch({ type: "agregar", id }),
      restar: (id) => dispatch({ type: "restar", id }),
      eliminar: (id) => dispatch({ type: "eliminar", id }),
      reemplazar: (nuevos) => dispatch({ type: "reemplazar", items: nuevos }),
      vaciar: () => dispatch({ type: "vaciar" }),
      cantidadDe: (id) => items.find((i) => i.id === id)?.cantidad ?? 0,
    }),
    [items]
  );

  return <CarritoContext.Provider value={valor}>{children}</CarritoContext.Provider>;
}
