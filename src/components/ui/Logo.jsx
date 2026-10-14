import logoBlanco from "../../assets/logo-negro.png";

// Logo oficial de Las Palmeras Club (versión blanca, para fondo oscuro).
// La versión blanca está en src/assets/logo-blanco.png para fondos oscuros.
export default function Logo({ className = "h-11 w-auto" }) {
  return <img src={logoBlanco} alt="Las Palmeras Club" className={className} width="427" height="350" />;
}
