import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatearDia, formatearPrecio } from "../../lib/formato";

const COLOR_BARRA = "#f5b82e";
const COLOR_EJE = "#b5ab9b";
const COLOR_GRILLA = "#2e2e2e";

const formatoCorto = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  notation: "compact",
  maximumFractionDigits: 1,
});

function TooltipFacturacion({ active, payload }) {
  if (!active || !payload?.length) return null;
  const dato = payload[0].payload;
  return (
    <div className="rounded-lg border border-noche-3 bg-noche px-3 py-2 text-xs shadow-lg">
      <p className="text-crema-suave">{dato.fecha.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</p>
      <p className="font-semibold text-crema">{formatearPrecio(dato.total)}</p>
    </div>
  );
}

// Facturación diaria (ventas confirmadas) del período
export function GraficoFacturacion({ dias }) {
  const hayDatos = dias.some((d) => d.total > 0);
  return (
    <div className="tarjeta p-4">
      <h2 className="text-sm font-semibold">Facturación por día</h2>
      <p className="mb-3 text-xs text-crema-suave">Solo ventas confirmadas, en pesos.</p>
      {hayDatos ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dias} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={COLOR_GRILLA} />
              <XAxis
                dataKey="clave"
                tickFormatter={(_, i) => formatearDia(dias[i].fecha)}
                tick={{ fill: COLOR_EJE, fontSize: 11 }}
                axisLine={{ stroke: COLOR_GRILLA }}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                tickFormatter={(v) => formatoCorto.format(v)}
                tick={{ fill: COLOR_EJE, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <Tooltip content={<TooltipFacturacion />} cursor={{ fill: "rgb(255 255 255 / 0.05)" }} />
              <Bar dataKey="total" name="Facturación" fill={COLOR_BARRA} radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="grid h-40 place-items-center text-sm text-crema-suave">Sin ventas confirmadas en este período.</p>
      )}
    </div>
  );
}

// Ranking de las 5 comidas más vendidas (por unidades)
export function RankingComidas({ ranking }) {
  const maximo = Math.max(1, ...ranking.map((r) => r.unidades));
  return (
    <div className="tarjeta p-4">
      <h2 className="text-sm font-semibold">Las 5 más vendidas</h2>
      <p className="mb-3 text-xs text-crema-suave">Unidades en ventas confirmadas.</p>
      {ranking.length === 0 ? (
        <p className="grid h-40 place-items-center text-sm text-crema-suave">Todavía no hay datos.</p>
      ) : (
        <ol className="space-y-3">
          {ranking.map((r, i) => (
            <li key={r.nombre + i}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">
                  <span className="mr-1 text-crema-suave">{i + 1}.</span>
                  {r.nombre}
                </span>
                <span className="shrink-0 font-semibold">{r.unidades} u.</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-noche-3">
                <div
                  className="h-2 rounded-full bg-queso"
                  style={{ width: `${(r.unidades / maximo) * 100}%` }}
                  title={formatearPrecio(r.total)}
                />
              </div>
              <p className="mt-0.5 text-right text-[11px] text-crema-suave">{formatearPrecio(r.total)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
