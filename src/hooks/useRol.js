import { createContext, useContext } from "react";

// Rol de quien usa el panel: "dueno" o "empleado". Lo pone Panel.
// La base hace cumplir los permisos igual; esto solo esconde los botones
// que el empleado no puede usar.
export const RolContext = createContext("empleado");

export function useRol() {
  const rol = useContext(RolContext);
  return { rol, esDueno: rol === "dueno" };
}

// "caja1@laspalmeras.club" → "caja1" (para mostrar quién hizo algo)
export function nombreUsuario(correo) {
  if (!correo) return "Carta online";
  return correo.split("@")[0];
}
