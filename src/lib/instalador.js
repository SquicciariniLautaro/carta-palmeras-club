// Instalador de un doble clic para la computadora del local: un .bat que adentro
// lleva el script de PowerShell (instalador-panel.ps1). Deja la ticketera como
// predeterminada, activa el corte del papel y crea el acceso directo "Panel Palmeras"
// que abre el panel imprimiendo sin el cuadro de Chrome.
//
// El .bat es "híbrido": cmd ejecuta las primeras líneas, que le pasan el mismo
// archivo a PowerShell; para PowerShell esas líneas son un comentario <# … #>.

export const NOMBRE_INSTALADOR = "Instalar Panel Palmeras.bat";

const CABECERA = [
  "<# : Instalador del Panel Palmeras (doble clic). Si Windows avisa, tocar Mas informacion y Ejecutar de todas formas.",
  "@echo off",
  'set "INSTALADOR=%~f0"',
  'set "PANEL_PRUEBA=%~1"',
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath $env:INSTALADOR -Encoding UTF8) -join [char]10)"',
  "echo.",
  "pause",
  "exit /b",
  "#>",
];

// cuerpo: el texto de instalador-panel.ps1 · urlPanel: https://…/admin
export function armarInstalador(cuerpo, urlPanel) {
  if (!/^https?:\/\/[^\s'"]+$/.test(urlPanel)) throw new Error("Dirección del panel inválida");
  const texto = [...CABECERA, cuerpo.replaceAll("__PANEL__", urlPanel)].join("\n");
  return texto.replace(/\r?\n/g, "\r\n"); // cmd necesita fin de línea de Windows
}

export function descargarInstalador(cuerpo, urlPanel) {
  const blob = new Blob([armarInstalador(cuerpo, urlPanel)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = NOMBRE_INSTALADOR;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
