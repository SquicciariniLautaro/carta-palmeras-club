import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { CajaContext } from "../../hooks/useCaja";

export default function CajaProvider({ children }) {
  const [estado, setEstado] = useState({ caja: null, cargando: true });

  const recargar = useCallback(() => {
    return supabase
      .from("cajas")
      .select("*")
      .eq("estado", "abierta")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.warn("No se pudo leer la caja (¿falta correr el SQL?)", error);
        setEstado({ caja: data ?? null, cargando: false });
      });
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const valor = useMemo(() => ({ ...estado, recargar }), [estado, recargar]);
  return <CajaContext.Provider value={valor}>{children}</CajaContext.Provider>;
}
