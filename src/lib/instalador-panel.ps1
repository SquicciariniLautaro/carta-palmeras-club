# Instalador del Panel Palmeras para la computadora del local (Windows).
# Lo arma lib/instalador.js dentro de un .bat de doble clic; __PANEL__ es la dirección del panel.
#
# Hace, en este orden:
#   1. Busca Google Chrome.
#   2. Pregunta cuál es la ticketera y la deja como impresora predeterminada.
#   3. Intenta activar en el driver "Corte al final del documento" (o el corte que tenga);
#      si el driver no lo deja, abre sus Preferencias para elegirlo a mano.
#   4. Crea el acceso directo "Panel Palmeras" en el escritorio: abre el panel en una
#      ventana propia de Chrome que imprime sin el cuadro de diálogo (--kiosk-printing)
#      y deja sonar el aviso de pedido sin tocar la pantalla antes.
#   5. Opcional: que el panel se abra solo al prender la computadora.
#
# Con el argumento "prueba" (PANEL_PRUEBA=prueba) no cambia nada: solo muestra lo que haría.

$ErrorActionPreference = 'Stop'
$PANEL = '__PANEL__'
$PERFIL = 'C:\PanelPalmeras'
$PRUEBA = $env:PANEL_PRUEBA -eq 'prueba'

function Titulo($texto) { Write-Host ''; Write-Host $texto -ForegroundColor Yellow }
function Bien($texto) { Write-Host ('   OK  ' + $texto) -ForegroundColor Green }
function Ojo($texto) { Write-Host ('   !!  ' + $texto) -ForegroundColor Magenta }
function Info($texto) { Write-Host ('       ' + $texto) }
function Hacer($que, [scriptblock]$accion) {
  if ($PRUEBA) { Write-Host ('   (prueba) ' + $que) -ForegroundColor Cyan } else { & $accion }
}
function Preguntar($pregunta, $porDefecto) {
  if ($PRUEBA) { return $porDefecto }
  $r = Read-Host $pregunta
  if ([string]::IsNullOrWhiteSpace($r)) { return $porDefecto }
  return $r.Trim()
}

try { $Host.UI.RawUI.WindowTitle = 'Instalador del Panel Palmeras' } catch { }
Write-Host ''
Write-Host '  LAS PALMERAS CLUB - Instalador del panel' -ForegroundColor White
Write-Host ('  Panel: ' + $PANEL)
if ($PRUEBA) { Ojo 'MODO PRUEBA: no se cambia nada, solo se muestra lo que haría.' }

# ---------------------------------------------------------------------------
Titulo '1. Google Chrome'
$chrome = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)') + '') 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chrome) {
  Ojo 'No encontré Google Chrome en esta computadora.'
  Info 'Instalalo desde google.com/chrome y volvé a abrir este instalador.'
  exit 1
}
Bien $chrome

# ---------------------------------------------------------------------------
Titulo '2. La ticketera'
$virtuales = 'pdf|xps|onenote|fax|anydesk|teamviewer|send to|enviar a'
$impresoras = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -notmatch $virtuales } | Sort-Object Name)
if ($impresoras.Count -eq 0) {
  Ojo 'Windows no tiene ninguna impresora instalada.'
  Info 'Instalá el driver de la ticketera (en el panel: Ticketera, paso 1) y volvé a abrir este instalador.'
  exit 1
}
$pareceTicketera = 'pos|3nstar|rpt|xprinter|xp-|thermal|t[eé]rmica|receipt|ticket|tm-t|tm-m|gadnic|hasar|bematech|star |citizen|bixolon|rongta|hprt|80mm|58mm|80 mm|58 mm'
$sugerida = 1
for ($i = 0; $i -lt $impresoras.Count; $i++) {
  $p = $impresoras[$i]
  $marca = ''
  if (($p.Name + ' ' + $p.DriverName) -match $pareceTicketera) {
    $marca = '   <- parece la ticketera'
    if ($sugerida -eq 1 -and -not (($impresoras[0].Name + ' ' + $impresoras[0].DriverName) -match $pareceTicketera)) { $sugerida = $i + 1 }
  }
  Info ('{0}. {1}{2}' -f ($i + 1), $p.Name, $marca)
}
$respuesta = Preguntar ('Escribí el número de la ticketera y tocá Enter (Enter solo = ' + $sugerida + ')') $sugerida
$numero = 0
if (-not [int]::TryParse([string]$respuesta, [ref]$numero) -or $numero -lt 1 -or $numero -gt $impresoras.Count) {
  Ojo 'Ese número no está en la lista. Volvé a abrir el instalador.'
  exit 1
}
$ticketera = $impresoras[$numero - 1].Name
Bien ('Ticketera: ' + $ticketera)

