import logoBlanco from "../../assets/logo-blanco.png";

// Logo blanco sobre el mantel con una etiqueta escrita a mano que va cambiando
// (en la compu dice la sección en la que está el cliente).
export default function SelloCarta({ texto, className = "" }) {
  return (
    <div className={`relative mx-auto ${className}`}>
      <img
        src={logoBlanco}
        alt=""
        className="w-full drop-shadow-[0_6px_0_rgb(120_20_0/0.35)]"
        width="427"
        height="350"
      />
      <span
        key={texto}
        className="absolute -right-4 top-[8%] origin-left animate-pop rounded-full bg-papel px-4 py-1 font-script text-2xl text-palmera shadow-lg ring-2 ring-palmera-oscuro/20 sm:-right-8 sm:text-3xl"
        style={{ rotate: "-8deg" }}
      >
        {texto}
      </span>
    </div>
  );
}
