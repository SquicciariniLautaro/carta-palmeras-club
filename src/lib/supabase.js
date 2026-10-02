import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const claveAnonima = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigurado = Boolean(url && claveAnonima);

if (!supabaseConfigurado) {
  console.error(
    "Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Copiá .env.example como .env y completalos."
  );
}

// Solo la clave anónima: la seguridad la ponen las políticas RLS y las
// funciones RPC. Nunca uses la clave service_role en el frontend.
export const supabase = createClient(
  url || "http://localhost:54321",
  claveAnonima || "falta-configurar"
);

// Convierte los errores de Supabase/Postgres en mensajes en español.
export function mensajeDeError(error, porDefecto = "Ocurrió un error. Probá de nuevo.") {
  if (!error) return porDefecto;
  const msj = error.message || "";
  if (/failed to fetch|networkerror|load failed/i.test(msj)) {
    return "No pudimos conectarnos. Revisá tu conexión a internet.";
  }
  if (error.code === "23503") return "No se puede borrar porque tiene datos relacionados.";
  if (error.code === "23505") return "Ya existe un registro con ese nombre.";
  if (error.code === "23514") return "Algún dato no cumple las reglas (revisá precios y stock).";
  if (error.code === "42501" || /row-level security|permission denied/i.test(msj)) {
    return "No tenés permisos para hacer esto.";
  }
  if (error.code === "P0001" && msj) return msj; // mensajes propios de las funciones SQL
  return msj && /[áéíóúñ¿¡]/i.test(msj) ? msj : porDefecto;
}