# ---------------------------------------------------------------------------
Titulo '3. Que sea la impresora predeterminada'
Hacer ('Dejar "' + $ticketera + '" como predeterminada, sin que Windows la cambie sola') {
  # "Permitir que Windows administre mi impresora predeterminada" = No
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows' -Name 'LegacyDefaultPrinterMode' -Value 1 -Type DWord
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($ticketera)
}
Bien 'Las comandas van a salir siempre por la ticketera'

# ---------------------------------------------------------------------------
Titulo '4. Que corte el papel solo'
$cortaSola = $false
try {
  Add-Type -AssemblyName System.Printing
  $cola = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($ticketera)
  $flujo = $cola.GetPrintCapabilitiesAsXml()
  $flujo.Position = 0
  [xml]$capacidades = (New-Object System.IO.StreamReader($flujo)).ReadToEnd()
  $ns = New-Object System.Xml.XmlNamespaceManager($capacidades.NameTable)
  $ns.AddNamespace('psf', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
  $nombreDe = {
    param($nodo)
    $visible = @($nodo.SelectNodes("psf:Property[@name='psk:DisplayName']/psf:Value", $ns) | ForEach-Object { $_.InnerText }) -join ' '
    ($nodo.GetAttribute('name') + ' ' + $visible).Trim()
  }
  $deCorte = 'cut|corte|cortar|cutter|cuchilla'
  $sinCorte = '\bno\b|none|ning|sin corte|disable|off\b|never|nunca|desactiv|nocut'
  # De la mejor a la peor: al final del documento, parcial, total, cualquier corte, "activado"
  # (la opción a veces no dice "corte" porque ya lo dice la característica: "Cutter: Enable")
  $prioridades = @('(end|final|fin).*(doc|job|trabajo)|(doc|job|trabajo).*(end|final|fin)', 'partial|parcial', 'full|total|complet', $deCorte, 'enable|\bon\b|\byes\b|\bs[ií]\b|activ')
  $elegidas = @()
  foreach ($caracteristica in $capacidades.SelectNodes('/psf:PrintCapabilities/psf:Feature', $ns)) {
    $nombre = & $nombreDe $caracteristica
    if ($nombre -notmatch $deCorte) { continue }
    $opciones = @($caracteristica.SelectNodes('psf:Option', $ns) | Where-Object { $_.GetAttribute('name') })
    $opcion = $null
    foreach ($patron in $prioridades) {
      $opcion = $opciones | Where-Object { $o = & $nombreDe $_; ($o -match $patron) -and ($o -notmatch $sinCorte) } | Select-Object -First 1
      if ($opcion) { break }
    }
    if ($opcion) {
      $elegidas += [pscustomobject]@{ Caracteristica = $caracteristica.GetAttribute('name'); Opcion = $opcion.GetAttribute('name'); Texto = ($nombre + '  ->  ' + (& $nombreDe $opcion)) }
    }
  }
  if ($elegidas.Count -gt 0) {
    foreach ($e in $elegidas) { Info ('Encontré: ' + $e.Texto) }
    $espacios = @($capacidades.DocumentElement.Attributes | Where-Object { $_.Name -like 'xmlns*' } | ForEach-Object { '{0}="{1}"' -f $_.Name, $_.Value }) -join ' '
    $cuerpo = @($elegidas | ForEach-Object { '<psf:Feature name="{0}"><psf:Option name="{1}"/></psf:Feature>' -f $_.Caracteristica, $_.Opcion }) -join ''
    $xml = '<?xml version="1.0" encoding="UTF-8"?><psf:PrintTicket {0} version="1">{1}</psf:PrintTicket>' -f $espacios, $cuerpo
    Hacer 'Guardar el corte en las preferencias de la ticketera' {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($xml)
      $cambio = New-Object System.Printing.PrintTicket (New-Object System.IO.MemoryStream (, $bytes))
      $resultado = $cola.MergeAndValidatePrintTicket($cola.UserPrintTicket, $cambio)
      $cola.UserPrintTicket = $resultado.ValidatedPrintTicket
      $cola.Commit()
    }
    $cortaSola = $true
    Bien 'Corte activado'
  }
} catch {
  Info ('(El driver no deja cambiar el corte desde acá: ' + $_.Exception.Message + ')')
}
if (-not $cortaSola) {
  Ojo 'El corte hay que elegirlo a mano, una sola vez. Se abre la ventana de Preferencias de la ticketera:'
  Info '- Buscá la opción de corte: Corte de papel, Paper Cut, Cutter o Cut Mode'
  Info '  (a veces está adentro de "Opciones avanzadas" o en la pestaña "Device Settings").'
  Info '- Elegí "Corte al final del documento" (Cut at end of document) o "Corte parcial".'
  Info '- Tocá Aplicar y Aceptar. Si no aparece ninguna opción de corte, falta el driver de la marca.'
  Hacer 'Abrir las Preferencias de impresión de la ticketera' {
    Start-Process -FilePath 'rundll32.exe' -ArgumentList ('printui.dll,PrintUIEntry /e /n "' + $ticketera + '"') -Wait
  }
}

# ---------------------------------------------------------------------------
Titulo '5. El acceso directo "Panel Palmeras"'
# --kiosk-printing: imprime sin el cuadro de Chrome · --user-data-dir: un Chrome aparte, así funciona
# aunque el Chrome de siempre esté abierto · --app: ventana propia · --autoplay-policy: suena sin tocar antes
$argumentos = '--kiosk-printing --autoplay-policy=no-user-gesture-required --user-data-dir="' + $PERFIL + '" --app=' + $PANEL
$atajo = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Panel Palmeras.lnk'

# Si la ventana del panel ya estaba abierta, hay que cerrarla para que tome los permisos nuevos
$abiertos = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*PanelPalmeras*' })
if ($abiertos.Count -gt 0) {
  Hacer 'Cerrar la ventana del panel que estaba abierta' { $abiertos | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2 }
}

# Que la ventana del panel imprima siempre en la ticketera, sin márgenes ni encabezados
Hacer 'Dejar la ticketera elegida en la ventana del panel' {
  $carpeta = Join-Path $PERFIL 'Default'
  New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
  $archivo = Join-Path $carpeta 'Preferences'
  $estado = [ordered]@{
    version = 2; isHeaderFooterEnabled = $false; marginsType = 1; isCssBackgroundEnabled = $false; scaling = '100'; scalingType = 0
    recentDestinations = @(@{ id = $ticketera; origin = 'local'; account = ''; capabilities = ''; displayName = $ticketera; extensionId = ''; extensionName = '' })
  }
  $texto = $estado | ConvertTo-Json -Depth 5 -Compress
  try {
    if (Test-Path -LiteralPath $archivo) {
      Copy-Item -LiteralPath $archivo ($archivo + '.antes-del-instalador') -Force
      $prefs = Get-Content -LiteralPath $archivo -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
      $prefs = New-Object psobject
    }
    if (-not $prefs.PSObject.Properties['printing']) { $prefs | Add-Member -NotePropertyName printing -NotePropertyValue (New-Object psobject) }
    $prefs.printing | Add-Member -NotePropertyName print_preview_sticky_settings -NotePropertyValue ([pscustomobject]@{ appState = $texto }) -Force
    [System.IO.File]::WriteAllText($archivo, ($prefs | ConvertTo-Json -Depth 100 -Compress), (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Info ('(No pude guardar la impresora en la ventana del panel: ' + $_.Exception.Message + '. Igual usa la predeterminada.)')
  }
}

Hacer ('Crear el acceso directo en ' + $atajo) {
  $shell = New-Object -ComObject WScript.Shell
  $acceso = $shell.CreateShortcut($atajo)
  $acceso.TargetPath = $chrome
  $acceso.Arguments = $argumentos
  $acceso.WorkingDirectory = Split-Path -Parent $chrome
  $acceso.IconLocation = $chrome + ',0'
  $acceso.Description = 'Panel de Las Palmeras Club: imprime la comanda sola'
  $acceso.Save()
}
Bien 'Acceso directo "Panel Palmeras" en el escritorio'

$alPrender = Preguntar 'Querés que el panel se abra solo al prender la computadora? (S/N, Enter = S)' 'S'
if ($alPrender -notmatch '^[nN]') {
  Hacer 'Abrir el panel solo al prender la computadora' {
    Copy-Item -LiteralPath $atajo (Join-Path ([Environment]::GetFolderPath('Startup')) 'Panel Palmeras.lnk') -Force
  }
  Bien 'Se va a abrir solo al prender la computadora'
}

# ---------------------------------------------------------------------------
Titulo 'Listo'
Info 'Se abre el panel. La primera vez entrá con tu correo y contraseña.'
Info 'Después tocá Ticketera -> Imprimir prueba: tiene que salir sola y cortada.'
Info 'De ahora en más, abrí el panel SIEMPRE desde el acceso directo "Panel Palmeras".'
Hacer 'Abrir el panel' { Start-Process -FilePath $chrome -ArgumentList $argumentos }
