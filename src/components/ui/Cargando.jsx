export default function Cargando({ texto = "Cargando…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-crema-suave" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-noche-3 border-t-queso" />
      <span className="text-sm">{texto}</span>
    </div>
  );
}
