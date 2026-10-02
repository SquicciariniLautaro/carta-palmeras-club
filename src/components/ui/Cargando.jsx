export default function Cargando({ texto = "Cargando…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-tinta-suave" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-borde border-t-palmera" />
      <span className="text-sm">{texto}</span>
    </div>
  );
}
