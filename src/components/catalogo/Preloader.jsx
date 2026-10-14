import logoBlanco from "../../assets/logo-blanco.png";

// Pantalla de carga inicial: fondo rojo anaranjado para que el logo blanco resalte
export default function Preloader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-palmera" role="status">
      <img src={logoBlanco} alt="Las Palmeras Club" className="h-40 w-auto origin-bottom animate-balanceo" />
      <p className="font-script text-4xl text-fondo">Preparando el menú…</p>
    </div>
  );
}
