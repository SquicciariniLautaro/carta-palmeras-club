// "Ding-dong" para avisar un pedido nuevo, generado con Web Audio (sin archivos).
// Los navegadores solo dejan sonar después de que el usuario tocó algo en la
// página: prepararSonido() se llama con el primer toque del panel.

let contexto = null;

export function prepararSonido() {
  const Contexto = window.AudioContext || window.webkitAudioContext;
  if (!Contexto) return;
  contexto ??= new Contexto();
  if (contexto.state === "suspended") contexto.resume().catch(() => {});
}

function nota(frecuencia, inicio, duracion) {
  const oscilador = contexto.createOscillator();
  const volumen = contexto.createGain();
  oscilador.type = "sine";
  oscilador.frequency.value = frecuencia;
  volumen.gain.setValueAtTime(0.0001, inicio);
  volumen.gain.exponentialRampToValueAtTime(0.4, inicio + 0.02);
  volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  oscilador.connect(volumen).connect(contexto.destination);
  oscilador.start(inicio);
  oscilador.stop(inicio + duracion);
}

export function sonarAviso() {
  if (!contexto || contexto.state !== "running") return;
  const t = contexto.currentTime;
  // dos veces, para que se escuche en la cocina
  nota(988, t, 0.35);
  nota(784, t + 0.25, 0.5);
  nota(988, t + 0.9, 0.35);
  nota(784, t + 1.15, 0.5);
}
