import logoBlanco from "../../assets/logo-blanco.png";

// Logo oficial de Las Palmeras Club (versión blanca, para fondo oscuro).
// La versión negra está en src/assets/logo-negro.png para fondos claros.
export default function Logo({ className = "h-11 w-auto" }) {
  return <img src={logoBlanco} alt="Las Palmeras Club" className={className} width="427" height="350" />;
}
