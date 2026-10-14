// Horario de atención (tabla "horarios"). Misma regla que local_abierto() en
// el SQL, que es la que de verdad bloquea los pedidos; esto es para mostrarle
// al cliente si está abierto y cuándo abre.
//   desde < hasta → turno normal · desde > hasta → cruza la medianoche · iguales → todo el día

export const ZONA_HORARIA = "America/Argentina/Buenos_Aires";

// 0 = domingo, igual que en la base
export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
// Orden para mostrar la semana: de lunes a domingo
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

const DIAS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatoLocal = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_HORARIA,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// "20:00:00" → "20:00"
export function hhmm(hora) {
  return String(hora ?? "").slice(0, 5);
}

function minutosDe(hora) {
  const [h, m] = String(hora).split(":").map(Number);
  return h * 60 + m;
}

// Día de la semana y minutos desde las 00 en la hora de Argentina
export function ahoraLocal(fecha = new Date()) {
  const partes = Object.fromEntries(formatoLocal.formatToParts(fecha).map((p) => [p.type, p.value]));
  return { dia: DIAS_EN.indexOf(partes.weekday), minutos: Number(partes.hour) * 60 + Number(partes.minute) };
}

export function todoElDia(turno) {
  return hhmm(turno.desde) === hhmm(turno.hasta);
}

function enTurno(turno, minutos, esDeAyer) {
  if (!turno?.abierto) return false;
  const desde = minutosDe(turno.desde);
  const hasta = minutosDe(turno.hasta);
  if (esDeAyer) return desde > hasta && minutos < hasta;
  if (desde === hasta) return true;
  return desde < hasta ? minutos >= desde && minutos < hasta : minutos >= desde;
}

// "Lunes: 20:00 a 01:00" / "Lunes: todo el día" / "Lunes: cerrado"
export function textoTurno(turno) {
  if (!turno?.abierto) return "cerrado";
  if (todoElDia(turno)) return "todo el día";
  return `${hhmm(turno.desde)} a ${hhmm(turno.hasta)}`;
}

// Devuelve { abierto, abre } donde abre es { cuando: "hoy" | "mañana" | "el viernes", hora } o null.
// Sin horarios cargados (o si la tabla no existe todavía) se considera abierto.
export function estadoLocal(horarios, fecha = new Date()) {
  if (!horarios?.length) return { abierto: true, abre: null };
  const porDia = new Map(horarios.map((h) => [h.dia, h]));
  const { dia, minutos } = ahoraLocal(fecha);

  if (enTurno(porDia.get(dia), minutos, false) || enTurno(porDia.get((dia + 6) % 7), minutos, true)) {
    return { abierto: true, abre: null };
  }

  for (let i = 0; i <= 7; i++) {
    const turno = porDia.get((dia + i) % 7);
    if (!turno?.abierto) continue;
    if (i === 0 && minutosDe(turno.desde) <= minutos) continue; // el turno de hoy ya pasó
    const cuando = i === 0 ? "hoy" : i === 1 ? "mañana" : `el ${DIAS[(dia + i) % 7].toLowerCase()}`;
    return { abierto: false, abre: { cuando, hora: hhmm(turno.desde) } };
  }
  return { abierto: false, abre: null };
}

// "Abrimos hoy a las 20:00" / "Por ahora no estamos tomando pedidos"
export function textoApertura(estado) {
  return estado.abre
    ? `Abrimos ${estado.abre.cuando} a las ${estado.abre.hora} hs`
    : "Por ahora no estamos tomando pedidos";
}
