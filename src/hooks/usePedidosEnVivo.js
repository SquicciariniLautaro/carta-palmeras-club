import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { ESTADOS_ABIERTOS } from "../components/admin/ventasUtils";

// Respaldo por si el tiempo real se corta: se revisa igual cada tanto
const CADA_MS = 30_000;

// Mantiene al día los pedidos sin cerrar del panel:
//   - se entera al instante por Supabase Realtime (y cada 30 s por las dudas),
//   - avisa con onNuevo(pedidos) cuando entra un pedido web nuevo,
//   - "version" cambia cada vez que hay cambios, para que Ventas se recargue sola.
export function usePedidosEnVivo(onNuevo) {
  const [abiertos, setAbiertos] = useState([]);
  const [version, setVersion] = useState(0);
  const vistos = useRef(null); // ids ya conocidos (null = todavía no cargó)
  const firma = useRef("");
  const avisar = useRef(onNuevo);
  useEffect(() => {
    avisar.current = onNuevo;
  });

  // forzar = vino un cambio por tiempo real: Ventas se recarga aunque no cambien los abiertos
  const revisar = useCallback((forzar = false) => {
    return supabase
      .from("ventas")
      .select("id, numero, estado, cliente_nombre, total, origen")
      .in("estado", ESTADOS_ABIERTOS)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) return;

        const primeraVez = vistos.current === null;
        const nuevos = primeraVez
          ? []
          : data.filter((v) => !vistos.current.has(v.id) && v.origen === "web" && v.estado === "pendiente");
        vistos.current ??= new Set();
        for (const v of data) vistos.current.add(v.id);

        const nuevaFirma = data.map((v) => `${v.id}:${v.estado}:${v.total}`).join("|");
        const cambio = nuevaFirma !== firma.current;
        firma.current = nuevaFirma;

        setAbiertos(data);
        if (!primeraVez && (forzar || cambio)) setVersion((n) => n + 1);
        if (nuevos.length > 0) avisar.current?.(nuevos);
      });
  }, []);

  useEffect(() => {
    revisar();
    const intervalo = setInterval(() => revisar(), CADA_MS);
    const alVolver = () => document.visibilityState === "visible" && revisar();
    document.addEventListener("visibilitychange", alVolver);
    const canal = supabase
      .channel("panel-ventas")
      .on("postgres_changes", { event: "*", schema: "public", table: "ventas" }, () => revisar(true))
      .subscribe();
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
      supabase.removeChannel(canal);
    };
  }, [revisar]);

  return { abiertos, version, revisar };
}
