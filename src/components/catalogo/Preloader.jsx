import logoBlanco from "../../assets/logo-blanco.png";

// Pantalla de carga inicial con el logo animado
export default function Preloader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-fondo" role="status">
      <img src={logoBlanco} alt="Las Palmeras Club" className="h-32 w-auto origin-bottom animate-balanceo" />
      <p className="font-script text-3xl text-palmera">Preparando el menú…</p>
    </div>
  );
}
