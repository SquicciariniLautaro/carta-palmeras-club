import { formatearPesos } from "../../lib/formato";

export const PAGO_INICIAL = Object.freeze({
  dividido: false,
  metodo: "efectivo",
  recibido: "",
  partes: [
    { metodo: "efectivo", monto: "" },
    { metodo: "transferencia", monto: "" },
  ],
  clienteId: "",
});

const redondo = (n) => Math.round(Number(n) * 100) / 100;

// Valida lo cargado y lo deja en el formato de la base:
// [{ metodo, monto (null = el resto), cliente_id }]
export function validarPago(pago, total) {
  const conCliente = (metodo) => (metodo === "cuenta_corriente" ? { cliente_id: pago.clienteId } : {});
  if (!pago.dividido) {
    if (pago.metodo === "cuenta_corriente" && !pago.clienteId) return { error: "Elegí el cliente de la cuenta corriente." };
    return { pagos: [{ metodo: pago.metodo, monto: null, ...conCliente(pago.metodo) }] };
  }
  const partes = pago.partes;
  const metodos = partes.map((p) => p.metodo);
  if (new Set(metodos).size !== metodos.length) return { error: "No repitas la misma forma de pago." };
  const vacias = partes.filter((p) => p.monto === "");
  if (vacias.length > 1) return { error: "Completá los montos: solo una forma de pago puede llevarse el resto." };
  if (partes.some((p) => p.monto !== "" && !(Number(p.monto) > 0))) return { error: "Los montos tienen que ser mayores a 0." };
  const suma = redondo(partes.reduce((acc, p) => acc + (p.monto === "" ? 0 : Number(p.monto)), 0));
  if (vacias.length === 1 && suma >= redondo(total)) return { error: "Los montos ya cubren el total: sacá la forma de pago que sobra." };
  if (vacias.length === 0 && suma !== redondo(total)) {
    return { error: `Los montos suman ${formatearPesos(suma)} y el total es ${formatearPesos(total)}.` };
  }
  if (metodos.includes("cuenta_corriente") && !pago.clienteId) return { error: "Elegí el cliente de la cuenta corriente." };
  return {
    pagos: partes.map((p) => ({ metodo: p.metodo, monto: p.monto === "" ? null : redondo(p.monto), ...conCliente(p.metodo) })),
  };
}

export function pagoUsaCaja(pago) {
  return pago.dividido ? pago.partes.some((p) => p.metodo !== "cuenta_corriente") : pago.metodo !== "cuenta_corriente";
}

// Completa el pago que quedó sin monto ("el resto") para mostrarlo o imprimirlo
export function pagosConMontos(pagos, total) {
  const cubierto = pagos.reduce((acc, p) => acc + (p.monto ?? 0), 0);
  return pagos.map((p) => ({ ...p, monto: p.monto ?? Math.round((total - cubierto) * 100) / 100 }));
}
