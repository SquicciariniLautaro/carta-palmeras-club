-- =====================================================================
-- Las Palmeras Club · Esquema completo de Supabase
-- Pegá este archivo entero en Supabase → SQL Editor → New query → Run.
-- Se puede volver a correr: usa "if not exists" / "create or replace"
-- y borra las políticas antes de crearlas de nuevo. En una base creada
-- con una versión anterior, también la migra (turnos, cobros, caja,
-- gastos y cuentas corrientes).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

-- Turnos del negocio:
--   noche    → la carta online (pedidos por WhatsApp) y las ventas de la noche
--   mediodia → menú del mediodía, solo de uso interno (no aparece en la carta)

create table if not exists public.categorias (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  orden  int  not null default 0,
  turno  text not null default 'noche'
);

alter table public.categorias add column if not exists turno text not null default 'noche';
alter table public.categorias drop constraint if exists categorias_turno_check;
alter table public.categorias add constraint categorias_turno_check check (turno in ('noche', 'mediodia'));
-- El nombre se repite solo entre turnos distintos ("Bebidas" puede estar en los dos)
alter table public.categorias drop constraint if exists categorias_nombre_key;
create unique index if not exists categorias_turno_nombre_idx on public.categorias (turno, nombre);

-- Categorías de kiosco (bebidas, golosinas): son las únicas que llevan stock,
-- y lo que se vende de ellas no necesita comanda de cocina.
-- La primera vez marca solas las que se llaman Bebidas o Golosinas.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'categorias' and column_name = 'controla_stock') then
    alter table public.categorias add column controla_stock boolean not null default false;
    update public.categorias set controla_stock = true
     where nombre ilike 'bebida%' or nombre ilike 'golosina%';
  end if;
end;
$$;

create table if not exists public.comidas (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (length(btrim(nombre)) between 1 and 120),
  descripcion  text check (descripcion is null or length(descripcion) <= 1000),
  precio       numeric(12,2) not null check (precio > 0),
  precio_promo numeric(12,2) check (precio_promo is null or (precio_promo > 0 and precio_promo < precio)),
  -- "restrict": no se puede borrar una categoría que todavía tiene comidas
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  imagen_url   text,
  imagen_path  text,          -- ruta dentro del bucket "comidas", para poder borrarla
  destacado    boolean not null default false,
  activo       boolean not null default true,
  -- Opciones para personalizar el pedido (todas opcionales):
  --   variantes: [{ "nombre": "Simple", "precio": 8500 }, ...]  (si hay, el precio sale de acá)
  --   quitar:    ["Cebolla", "Tomate"]                          (ingredientes que se pueden sacar)
  --   agregar:   [{ "nombre": "Huevo", "precio": 1000 }, ...]   (extras con costo)
  --   pregunta:  "¿Para cuántas personas?"                     (título de las variantes en la carta)
  opciones     jsonb not null default '{}'::jsonb check (jsonb_typeof(opciones) = 'object'),
  -- Lo copia un trigger desde la categoría: no hace falta mandarlo
  turno        text not null default 'noche',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Para bases creadas con una versión anterior de este archivo
alter table public.comidas
  add column if not exists opciones jsonb not null default '{}'::jsonb;
alter table public.comidas add column if not exists turno text not null default 'noche';
alter table public.comidas drop constraint if exists comidas_turno_check;
alter table public.comidas add constraint comidas_turno_check check (turno in ('noche', 'mediodia'));

-- Stock: solo cuenta en las categorías de kiosco (controla_stock).
-- null = sin control. Las ventas lo descuentan solas (trigger venta_items_stock).
-- Las comidas de cocina no llevan stock: si no hay, se desactivan desde el panel.
alter table public.comidas add column if not exists stock int;

-- Platos sin precio: se pueden cargar sin precio (por ejemplo una lista nueva
-- del mediodía) para que el dueño lo ponga después. Mientras no tengan precio
-- no pueden estar disponibles, así nadie los vende a $ 0.
alter table public.comidas alter column precio drop not null;
alter table public.comidas drop constraint if exists comidas_precio_activo_check;
alter table public.comidas add constraint comidas_precio_activo_check check (precio is not null or not activo);

create index if not exists comidas_categoria_idx on public.comidas (categoria_id);

-- Clientes con cuenta corriente (fiado)
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(btrim(nombre)) between 1 and 80),
  telefono       text check (telefono is null or length(telefono) <= 30),
  documento      text check (documento is null or length(documento) <= 20),   -- DNI / CUIT
  notas          text check (notas is null or length(notas) <= 300),
  limite_credito numeric(12,2) check (limite_credito is null or limite_credito >= 0),
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists public.ventas (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity unique,  -- número de pedido legible
  created_at       timestamptz not null default now(),
  -- pendiente → en_preparacion → enviado → entregado → cerrado (cobrado)
  estado           text not null default 'pendiente',
  total            numeric(12,2) not null default 0 check (total >= 0),
  cliente_nombre   text check (cliente_nombre is null or length(cliente_nombre) <= 80),
  cliente_telefono text check (cliente_telefono is null or cliente_telefono ~ '^[0-9]{8,15}$'),
  nota             text check (nota is null or length(nota) <= 300),
  origen           text not null default 'web' check (origen in ('web', 'manual')),
  turno            text not null default 'noche',
  cerrada_at       timestamptz          -- cuándo se cobró
);

alter table public.ventas add column if not exists turno text not null default 'noche';
alter table public.ventas add column if not exists cliente_telefono text;
alter table public.ventas add column if not exists cerrada_at timestamptz;
alter table public.ventas drop constraint if exists ventas_turno_check;
-- 'cancha' = cobro de un turno de la cancha de fútbol (ver cancha_turnos)
alter table public.ventas add constraint ventas_turno_check check (turno in ('noche', 'mediodia', 'cancha'));
alter table public.ventas drop constraint if exists ventas_cliente_telefono_check;
alter table public.ventas add constraint ventas_cliente_telefono_check
  check (cliente_telefono is null or cliente_telefono ~ '^[0-9]{8,15}$');

-- Estados del pedido. Las bases anteriores usaban confirmada/cancelada:
-- se pasan a cerrado/cancelado antes de poner la regla nueva.
alter table public.ventas drop constraint if exists ventas_estado_check;
update public.ventas set estado = 'cerrado'   where estado = 'confirmada';
update public.ventas set estado = 'cancelado' where estado = 'cancelada';
-- Los pedidos cancelados se eliminan solos (ver trigger más abajo)
delete from public.ventas where estado = 'cancelado';
update public.ventas set cerrada_at = created_at where estado = 'cerrado' and cerrada_at is null;
alter table public.ventas add constraint ventas_estado_check
  check (estado in ('pendiente', 'en_preparacion', 'enviado', 'entregado', 'cerrado', 'cancelado'));

create index if not exists ventas_created_at_idx on public.ventas (created_at desc);
create index if not exists ventas_estado_idx on public.ventas (estado);
create index if not exists ventas_turno_idx on public.ventas (turno, created_at desc);

create table if not exists public.venta_items (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid not null references public.ventas (id) on delete cascade,
  comida_id       uuid references public.comidas (id) on delete set null,
  nombre          text not null,              -- copia del nombre al momento de la venta
  detalle         text,                       -- opción elegida, ingredientes sacados, extras, aclaración
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  cantidad        int not null check (cantidad > 0),
  subtotal        numeric(12,2) not null check (subtotal >= 0)
);

alter table public.venta_items add column if not exists detalle text;

create index if not exists venta_items_venta_idx on public.venta_items (venta_id);
create index if not exists venta_items_comida_idx on public.venta_items (comida_id);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- Quién usa el panel:
--   dueno    → todo, incluidos Gastos y costos y Finanzas
--   empleado → ventas (noche y mediodía), cancha, caja y cuentas corrientes
-- Los que ya estaban quedan como dueño.
alter table public.admins add column if not exists rol text not null default 'dueno';
alter table public.admins drop constraint if exists admins_rol_check;
alter table public.admins add constraint admins_rol_check check (rol in ('dueno', 'empleado'));

-- Horario de atención por turno: un turno por día (0 = domingo … 6 = sábado),
-- en hora de Argentina. El de la noche es el que controla la carta online.
--   desde < hasta  → turno normal (ej. 11:00 a 15:00)
--   desde > hasta  → cruza la medianoche (ej. 20:00 a 01:00)
--   desde = hasta  → abierto todo el día
create table if not exists public.horarios (
  turno   text not null default 'noche' check (turno in ('noche', 'mediodia')),
  dia     smallint not null check (dia between 0 and 6),
  abierto boolean not null default true,
  desde   time not null default '00:00',
  hasta   time not null default '00:00',
  primary key (turno, dia)
);

-- Bases anteriores: la clave era solo el día
alter table public.horarios add column if not exists turno text not null default 'noche';
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.horarios'::regclass and contype = 'p'
                and array_length(conkey, 1) = 1) then
    alter table public.horarios drop constraint horarios_pkey;
    alter table public.horarios add primary key (turno, dia);
  end if;
end;
$$;
alter table public.horarios drop constraint if exists horarios_turno_check;
alter table public.horarios add constraint horarios_turno_check check (turno in ('noche', 'mediodia'));

insert into public.horarios (turno, dia)
select 'noche', d from generate_series(0, 6) as d
on conflict (turno, dia) do nothing;

insert into public.horarios (turno, dia, desde, hasta)
select 'mediodia', d, '11:30', '15:30' from generate_series(0, 6) as d
on conflict (turno, dia) do nothing;

-- Menú del mediodía: qué platos salen cada día (cronograma)
create table if not exists public.menu_dia (
  fecha     date not null,
  comida_id uuid not null references public.comidas (id) on delete cascade,
  orden     int  not null default 0,
  primary key (fecha, comida_id)
);

-- Caja: cada fila es un arqueo (apertura → cierre). Solo una abierta a la vez.
-- Un arqueo cerrado ya no se puede editar (si hubo un error, se borra).
create table if not exists public.cajas (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity unique,
  estado           text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  turno            text check (turno is null or turno in ('noche', 'mediodia')),
  abierta_at       timestamptz not null default now(),
  abierta_por      text,
  monto_inicial    numeric(12,2) not null default 0 check (monto_inicial >= 0),
  cerrada_at       timestamptz,
  cerrada_por      text,
  efectivo_contado numeric(12,2) check (efectivo_contado is null or efectivo_contado >= 0),
  conteo           jsonb not null default '{}'::jsonb check (jsonb_typeof(conteo) = 'object'),
  resumen          jsonb,                 -- foto de los totales al cerrar
  nota             text check (nota is null or length(nota) <= 500)
);

create unique index if not exists cajas_una_abierta_idx on public.cajas ((estado)) where estado = 'abierta';
create index if not exists cajas_abierta_at_idx on public.cajas (abierta_at desc);

-- Cobros. Cada venta cobrada tiene uno o más pagos (se pueden combinar):
--   concepto 'venta'        → cobro de una venta (efectivo, transferencia o a cuenta corriente)
--   concepto 'cobro_cuenta' → el cliente paga (en efectivo o transferencia) lo que debe en su cuenta
create table if not exists public.pagos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  venta_id   uuid references public.ventas (id) on delete cascade,
  cliente_id uuid references public.clientes (id) on delete restrict,
  caja_id    uuid references public.cajas (id) on delete set null,
  metodo     text not null check (metodo in ('efectivo', 'transferencia', 'cuenta_corriente')),
  monto      numeric(12,2) not null check (monto > 0),
  concepto   text not null default 'venta' check (concepto in ('venta', 'cobro_cuenta')),
  nota       text check (nota is null or length(nota) <= 200),
  constraint pagos_coherentes check (
    (concepto = 'venta' and venta_id is not null
       and (metodo <> 'cuenta_corriente' or cliente_id is not null))
    or
    (concepto = 'cobro_cuenta' and venta_id is null and cliente_id is not null
       and metodo <> 'cuenta_corriente')
  )
);

create index if not exists pagos_created_at_idx on public.pagos (created_at desc);
create index if not exists pagos_venta_idx on public.pagos (venta_id);
create index if not exists pagos_cliente_idx on public.pagos (cliente_id);
create index if not exists pagos_caja_idx on public.pagos (caja_id);

-- Ingresos y retiros de efectivo de la caja que no son ventas
-- (cambio que se agrega, retiro del dueño, etc.)
create table if not exists public.caja_movimientos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  caja_id    uuid not null references public.cajas (id) on delete cascade,
  tipo       text not null check (tipo in ('ingreso', 'retiro')),
  concepto   text not null check (length(btrim(concepto)) between 1 and 120),
  monto      numeric(12,2) not null check (monto > 0)
);

create index if not exists caja_movimientos_caja_idx on public.caja_movimientos (caja_id);

-- Gastos y costos del negocio
create table if not exists public.gastos (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  fecha       date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  categoria   text not null check (length(btrim(categoria)) between 1 and 60),
  tipo        text not null default 'variable' check (tipo in ('fijo', 'variable')),
  descripcion text not null check (length(btrim(descripcion)) between 1 and 200),
  proveedor   text check (proveedor is null or length(proveedor) <= 120),
  comprobante text check (comprobante is null or length(comprobante) <= 60),
  monto       numeric(12,2) not null check (monto > 0),
  -- pagado: ya salió la plata · pendiente: factura a pagar (cuenta en "por pagar")
  estado      text not null default 'pagado' check (estado in ('pagado', 'pendiente')),
  vencimiento date,
  metodo      text check (metodo is null or metodo in ('efectivo', 'transferencia', 'tarjeta')),
  -- si se pagó en efectivo con la plata de la caja abierta, descuenta del arqueo
  caja_id     uuid references public.cajas (id) on delete set null,
  constraint gastos_pagado_con_metodo check (estado = 'pendiente' or metodo is not null),
  constraint gastos_caja_solo_efectivo check (caja_id is null or (metodo = 'efectivo' and estado = 'pagado'))
);

create index if not exists gastos_fecha_idx on public.gastos (fecha desc);
create index if not exists gastos_caja_idx on public.gastos (caja_id);

-- Cancha de fútbol: turnos de alquiler. Al cobrarlo (cobrar_turno_cancha) se
-- arma una venta del turno 'cancha' y se cobra como cualquier otra: entra en
-- la caja, en finanzas, en los Excel y en las cuentas corrientes.
create table if not exists public.cancha_turnos (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  fecha            date not null,
  desde            time not null,
  minutos          int  not null default 60 check (minutos between 30 and 720),
  cliente_nombre   text not null check (length(btrim(cliente_nombre)) between 1 and 80),
  cliente_telefono text check (cliente_telefono is null or length(cliente_telefono) <= 30),
  precio           numeric(12,2) not null check (precio > 0),   -- total del turno
  nota             text check (nota is null or length(nota) <= 300),
  venta_id         uuid unique references public.ventas (id) on delete set null   -- el cobro
);

create index if not exists cancha_turnos_fecha_idx on public.cancha_turnos (fecha, desde);

-- Turnos fijos de la cancha (todas las semanas el mismo día y hora). El panel
-- los anota como turnos comunes de cada día (preparar_turnos_fijos) para
-- cobrarlos o señarlos; si un día no vienen, se libera ese día.
create table if not exists public.cancha_fijos (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  dia_semana       smallint not null check (dia_semana between 0 and 6),   -- 0 = domingo
  desde            time not null,
  minutos          int  not null default 60 check (minutos between 30 and 720),
  cliente_nombre   text not null check (length(btrim(cliente_nombre)) between 1 and 80),
  cliente_telefono text check (cliente_telefono is null or length(cliente_telefono) <= 30),
  precio           numeric(12,2) not null check (precio > 0),
  nota             text check (nota is null or length(nota) <= 300),
  activo           boolean not null default true,
  creado_por       text default (auth.jwt() ->> 'email')
);

alter table public.cancha_turnos add column if not exists fijo_id uuid references public.cancha_fijos (id) on delete set null;
alter table public.cancha_turnos add column if not exists creado_por text default (auth.jwt() ->> 'email');
create unique index if not exists cancha_turnos_fijo_fecha_idx on public.cancha_turnos (fijo_id, fecha);

-- Días en que un turno fijo no viene (para no volver a anotarlo)
create table if not exists public.cancha_fijos_libres (
  fijo_id uuid not null references public.cancha_fijos (id) on delete cascade,
  fecha   date not null,
  primary key (fijo_id, fecha)
);

-- Ajustes que define el dueño. Por ahora: cancha_precio_hora (precio por
-- hora de la cancha: el empleado no puede cobrar otro precio).
create table if not exists public.ajustes (
  clave text primary key,
  valor numeric(12,2) not null check (valor >= 0)
);

-- Quién cobró cada cosa y quién movió la caja (correo del usuario)
alter table public.pagos add column if not exists usuario text default (auth.jwt() ->> 'email');
alter table public.caja_movimientos add column if not exists usuario text default (auth.jwt() ->> 'email');

-- Stock: a partir de cuántas unidades avisa que queda poco
alter table public.comidas add column if not exists stock_minimo int not null default 5;
alter table public.comidas drop constraint if exists comidas_stock_minimo_check;
alter table public.comidas add constraint comidas_stock_minimo_check check (stock_minimo between 0 and 100000);

-- Historial de stock: cada venta, devolución, mercadería que entra y ajuste
create table if not exists public.stock_movimientos (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  comida_id        uuid references public.comidas (id) on delete set null,
  nombre           text not null,
  tipo             text not null check (tipo in ('venta', 'devolucion', 'ingreso', 'ajuste')),
  cantidad         int  not null,            -- + entra, − sale
  stock_resultante int,
  venta_numero     bigint,
  nota             text check (nota is null or length(nota) <= 200),
  usuario          text default (auth.jwt() ->> 'email')
);

create index if not exists stock_movimientos_fecha_idx on public.stock_movimientos (created_at desc);
create index if not exists stock_movimientos_comida_idx on public.stock_movimientos (comida_id, created_at desc);

-- Registro de actividad: quién hizo qué y cuándo. Lo llenan triggers y
-- funciones; solo lo ve el dueño y nadie lo puede editar ni borrar.
create table if not exists public.actividad (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  usuario    text,            -- correo; null = la carta online
  rol        text,
  tipo       text not null,   -- venta, cobro, caja, cancha, stock, catalogo, cliente, gasto
  accion     text not null,
  detalle    text,
  monto      numeric(12,2)
);

create index if not exists actividad_fecha_idx on public.actividad (created_at desc);

-- ---------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists comidas_updated_at on public.comidas;
create trigger comidas_updated_at
  before update on public.comidas
  for each row execute function public.tocar_updated_at();

-- La comida toma el turno de su categoría (noche o mediodía)
create or replace function public._turno_de_categoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.turno into new.turno from public.categorias c where c.id = new.categoria_id;
  return new;
end;
$$;

drop trigger if exists comidas_turno on public.comidas;
create trigger comidas_turno
  before insert or update of categoria_id on public.comidas
  for each row execute function public._turno_de_categoria();

update public.comidas c set turno = k.turno
  from public.categorias k
 where k.id = c.categoria_id and c.turno <> k.turno;

-- Un pedido que pasa a "cancelado" se elimina automáticamente
create or replace function public._eliminar_cancelado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ventas where id = new.id;
  return null;
end;
$$;

drop trigger if exists ventas_eliminar_cancelado on public.ventas;
create trigger ventas_eliminar_cancelado
  after insert or update of estado on public.ventas
  for each row when (new.estado = 'cancelado')
  execute function public._eliminar_cancelado();

-- Una venta solo se cierra registrando el cobro, y una cobrada no se reabre
-- sin anular el cobro (así los números de caja siempre cierran)
create or replace function public._controlar_cierre_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'cerrado' and old.estado <> 'cerrado'
     and not exists (select 1 from public.pagos where venta_id = new.id) then
    raise exception 'Para cerrar la cuenta registrá el cobro (efectivo, transferencia o cuenta corriente).';
  end if;
  if old.estado = 'cerrado' and new.estado <> 'cerrado'
     and exists (select 1 from public.pagos where venta_id = new.id) then
    raise exception 'Esta venta ya está cobrada. Para cambiarla, primero anulá el cobro.';
  end if;
  return new;
end;
$$;

drop trigger if exists ventas_controlar_cierre on public.ventas;
create trigger ventas_controlar_cierre
  before update of estado on public.ventas
  for each row execute function public._controlar_cierre_venta();

-- Un arqueo cerrado no se edita (sí se puede borrar)
create or replace function public._bloquear_arqueo_cerrado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado = 'cerrada' then
    raise exception 'Este arqueo está cerrado y ya no se puede editar. Si hubo un error, podés borrarlo.';
  end if;
  return new;
end;
$$;

drop trigger if exists cajas_bloquear_cerrada on public.cajas;
create trigger cajas_bloquear_cerrada
  before update on public.cajas
  for each row execute function public._bloquear_arqueo_cerrado();

-- Los movimientos de un arqueo cerrado (cobros, ingresos, retiros y gastos
-- pagados con la caja) tampoco se pueden tocar.
create or replace function public._bloquear_movimiento_cerrado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.caja_id is not null
     and exists (select 1 from public.cajas where id = old.caja_id and estado = 'cerrada') then
    raise exception 'Este movimiento es parte de un arqueo cerrado y ya no se puede modificar ni borrar.';
  end if;
  if tg_op <> 'DELETE' and new.caja_id is not null
     and exists (select 1 from public.cajas where id = new.caja_id and estado = 'cerrada') then
    raise exception 'Ese arqueo ya está cerrado: no se le pueden sumar movimientos.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists pagos_bloquear_cerrado on public.pagos;
create trigger pagos_bloquear_cerrado
  before insert or update or delete on public.pagos
  for each row execute function public._bloquear_movimiento_cerrado();

drop trigger if exists caja_movimientos_bloquear_cerrado on public.caja_movimientos;
create trigger caja_movimientos_bloquear_cerrado
  before insert or update or delete on public.caja_movimientos
  for each row execute function public._bloquear_movimiento_cerrado();

drop trigger if exists gastos_bloquear_cerrado on public.gastos;
create trigger gastos_bloquear_cerrado
  before insert or update or delete on public.gastos
  for each row execute function public._bloquear_movimiento_cerrado();

-- Stock de kiosco: suma o resta unidades a una comida, solo si su categoría
-- controla stock y la comida tiene stock cargado. Estricto = pedido web: no
-- deja vender más de lo que hay (en el local se puede quedar en negativo, así
-- se ve la diferencia y se corrige el conteo). Cada cambio queda en stock_movimientos.
drop function if exists public._ajustar_stock(uuid, int, boolean);
create or replace function public._ajustar_stock(p_comida_id uuid, p_delta int, p_estricto boolean, p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock  int;
  v_nombre text;
  v_numero bigint;
begin
  if p_comida_id is null or p_delta = 0 then
    return;
  end if;
  update public.comidas c
     set stock = c.stock + p_delta
   where c.id = p_comida_id
     and c.stock is not null
     and exists (select 1 from public.categorias k where k.id = c.categoria_id and k.controla_stock)
  returning c.stock, c.nombre into v_stock, v_nombre;
  if not found then
    return;
  end if;
  if p_delta < 0 and p_estricto and v_stock < 0 then
    raise exception 'No nos queda stock suficiente de "%" (quedan %). Actualizá la página.',
      v_nombre, greatest(v_stock - p_delta, 0);
  end if;
  select v.numero into v_numero from public.ventas v where v.id = p_venta_id;
  insert into public.stock_movimientos (comida_id, nombre, tipo, cantidad, stock_resultante, venta_numero, nota)
  values (p_comida_id, v_nombre, case when p_delta < 0 then 'venta' else 'devolucion' end, p_delta, v_stock, v_numero,
          case when p_delta > 0 and v_numero is null then 'Pedido cancelado o venta borrada' end);
end;
$$;

-- Cada producto vendido descuenta su stock; si se saca del pedido, se borra
-- la venta o se cancela el pedido, vuelve.
create or replace function public._mover_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_web boolean;
begin
  if tg_op = 'DELETE' then
    perform public._ajustar_stock(old.comida_id, old.cantidad, false, old.venta_id);
    return old;
  end if;
  select v.origen = 'web' into v_web from public.ventas v where v.id = new.venta_id;
  if tg_op = 'INSERT' then
    perform public._ajustar_stock(new.comida_id, -new.cantidad, coalesce(v_web, false), new.venta_id);
  else
    perform public._ajustar_stock(new.comida_id, old.cantidad - new.cantidad, coalesce(v_web, false), new.venta_id);
  end if;
  return new;
end;
$$;

drop trigger if exists venta_items_stock on public.venta_items;
create trigger venta_items_stock
  after insert or update of cantidad or delete on public.venta_items
  for each row execute function public._mover_stock();

-- Turnos de la cancha: no se pisan, y uno cobrado no cambia de precio ni se
-- borra sin anular el cobro.
create or replace function public._controlar_turno_cancha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.cancha_turnos%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.venta_id is not null then
      raise exception 'Este turno ya está cobrado o señado. Para borrarlo, primero anulá el cobro.';
    end if;
    -- Turno fijo: se libera solo ese día (no se vuelve a anotar)
    if old.fijo_id is not null then
      insert into public.cancha_fijos_libres (fijo_id, fecha) values (old.fijo_id, old.fecha) on conflict do nothing;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.venta_id is not null and new.venta_id is not null and new.precio <> old.precio then
    raise exception 'Este turno ya está cobrado. Para cambiarle el precio, primero anulá el cobro.';
  end if;

  select * into t
    from public.cancha_turnos x
   where x.id <> new.id
     and (x.fecha + x.desde) < (new.fecha + new.desde) + make_interval(mins => new.minutos)
     and (new.fecha + new.desde) < (x.fecha + x.desde) + make_interval(mins => x.minutos)
   order by x.fecha, x.desde
   limit 1;
  if found then
    raise exception 'La cancha ya está reservada de % a % (%).',
      to_char(t.desde, 'HH24:MI'), to_char(t.desde + make_interval(mins => t.minutos), 'HH24:MI'), t.cliente_nombre;
  end if;
  return new;
end;
$$;

drop trigger if exists cancha_turnos_controlar on public.cancha_turnos;
create trigger cancha_turnos_controlar
  before insert or update or delete on public.cancha_turnos
  for each row execute function public._controlar_turno_cancha();

-- ---------------------------------------------------------------------
-- Permisos del empleado y registro de actividad
-- Las reglas miran current_user: 'authenticated' es alguien desde el panel
-- tocando la tabla directo. Las funciones de la base (cobrar, cerrar caja,
-- cargar mercadería…) corren como dueño de la base y ya hacen sus controles.
-- ---------------------------------------------------------------------

-- Anota una línea en el registro de actividad con el usuario que la hizo
create or replace function public._registrar(p_tipo text, p_accion text, p_detalle text default null, p_monto numeric default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.actividad (usuario, rol, tipo, accion, detalle, monto)
  values (auth.jwt() ->> 'email', (select a.rol from public.admins a where a.user_id = auth.uid()),
          p_tipo, p_accion, p_detalle, p_monto);
$$;

-- Venta nueva (pedido web o venta en caja)
create or replace function public._registrar_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.ventas%rowtype;
begin
  select * into v from public.ventas where id = p_venta_id;
  perform public._registrar('venta',
    case when v.origen = 'web' then 'Pedido web' else 'Venta en caja' end,
    '#' || v.numero || coalesce(' · ' || v.cliente_nombre, '') || ' · ' || initcap(v.turno), v.total);
end;
$$;

create or replace function public._nombre_estado(p_estado text)
returns text
language sql
immutable
as $$
  select case p_estado
    when 'pendiente' then 'Nuevo' when 'en_preparacion' then 'En preparación'
    when 'enviado' then 'En camino / listo' when 'entregado' then 'Entregado'
    when 'cerrado' then 'Cobrado' else p_estado end;
$$;

-- Lo que pasa en las tablas importantes queda en "actividad"
create or replace function public._actividad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero bigint;
  v_turno  text;
  v_texto  text;
begin
  -- Cambios que hace la base sola (turnos fijos que se anotan o se corren)
  if current_setting('palmeras.automatico', true) = 'si' then
    return null;
  end if;

  case tg_table_name
  when 'ventas' then
    if tg_op = 'UPDATE' and new.estado <> old.estado and new.estado not in ('cerrado', 'cancelado') then
      perform public._registrar('venta', 'Cambió el estado',
        '#' || new.numero || ': ' || public._nombre_estado(old.estado) || ' → ' || public._nombre_estado(new.estado), null);
    elsif tg_op = 'DELETE' then
      perform public._registrar('venta',
        case when old.estado = 'cerrado' then 'Borró una venta cobrada' else 'Canceló un pedido' end,
        '#' || old.numero || coalesce(' · ' || old.cliente_nombre, '') || ' · ' || initcap(old.turno), old.total);
    end if;

  when 'pagos' then
    if tg_op = 'INSERT' then
      if new.concepto = 'cobro_cuenta' then
        perform public._registrar('cobro', 'Cobró cuenta corriente',
          (select c.nombre from public.clientes c where c.id = new.cliente_id) || ' · ' || initcap(replace(new.metodo, '_', ' ')), new.monto);
      else
        select v.numero, v.turno into v_numero, v_turno from public.ventas v where v.id = new.venta_id;
        perform public._registrar('cobro', case when new.nota = 'Seña' then 'Cobró una seña' else 'Cobró' end,
          '#' || v_numero || ' · ' || initcap(v_turno) || ' · ' || initcap(replace(new.metodo, '_', ' ')), new.monto);
      end if;
    elsif tg_op = 'DELETE' then
      select v.numero into v_numero from public.ventas v where v.id = old.venta_id;
      perform public._registrar('cobro', 'Anuló un cobro',
        coalesce('#' || v_numero || ' · ', '') || initcap(replace(old.metodo, '_', ' ')), old.monto);
    end if;

  when 'cajas' then
    if tg_op = 'INSERT' then
      perform public._registrar('caja', 'Abrió la caja', 'Arqueo N° ' || new.numero, new.monto_inicial);
    elsif tg_op = 'UPDATE' and new.estado = 'cerrada' and old.estado = 'abierta' then
      perform public._registrar('caja', 'Cerró la caja',
        'Arqueo N° ' || new.numero || ' · contado ' || public._pesos(new.efectivo_contado)
          || ' · diferencia ' || public._pesos(coalesce((new.resumen ->> 'diferencia')::numeric, 0)),
        new.efectivo_contado);
    elsif tg_op = 'DELETE' then
      perform public._registrar('caja', 'Borró un arqueo', 'Arqueo N° ' || old.numero, null);
    end if;

  when 'caja_movimientos' then
    if tg_op = 'INSERT' then
      perform public._registrar('caja', case when new.tipo = 'ingreso' then 'Ingreso de efectivo' else 'Retiro de efectivo' end,
        new.concepto, new.monto);
    elsif tg_op = 'DELETE' then
      perform public._registrar('caja', 'Borró un ingreso o retiro', old.concepto, old.monto);
    end if;

  when 'comidas' then
    if tg_op = 'INSERT' then
      perform public._registrar('catalogo', 'Creó un producto', new.nombre, new.precio);
    elsif tg_op = 'DELETE' then
      perform public._registrar('catalogo', 'Borró un producto', old.nombre, old.precio);
    else
      if new.precio is distinct from old.precio or new.precio_promo is distinct from old.precio_promo
         or new.opciones -> 'variantes' is distinct from old.opciones -> 'variantes' then
        perform public._registrar('catalogo', 'Cambió el precio', new.nombre || ' · ' || public._pesos(old.precio)
          || ' → ' || public._pesos(new.precio)
          || case when new.opciones -> 'variantes' is distinct from old.opciones -> 'variantes' then ' (variantes)' else '' end,
          new.precio);
      end if;
      if new.activo is distinct from old.activo then
        perform public._registrar('catalogo', case when new.activo then 'Marcó que hay' else 'Marcó que no hay' end, new.nombre, null);
      end if;
      if new.nombre is distinct from old.nombre then
        perform public._registrar('catalogo', 'Cambió el nombre', old.nombre || ' → ' || new.nombre, null);
      end if;
    end if;

  when 'clientes' then
    if tg_op = 'INSERT' then
      perform public._registrar('cliente', 'Creó una cuenta corriente', new.nombre, new.limite_credito);
    elsif tg_op = 'UPDATE' then
      if new.limite_credito is distinct from old.limite_credito then
        perform public._registrar('cliente', 'Cambió el límite de crédito', new.nombre, new.limite_credito);
      end if;
      if new.activo is distinct from old.activo then
        perform public._registrar('cliente', case when new.activo then 'Reactivó una cuenta' else 'Dio de baja una cuenta' end, new.nombre, null);
      end if;
    end if;

  when 'gastos' then
    perform public._registrar('gasto',
      case tg_op when 'INSERT' then 'Cargó un gasto' when 'UPDATE' then 'Modificó un gasto' else 'Borró un gasto' end,
      coalesce(new.descripcion, old.descripcion), coalesce(new.monto, old.monto));

  when 'cancha_turnos' then
    v_texto := to_char(coalesce(new.fecha, old.fecha), 'DD/MM') || ' ' || to_char(coalesce(new.desde, old.desde), 'HH24:MI')
               || ' · ' || coalesce(new.cliente_nombre, old.cliente_nombre);
    if tg_op = 'INSERT' then
      perform public._registrar('cancha', 'Reservó un turno', v_texto, new.precio);
    elsif tg_op = 'DELETE' then
      perform public._registrar('cancha', case when old.fijo_id is not null then 'Liberó un turno fijo' else 'Borró un turno' end,
        v_texto, old.precio);
    elsif (new.fecha, new.desde, new.minutos, new.precio, new.cliente_nombre)
          is distinct from (old.fecha, old.desde, old.minutos, old.precio, old.cliente_nombre) then
      perform public._registrar('cancha', 'Modificó un turno', v_texto, new.precio);
    end if;

  when 'cancha_fijos' then
    v_texto := (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[coalesce(new.dia_semana, old.dia_semana) + 1]
               || ' ' || to_char(coalesce(new.desde, old.desde), 'HH24:MI') || ' · ' || coalesce(new.cliente_nombre, old.cliente_nombre);
    perform public._registrar('cancha',
      case tg_op when 'INSERT' then 'Anotó un turno fijo' when 'UPDATE' then 'Modificó un turno fijo' else 'Borró un turno fijo' end,
      v_texto, coalesce(new.precio, old.precio));

  when 'ajustes' then
    perform public._registrar('cancha', 'Cambió el precio de la cancha', 'Por hora', coalesce(new.valor, old.valor));
  else
    null;
  end case;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['ventas', 'pagos', 'cajas', 'caja_movimientos', 'comidas', 'clientes', 'gastos',
                           'cancha_turnos', 'cancha_fijos', 'ajustes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_actividad', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._actividad()',
                   t || '_actividad', t);
  end loop;
end;
$$;

-- Cosas que solo hace el dueño (categorías, horarios, menú del día, borrar
-- arqueos o movimientos de caja…). El argumento es el mensaje para el empleado.
create or replace function public._solo_dueno()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' and not public.es_dueno() then
    raise exception '%', coalesce(tg_argv[0], 'Esto lo puede hacer solo el dueño.');
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('categorias',       'insert or update or delete', 'Las categorías las cambia solo el dueño.'),
    ('horarios',         'insert or update or delete', 'Los horarios los cambia solo el dueño.'),
    ('menu_dia',         'insert or update or delete', 'El menú del día lo arma solo el dueño.'),
    ('comidas',          'insert or delete',           'Los productos los crea y los borra solo el dueño.'),
    ('cajas',            'delete',                     'Solo el dueño puede borrar un arqueo.'),
    ('caja_movimientos', 'update or delete',           'Solo el dueño puede borrar o cambiar un ingreso o retiro.'),
    ('clientes',         'delete',                     'Solo el dueño puede borrar una cuenta corriente.'),
    ('ajustes',          'insert or update or delete', 'El precio de la cancha lo define solo el dueño.')
  ) as x (tabla, eventos, mensaje) loop
    execute format('drop trigger if exists %I on public.%I', r.tabla || '_solo_dueno', r.tabla);
    execute format('create trigger %I before %s on public.%I for each row execute function public._solo_dueno(%L)',
                   r.tabla || '_solo_dueno', r.eventos, r.tabla, r.mensaje);
  end loop;
end;
$$;

-- Columnas que el empleado sí puede cambiar a mano (lo demás, solo el dueño):
-- de una comida, si hay o no hay; de una venta, el estado; de la caja, el
-- conteo y la nota; de un cliente, sus datos pero no el límite ni la baja.
create or replace function public._solo_estas_columnas()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb := to_jsonb(old);
  c       text;
begin
  if current_user <> 'authenticated' or public.es_dueno() then
    return new;
  end if;
  foreach c in array tg_argv loop
    v_nuevo := v_nuevo - c;
    v_viejo := v_viejo - c;
  end loop;
  if v_nuevo is distinct from v_viejo then
    raise exception '%', case tg_table_name
      when 'comidas'  then 'Los productos y los precios los cambia solo el dueño. Vos podés marcar si hay o no hay.'
      when 'cajas'    then 'Solo el dueño puede cambiar el efectivo inicial de la caja.'
      when 'clientes' then 'Solo el dueño puede cambiar el límite de crédito o dar de baja una cuenta.'
      else 'Esto lo puede cambiar solo el dueño.' end;
  end if;
  return new;
end;
$$;

drop trigger if exists comidas_permisos on public.comidas;
create trigger comidas_permisos before update on public.comidas
  for each row execute function public._solo_estas_columnas('activo', 'updated_at');

drop trigger if exists cajas_permisos on public.cajas;
create trigger cajas_permisos before update on public.cajas
  for each row execute function public._solo_estas_columnas('conteo', 'efectivo_contado', 'nota');

drop trigger if exists clientes_permisos on public.clientes;
create trigger clientes_permisos before update on public.clientes
  for each row execute function public._solo_estas_columnas('nombre', 'telefono', 'documento', 'notas');

-- El stock no se escribe a mano (ni el dueño): se mueve con las ventas,
-- cargar_mercaderia y ajustar_stock, así siempre queda en el historial.
create or replace function public._stock_por_funciones()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.stock := null;   -- un producto nuevo arranca sin stock: se carga con mercadería
    elsif new.stock is distinct from old.stock then
      raise exception 'El stock se cambia desde la pestaña Stock: cargar mercadería o ajustar.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists comidas_stock_por_funciones on public.comidas;
create trigger comidas_stock_por_funciones before insert or update on public.comidas
  for each row execute function public._stock_por_funciones();

-- Ventas: el empleado solo cambia el estado; no cancela ni borra una venta
-- que ya tiene plata cobrada (cobrada o señada).
create or replace function public._proteger_venta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.id, old.id);
begin
  if current_user <> 'authenticated' or public.es_dueno() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'estado') is distinct from (to_jsonb(old) - 'estado') then
    raise exception 'De una venta solo podés cambiar el estado.';
  end if;
  if (tg_op = 'DELETE' or new.estado = 'cancelado')
     and exists (select 1 from public.pagos p where p.venta_id = v_id) then
    raise exception 'Esta venta ya tiene un cobro: solo el dueño puede borrarla o cancelarla.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists ventas_proteger on public.ventas;
create trigger ventas_proteger before update or delete on public.ventas
  for each row execute function public._proteger_venta();

-- Cancha: el empleado cobra el precio que fijó el dueño (si lo cargó)
create or replace function public._precio_cancha()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hora numeric;
begin
  if current_user <> 'authenticated' or public.es_dueno() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.precio = old.precio and new.minutos = old.minutos then
    return new;
  end if;
  select a.valor into v_hora from public.ajustes a where a.clave = 'cancha_precio_hora';
  if v_hora is not null and new.precio <> round(v_hora * new.minutos / 60.0, 2) then
    raise exception 'El precio de la cancha lo define el dueño: % por hora (este turno: %).',
      public._pesos(v_hora), public._pesos(round(v_hora * new.minutos / 60.0, 2));
  end if;
  return new;
end;
$$;

drop trigger if exists cancha_turnos_precio on public.cancha_turnos;
create trigger cancha_turnos_precio before insert or update on public.cancha_turnos
  for each row execute function public._precio_cancha();

drop trigger if exists cancha_fijos_precio on public.cancha_fijos;
create trigger cancha_fijos_precio before insert or update on public.cancha_fijos
  for each row execute function public._precio_cancha();

-- Turnos fijos: dos fijos no se pisan el mismo día de la semana
create or replace function public._controlar_fijo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f      public.cancha_fijos%rowtype;
  v_ini  int := extract(hour from new.desde)::int * 60 + extract(minute from new.desde)::int;
begin
  if not new.activo then
    return new;
  end if;
  select * into f
    from public.cancha_fijos x
   where x.id <> new.id and x.activo and x.dia_semana = new.dia_semana
     and (extract(hour from x.desde)::int * 60 + extract(minute from x.desde)::int) < v_ini + new.minutos
     and v_ini < (extract(hour from x.desde)::int * 60 + extract(minute from x.desde)::int) + x.minutos
   limit 1;
  if found then
    raise exception 'Ese día y horario ya es el turno fijo de %.', f.cliente_nombre;
  end if;
  return new;
end;
$$;

drop trigger if exists cancha_fijos_controlar on public.cancha_fijos;
create trigger cancha_fijos_controlar before insert or update on public.cancha_fijos
  for each row execute function public._controlar_fijo();

-- Si cambia un turno fijo, se corrigen los días que vienen y todavía no se
-- pagaron. Si cambia de día o se da de baja, esos días se liberan.
create or replace function public._fijo_cambiado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_id  uuid := coalesce(new.id, old.id);
begin
  perform set_config('palmeras.automatico', 'si', true);
  if tg_op = 'DELETE' or not new.activo or new.dia_semana <> old.dia_semana then
    delete from public.cancha_turnos t where t.fijo_id = v_id and t.fecha >= v_hoy and t.venta_id is null;
    delete from public.cancha_fijos_libres l where l.fijo_id = v_id and l.fecha >= v_hoy;
  else
    update public.cancha_turnos t
       set desde = new.desde, minutos = new.minutos, cliente_nombre = new.cliente_nombre,
           cliente_telefono = new.cliente_telefono, precio = new.precio, nota = new.nota
     where t.fijo_id = v_id and t.fecha >= v_hoy and t.venta_id is null;
  end if;
  perform set_config('palmeras.automatico', '', true);
  return coalesce(new, old);
end;
$$;

drop trigger if exists cancha_fijos_cambiado on public.cancha_fijos;
create trigger cancha_fijos_cambiado after update on public.cancha_fijos
  for each row execute function public._fijo_cambiado();

drop trigger if exists cancha_fijos_borrado on public.cancha_fijos;
create trigger cancha_fijos_borrado before delete on public.cancha_fijos
  for each row execute function public._fijo_cambiado();

-- ---------------------------------------------------------------------
-- 3. es_admin() y horario
-- security definer: lee "admins" sin pasar por RLS (evita recursión).
-- ---------------------------------------------------------------------

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Solo el dueño ve los gastos y las finanzas
create or replace function public.es_dueno()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and rol = 'dueno');
$$;

-- Rol de quien entra al panel: 'dueno', 'empleado' o null (sin acceso)
create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.admins where user_id = auth.uid();
$$;

-- ¿La carta (turno noche) está abierta en este momento?
create or replace function public.local_abierto(p_momento timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local timestamp := p_momento at time zone 'America/Argentina/Buenos_Aires';
  v_dia   int  := extract(dow from v_local)::int;
  v_hora  time := v_local::time;
  h       public.horarios%rowtype;
begin
  -- Sin horarios cargados: siempre abierto
  if not exists (select 1 from public.horarios where turno = 'noche') then
    return true;
  end if;

  -- Turno de hoy
  select * into h from public.horarios where turno = 'noche' and dia = v_dia;
  if found and h.abierto then
    if h.desde = h.hasta then
      return true;                                         -- todo el día
    elsif h.desde < h.hasta and v_hora >= h.desde and v_hora < h.hasta then
      return true;
    elsif h.desde > h.hasta and v_hora >= h.desde then
      return true;                                         -- turno que sigue después de las 00
    end if;
  end if;

  -- Lo que queda del turno de ayer, si cruzó la medianoche
  select * into h from public.horarios where turno = 'noche' and dia = (v_dia + 6) % 7;
  if found and h.abierto and h.desde > h.hasta and v_hora < h.hasta then
    return true;
  end if;

  return false;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Funciones internas (no se pueden llamar desde el cliente)
-- ---------------------------------------------------------------------

-- Funciones de versiones anteriores (manejaban stock o cambiaron de firma)
drop function if exists public.confirmar_venta(uuid);
drop function if exists public.cancelar_venta(uuid);
drop function if exists public._descontar_stock(uuid);
drop function if exists public._devolver_stock(uuid);
drop function if exists public._crear_venta(jsonb, text, text, text, boolean);
drop function if exists public._crear_venta(jsonb, text, text, text, boolean, text);
drop function if exists public.crear_pedido(jsonb, text, text);
drop function if exists public.registrar_venta_manual(jsonb, text, text);

-- Agrega ítems a una venta tomando los precios de la base.
-- p_items: [{ "comida_id": "<uuid>", "cantidad": 2,
--             "variante": "Doble", "quitar": ["Cebolla"], "agregar": ["Huevo"],
--             "aclaracion": "bien cocida" }, ...]
-- Solo comida_id y cantidad son obligatorios. Cada combinación distinta
-- (por ejemplo una doble sin cebolla) es una línea aparte.
-- p_solo_activas = pedido web: solo comidas activas de la carta (turno noche).
create or replace function public._agregar_items(
  p_venta_id uuid,
  p_items jsonb,
  p_solo_activas boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  c          public.comidas%rowtype;
  v_precio   numeric(12,2);
  v_var      jsonb;
  v_extra    jsonb;
  v_texto    text;
  v_quitar   text[];
  v_agregar  text[];
  v_partes   text[];
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El formato del pedido no es válido.';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'El pedido tiene demasiados productos (máximo 30 distintos).';
  end if;

  begin
    for r in
      select x.comida_id, x.cantidad,
             nullif(btrim(x.variante), '') as variante,
             coalesce(x.quitar, '[]'::jsonb) as quitar,
             coalesce(x.agregar, '[]'::jsonb) as agregar,
             nullif(btrim(x.aclaracion), '') as aclaracion
      from jsonb_to_recordset(p_items)
           as x (comida_id uuid, cantidad int, variante text, quitar jsonb, agregar jsonb, aclaracion text)
    loop
      if r.comida_id is null or r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Hay un producto con datos inválidos en el pedido.';
      end if;
      if r.cantidad > 50 then
        raise exception 'Se pueden pedir hasta 50 unidades de cada producto.';
      end if;
      if jsonb_typeof(r.quitar) <> 'array' or jsonb_typeof(r.agregar) <> 'array'
         or jsonb_array_length(r.quitar) > 20 or jsonb_array_length(r.agregar) > 10 then
        raise exception 'Las opciones del pedido no son válidas.';
      end if;
      if r.aclaracion is not null and length(r.aclaracion) > 80 then
        raise exception 'La aclaración es demasiado larga (máximo 80 caracteres).';
      end if;

      select * into c from public.comidas where id = r.comida_id;
      if not found or (p_solo_activas and (not c.activo or c.turno <> 'noche')) then
        raise exception 'Un producto del pedido ya no está disponible. Actualizá la página e intentá de nuevo.';
      end if;

      v_precio  := coalesce(c.precio_promo, c.precio);   -- el precio sale de la base, nunca del cliente
      v_partes  := '{}';
      v_quitar  := '{}';
      v_agregar := '{}';

      -- Variante: si el producto tiene, su precio reemplaza al base (sin elegir, vale la primera)
      if jsonb_typeof(c.opciones -> 'variantes') = 'array' and jsonb_array_length(c.opciones -> 'variantes') > 0 then
        if r.variante is null then
          v_var := (c.opciones -> 'variantes') -> 0;
        else
          v_var := null;
          select e into v_var
            from jsonb_array_elements(c.opciones -> 'variantes') e
           where e ->> 'nombre' = r.variante
           limit 1;
          if v_var is null then
            raise exception 'La opción "%" ya no está disponible para "%". Actualizá la página.', r.variante, c.nombre;
          end if;
        end if;
        v_precio := (v_var ->> 'precio')::numeric;
        v_partes := v_partes || (v_var ->> 'nombre');
      elsif r.variante is not null then
        raise exception 'La opción "%" ya no está disponible para "%". Actualizá la página.', r.variante, c.nombre;
      end if;

      -- Ingredientes que se sacan (sin costo)
      for v_texto in select distinct jsonb_array_elements_text(r.quitar) loop
        if not (coalesce(c.opciones -> 'quitar', '[]'::jsonb) ? v_texto) then
          raise exception '"%" no se puede sacar de "%". Actualizá la página.', v_texto, c.nombre;
        end if;
        v_quitar := v_quitar || v_texto;
      end loop;
      if array_length(v_quitar, 1) > 0 then
        v_partes := v_partes || ('sin ' || array_to_string(v_quitar, ', '));
      end if;

      -- Extras (suman al precio)
      for v_texto in select distinct jsonb_array_elements_text(r.agregar) loop
        v_extra := null;
        select e into v_extra
          from jsonb_array_elements(coalesce(c.opciones -> 'agregar', '[]'::jsonb)) e
         where e ->> 'nombre' = v_texto
         limit 1;
        if v_extra is null then
          raise exception '"%" no se puede agregar a "%". Actualizá la página.', v_texto, c.nombre;
        end if;
        v_precio  := v_precio + (v_extra ->> 'precio')::numeric;
        -- precio 0 = el local confirma el precio por WhatsApp
        v_agregar := v_agregar || ((v_extra ->> 'nombre')
                     || case when (v_extra ->> 'precio')::numeric = 0 then ' (precio a confirmar)' else '' end);
      end loop;
      if array_length(v_agregar, 1) > 0 then
        v_partes := v_partes || ('extra ' || array_to_string(v_agregar, ', '));
      end if;

      if r.aclaracion is not null then
        v_partes := v_partes || ('"' || r.aclaracion || '"');
      end if;

      insert into public.venta_items (venta_id, comida_id, nombre, detalle, precio_unitario, cantidad, subtotal)
      values (p_venta_id, c.id, c.nombre, nullif(array_to_string(v_partes, ' · '), ''),
              v_precio, r.cantidad, v_precio * r.cantidad);
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pedido no es válido.';
  end;
end;
$$;

-- Controla los límites del pedido y recalcula el total con sus ítems.
create or replace function public._recalcular_venta(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lineas   int;
  v_unidades int;
  v_total    numeric(12,2);
begin
  select count(*), coalesce(sum(cantidad), 0), coalesce(sum(subtotal), 0)
    into v_lineas, v_unidades, v_total
    from public.venta_items
   where venta_id = p_venta_id;

  if v_lineas = 0 then
    raise exception 'El pedido está vacío.';
  end if;
  if v_lineas > 30 then
    raise exception 'El pedido tiene demasiados productos (máximo 30 distintos).';
  end if;
  if v_unidades > 100 then
    raise exception 'El pedido supera el máximo de 100 unidades.';
  end if;
  if exists (select 1 from public.venta_items
              where venta_id = p_venta_id
              group by comida_id
             having sum(cantidad) > 50) then
    raise exception 'Se pueden pedir hasta 50 unidades de cada producto.';
  end if;

  update public.ventas set total = v_total where id = p_venta_id;
end;
$$;

-- "3884131570" / "+54 9 388 413-1570" → "5493884131570" (o null si no hay número)
create or replace function public._normalizar_telefono(p_telefono text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
begin
  if v = '' then
    return null;
  end if;
  v := regexp_replace(v, '^00', '');
  if v !~ '^54' then
    v := '549' || regexp_replace(v, '^0', '');
  end if;
  if length(v) < 10 or length(v) > 15 then
    raise exception 'El número de WhatsApp no es válido. Escribilo con código de área, por ejemplo 388 4131570.';
  end if;
  return v;
end;
$$;

-- Crea una venta con sus ítems y devuelve su id.
create or replace function public._crear_venta(
  p_items jsonb,
  p_cliente_nombre text,
  p_nota text,
  p_origen text,
  p_solo_activas boolean,
  p_estado text,
  p_turno text,
  p_telefono text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta_id uuid;
  v_cliente  text := nullif(btrim(coalesce(p_cliente_nombre, '')), '');
  v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido está vacío.';
  end if;
  if v_cliente is not null and length(v_cliente) > 80 then
    raise exception 'El nombre es demasiado largo (máximo 80 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es demasiado larga (máximo 300 caracteres).';
  end if;
  if p_turno is null or p_turno not in ('noche', 'mediodia') then
    raise exception 'Elegí el turno de la venta (noche o mediodía).';
  end if;

  insert into public.ventas (estado, total, cliente_nombre, cliente_telefono, nota, origen, turno)
  values (p_estado, 0, v_cliente, public._normalizar_telefono(p_telefono), v_nota, p_origen, p_turno)
  returning id into v_venta_id;

  perform public._agregar_items(v_venta_id, p_items, p_solo_activas);
  perform public._recalcular_venta(v_venta_id);
  return v_venta_id;
end;
$$;

create or replace function public._caja_abierta()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.cajas where estado = 'abierta' limit 1;
$$;

-- Saldo de la cuenta corriente: lo que se cargó a cuenta menos lo que pagó
create or replace function public._saldo_cliente(p_cliente_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when metodo = 'cuenta_corriente' then monto
                           when concepto = 'cobro_cuenta' then -monto
                           else 0 end), 0)
    from public.pagos
   where cliente_id = p_cliente_id;
$$;

create or replace function public._pesos(p numeric)
returns text
language sql
immutable
as $$
  select coalesce('$ ' || trim(to_char(p, '999999999990.00')), 'sin precio');
$$;

-- Registra el cobro de una venta y la deja cerrada.
-- p_pagos: [{ "metodo": "efectivo", "monto": 5000 },
--           { "metodo": "cuenta_corriente", "monto": null, "cliente_id": "<uuid>" }]
-- Un pago con monto null se lleva lo que falta para completar el total.
-- Efectivo y transferencia necesitan la caja abierta (quedan en ese arqueo).
create or replace function public._cobrar(p_venta_id uuid, p_pagos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v          public.ventas%rowtype;
  r          record;
  v_suma     numeric(12,2) := 0;
  v_sin_monto int := 0;
  v_cc_cli   uuid;
  v_cc_monto numeric(12,2) := 0;
  v_caja     uuid;
  v_con_caja boolean := false;
  v_cli      public.clientes%rowtype;
  v_lista    jsonb := '[]'::jsonb;
  v_monto    numeric(12,2);
  v_resta    numeric(12,2);   -- el total menos lo que ya se pagó antes (seña)
begin
  select * into v from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v.estado = 'cerrado' then
    raise exception 'Esta cuenta ya está cobrada.';
  end if;
  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indicá cómo se pagó.';
  end if;
  if jsonb_array_length(p_pagos) > 3 then
    raise exception 'Se pueden combinar hasta 3 formas de pago.';
  end if;
  v_resta := v.total - (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = p_venta_id);

  begin
    for r in select x.metodo, x.monto, x.cliente_id
               from jsonb_to_recordset(p_pagos) as x (metodo text, monto numeric, cliente_id uuid) loop
      if r.metodo is null or r.metodo not in ('efectivo', 'transferencia', 'cuenta_corriente') then
        raise exception 'Forma de pago no válida.';
      end if;
      if r.monto is null then
        v_sin_monto := v_sin_monto + 1;
      elsif r.monto <= 0 then
        raise exception 'Cada pago tiene que tener un monto mayor a 0.';
      else
        v_suma := v_suma + round(r.monto, 2);
      end if;
      if r.metodo = 'cuenta_corriente' then
        if r.cliente_id is null then
          raise exception 'Elegí el cliente de la cuenta corriente.';
        end if;
        if v_cc_cli is not null and v_cc_cli <> r.cliente_id then
          raise exception 'Solo se puede cargar a una cuenta corriente por venta.';
        end if;
        v_cc_cli := r.cliente_id;
      else
        v_con_caja := true;
      end if;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pago no es válido.';
  end;

  if v_sin_monto > 1 then
    raise exception 'Solo una forma de pago puede quedar sin monto (se lleva el resto).';
  end if;
  if v_sin_monto = 1 and v_suma >= v_resta then
    raise exception 'Los montos ya cubren el total: sacá la forma de pago que sobra.';
  end if;
  if v_sin_monto = 0 and v_suma <> v_resta then
    raise exception 'Los pagos suman % y lo que hay que cobrar es %.', public._pesos(v_suma), public._pesos(v_resta);
  end if;

  -- Arma la lista final (completa el pago sin monto)
  for r in select x.metodo, x.monto, x.cliente_id
             from jsonb_to_recordset(p_pagos) as x (metodo text, monto numeric, cliente_id uuid) loop
    v_monto := coalesce(round(r.monto, 2), v_resta - v_suma);
    if r.metodo = 'cuenta_corriente' then
      v_cc_monto := v_cc_monto + v_monto;
    end if;
    v_lista := v_lista || jsonb_build_object('metodo', r.metodo, 'monto', v_monto,
                                             'cliente_id', case when r.metodo = 'cuenta_corriente' then r.cliente_id end);
  end loop;

  if v_cc_cli is not null then
    select * into v_cli from public.clientes where id = v_cc_cli;
    if not found or not v_cli.activo then
      raise exception 'El cliente de la cuenta corriente no existe o está dado de baja.';
    end if;
    if v_cli.limite_credito is not null
       and public._saldo_cliente(v_cc_cli) + v_cc_monto > v_cli.limite_credito then
      raise exception 'Con esta venta, la cuenta de % supera su límite de crédito (%).',
        v_cli.nombre, public._pesos(v_cli.limite_credito);
    end if;
  end if;

  v_caja := public._caja_abierta();
  if v_con_caja and v_caja is null then
    raise exception 'La caja está cerrada. Abrí la caja para registrar cobros en efectivo o por transferencia.';
  end if;

  insert into public.pagos (venta_id, cliente_id, caja_id, metodo, monto, concepto)
  select p_venta_id, x.cliente_id, v_caja, x.metodo, x.monto, 'venta'
    from jsonb_to_recordset(v_lista) as x (metodo text, monto numeric, cliente_id uuid);

  update public.ventas
     set estado = 'cerrado',
         cerrada_at = now(),
         cliente_nombre = coalesce(cliente_nombre, v_cli.nombre)
   where id = p_venta_id;
end;
$$;

-- Totales de un arqueo (en vivo mientras está abierto; al cerrar se guarda una copia)
create or replace function public._resumen_caja(p_caja_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c   public.cajas%rowtype;
  res jsonb;
begin
  select * into c from public.cajas where id = p_caja_id;
  if not found then
    raise exception 'El arqueo no existe.';
  end if;

  with p as (
    select * from public.pagos where caja_id = p_caja_id
  ), t as (
    select
      coalesce(sum(monto) filter (where concepto = 'venta' and metodo = 'efectivo'), 0)          as ventas_efectivo,
      coalesce(sum(monto) filter (where concepto = 'venta' and metodo = 'transferencia'), 0)     as ventas_transferencia,
      coalesce(sum(monto) filter (where concepto = 'venta' and metodo = 'cuenta_corriente'), 0)  as ventas_cuenta_corriente,
      coalesce(sum(monto) filter (where concepto = 'cobro_cuenta' and metodo = 'efectivo'), 0)      as cobros_cuenta_efectivo,
      coalesce(sum(monto) filter (where concepto = 'cobro_cuenta' and metodo = 'transferencia'), 0) as cobros_cuenta_transferencia,
      count(distinct venta_id) as cantidad_ventas
    from p
  ), m as (
    select
      coalesce(sum(monto) filter (where tipo = 'ingreso'), 0) as ingresos,
      coalesce(sum(monto) filter (where tipo = 'retiro'), 0)  as retiros
    from public.caja_movimientos where caja_id = p_caja_id
  ), g as (
    select coalesce(sum(monto), 0) as gastos_efectivo
      from public.gastos where caja_id = p_caja_id
  ), x as (
    select coalesce(sum(v.total) filter (where v.turno = 'noche'), 0)    as vendido_noche,
           coalesce(sum(v.total) filter (where v.turno = 'mediodia'), 0) as vendido_mediodia,
           coalesce(sum(v.total) filter (where v.turno = 'cancha'), 0)   as vendido_cancha
      from public.ventas v
     where v.id in (select venta_id from p where venta_id is not null)
  )
  select jsonb_build_object(
    'monto_inicial', c.monto_inicial,
    'ventas_efectivo', t.ventas_efectivo,
    'ventas_transferencia', t.ventas_transferencia,
    'ventas_cuenta_corriente', t.ventas_cuenta_corriente,
    'cobros_cuenta_efectivo', t.cobros_cuenta_efectivo,
    'cobros_cuenta_transferencia', t.cobros_cuenta_transferencia,
    'ingresos', m.ingresos,
    'retiros', m.retiros,
    'gastos_efectivo', g.gastos_efectivo,
    'cantidad_ventas', t.cantidad_ventas,
    'vendido_noche', x.vendido_noche,
    'vendido_mediodia', x.vendido_mediodia,
    'vendido_cancha', x.vendido_cancha,
    'total_vendido', t.ventas_efectivo + t.ventas_transferencia + t.ventas_cuenta_corriente,
    'total_transferencias', t.ventas_transferencia + t.cobros_cuenta_transferencia,
    'efectivo_esperado', c.monto_inicial + t.ventas_efectivo + t.cobros_cuenta_efectivo
                         + m.ingresos - m.retiros - g.gastos_efectivo
  ) into res
  from t, m, g, x;

  return res;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Funciones RPC (las que llama el frontend)
-- El cambio de estado y el borrado de pedidos los hace el panel directo
-- sobre la tabla "ventas" (las políticas RLS solo se lo permiten al admin).
-- ---------------------------------------------------------------------

-- La llama el catálogo (anónimo) justo antes de abrir WhatsApp.
-- Devuelve { numero, total, items: [{ nombre, detalle, cantidad, precio_unitario, subtotal }] }
create or replace function public.crear_pedido(
  items jsonb,
  cliente_nombre text default null,
  nota text default null,
  cliente_telefono text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.local_abierto() then
    raise exception 'Ahora estamos cerrados. Mirá el horario en la carta y hacé tu pedido cuando abramos.';
  end if;

  -- Freno simple contra abuso: como mucho 20 pedidos web por minuto en total.
  if (select count(*) from public.ventas
       where origen = 'web' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Estamos recibiendo muchos pedidos en este momento. Probá de nuevo en un minuto.';
  end if;

  v_id := public._crear_venta(crear_pedido.items, crear_pedido.cliente_nombre, crear_pedido.nota,
                              'web', true, 'pendiente', 'noche', crear_pedido.cliente_telefono);
  perform public._registrar_venta(v_id);

  return (
    select jsonb_build_object(
      'numero', v.numero,
      'total',  v.total,
      'items',  coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nombre', vi.nombre,
                 'detalle', vi.detalle,
                 'cantidad', vi.cantidad,
                 'precio_unitario', vi.precio_unitario,
                 'subtotal', vi.subtotal) order by vi.nombre, vi.detalle nulls first)
        from public.venta_items vi where vi.venta_id = v.id), '[]'::jsonb)
    )
    from public.ventas v where v.id = v_id
  );
end;
$$;

-- Solo admin: venta en el local (caja), de la noche o del mediodía.
--   pagos = null  → queda como cuenta abierta (mesa) y se cobra después
--   pagos = [...] → se cobra en el momento (mismo formato que cobrar_venta)
-- Permite vender comidas inactivas (ocultas en el catálogo).
create or replace function public.registrar_venta_local(
  items jsonb,
  turno text,
  cliente_nombre text default null,
  nota text default null,
  pagos jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  v_id := public._crear_venta(registrar_venta_local.items, registrar_venta_local.cliente_nombre,
                              registrar_venta_local.nota, 'manual', false, 'pendiente',
                              registrar_venta_local.turno, null);
  perform public._registrar_venta(v_id);

  if registrar_venta_local.pagos is not null and jsonb_typeof(registrar_venta_local.pagos) = 'array'
     and jsonb_array_length(registrar_venta_local.pagos) > 0 then
    perform public._cobrar(v_id, registrar_venta_local.pagos);
  end if;

  return (select jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total, 'estado', v.estado)
          from public.ventas v where v.id = v_id);
end;
$$;

-- Solo admin: cobra una venta (cierra la cuenta).
create or replace function public.cobrar_venta(venta_id uuid, pagos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  perform public._cobrar(cobrar_venta.venta_id, cobrar_venta.pagos);
  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = cobrar_venta.venta_id);
end;
$$;

-- Solo admin: anula el cobro de una venta (vuelve a "entregado"). No se puede
-- si el cobro ya quedó en un arqueo cerrado.
create or replace function public.anular_cobro(venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede anular un cobro.';
  end if;
  if not exists (select 1 from public.ventas v where v.id = anular_cobro.venta_id and v.estado = 'cerrado') then
    raise exception 'Esta venta no está cobrada.';
  end if;
  delete from public.pagos p where p.venta_id = anular_cobro.venta_id;
  update public.ventas v set estado = 'entregado', cerrada_at = null where v.id = anular_cobro.venta_id;
end;
$$;

-- Solo admin: edita un pedido que todavía no se cobró.
--   items:  líneas que se conservan, con su cantidad: [{ "id": "<venta_item>", "cantidad": 2 }]
--           (las que no vienen se borran; mantienen el precio con el que se pidieron)
--   nuevos: líneas para sumar, mismo formato que crear_pedido (precio actual de la base)
create or replace function public.editar_venta(
  venta_id uuid,
  items jsonb,
  nuevos jsonb default '[]'::jsonb,
  cliente_nombre text default null,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado  text;
  v_items   jsonb := coalesce(editar_venta.items, '[]'::jsonb);
  v_nuevos  jsonb := coalesce(editar_venta.nuevos, '[]'::jsonb);
  v_cliente text := nullif(btrim(coalesce(editar_venta.cliente_nombre, '')), '');
  v_nota    text := nullif(btrim(coalesce(editar_venta.nota, '')), '');
  r         record;
  v_antes   public.ventas%rowtype;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select * into v_antes from public.ventas v where v.id = editar_venta.venta_id for update;
  v_estado := v_antes.estado;
  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v_estado = 'cerrado' then
    raise exception 'Esta venta ya está cobrada. Para modificarla, primero anulá el cobro.';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_nuevos) <> 'array' then
    raise exception 'El formato del pedido no es válido.';
  end if;
  if v_cliente is not null and length(v_cliente) > 80 then
    raise exception 'El nombre es demasiado largo (máximo 80 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es demasiado larga (máximo 300 caracteres).';
  end if;

  begin
    -- Borra las líneas que ya no están
    delete from public.venta_items vi
     where vi.venta_id = editar_venta.venta_id
       and not exists (select 1 from jsonb_array_elements(v_items) e
                        where (e ->> 'id')::uuid = vi.id);

    -- Actualiza cantidades (el precio unitario queda como estaba)
    for r in select x.id, x.cantidad from jsonb_to_recordset(v_items) as x (id uuid, cantidad int) loop
      if r.id is null or r.cantidad is null or r.cantidad <= 0 or r.cantidad > 50 then
        raise exception 'Hay un producto con una cantidad inválida.';
      end if;
      update public.venta_items vi
         set cantidad = r.cantidad,
             subtotal = vi.precio_unitario * r.cantidad
       where vi.id = r.id and vi.venta_id = editar_venta.venta_id;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pedido no es válido.';
  end;

  if jsonb_array_length(v_nuevos) > 0 then
    perform public._agregar_items(editar_venta.venta_id, v_nuevos, false);
  end if;

  update public.ventas v
     set cliente_nombre = v_cliente,
         nota = v_nota
   where v.id = editar_venta.venta_id;

  perform public._recalcular_venta(editar_venta.venta_id);
  perform public._registrar('venta', 'Editó un pedido',
    '#' || v_antes.numero || ' · total ' || public._pesos(v_antes.total) || ' → '
      || public._pesos((select v.total from public.ventas v where v.id = editar_venta.venta_id)),
    (select v.total from public.ventas v where v.id = editar_venta.venta_id));

  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = editar_venta.venta_id);
end;
$$;

-- Solo admin: el cliente paga (todo o parte) lo que debe en su cuenta corriente.
create or replace function public.cobrar_cuenta_corriente(
  cliente_id uuid,
  monto numeric,
  metodo text,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric(12,2);
  v_caja  uuid;
  v_nota  text := nullif(btrim(coalesce(cobrar_cuenta_corriente.nota, '')), '');
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  if not exists (select 1 from public.clientes c where c.id = cobrar_cuenta_corriente.cliente_id) then
    raise exception 'El cliente no existe.';
  end if;
  if cobrar_cuenta_corriente.metodo is null or cobrar_cuenta_corriente.metodo not in ('efectivo', 'transferencia') then
    raise exception 'Elegí si paga en efectivo o por transferencia.';
  end if;
  if cobrar_cuenta_corriente.monto is null or cobrar_cuenta_corriente.monto <= 0 then
    raise exception 'El monto tiene que ser mayor a 0.';
  end if;
  if v_nota is not null and length(v_nota) > 200 then
    raise exception 'La nota es demasiado larga (máximo 200 caracteres).';
  end if;

  v_saldo := public._saldo_cliente(cobrar_cuenta_corriente.cliente_id);
  if round(cobrar_cuenta_corriente.monto, 2) > v_saldo then
    raise exception 'El monto (%) es mayor a lo que debe (%).',
      public._pesos(cobrar_cuenta_corriente.monto), public._pesos(v_saldo);
  end if;

  v_caja := public._caja_abierta();
  if v_caja is null then
    raise exception 'La caja está cerrada. Abrí la caja para registrar el cobro.';
  end if;

  insert into public.pagos (cliente_id, caja_id, metodo, monto, concepto, nota)
  values (cobrar_cuenta_corriente.cliente_id, v_caja, cobrar_cuenta_corriente.metodo,
          round(cobrar_cuenta_corriente.monto, 2), 'cobro_cuenta', v_nota);

  return jsonb_build_object('saldo', public._saldo_cliente(cobrar_cuenta_corriente.cliente_id));
end;
$$;

-- Solo admin: abre la caja (empieza un arqueo).
create or replace function public.abrir_caja(
  monto_inicial numeric default 0,
  turno text default null,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_abierta public.cajas%rowtype;
  v_id      uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into v_abierta from public.cajas where estado = 'abierta' limit 1;
  if found then
    raise exception 'Ya hay una caja abierta (arqueo N° %). Cerrala antes de abrir otra.', v_abierta.numero;
  end if;
  if coalesce(abrir_caja.monto_inicial, 0) < 0 then
    raise exception 'El efectivo inicial no puede ser negativo.';
  end if;

  insert into public.cajas (monto_inicial, turno, nota, abierta_por)
  values (round(coalesce(abrir_caja.monto_inicial, 0), 2), abrir_caja.turno,
          nullif(btrim(coalesce(abrir_caja.nota, '')), ''), auth.jwt() ->> 'email')
  returning id into v_id;

  return (select to_jsonb(c) from public.cajas c where c.id = v_id);
end;
$$;

-- Solo admin: totales en vivo de un arqueo.
create or replace function public.resumen_caja(caja_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  return public._resumen_caja(resumen_caja.caja_id);
end;
$$;

-- Solo admin: cierra el arqueo de forma definitiva con el efectivo contado.
create or replace function public.cerrar_caja(
  caja_id uuid,
  efectivo_contado numeric,
  conteo jsonb default '{}'::jsonb,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c     public.cajas%rowtype;
  v_res jsonb;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into c from public.cajas where id = cerrar_caja.caja_id for update;
  if not found then
    raise exception 'El arqueo no existe.';
  end if;
  if c.estado = 'cerrada' then
    raise exception 'Este arqueo ya está cerrado.';
  end if;
  if cerrar_caja.efectivo_contado is null or cerrar_caja.efectivo_contado < 0 then
    raise exception 'Ingresá el efectivo que contaste en la caja.';
  end if;

  v_res := public._resumen_caja(c.id);
  v_res := v_res || jsonb_build_object(
    'efectivo_contado', round(cerrar_caja.efectivo_contado, 2),
    'diferencia', round(cerrar_caja.efectivo_contado, 2) - (v_res ->> 'efectivo_esperado')::numeric);

  update public.cajas
     set estado = 'cerrada',
         cerrada_at = now(),
         cerrada_por = auth.jwt() ->> 'email',
         efectivo_contado = round(cerrar_caja.efectivo_contado, 2),
         conteo = coalesce(cerrar_caja.conteo, '{}'::jsonb),
         resumen = v_res,
         nota = coalesce(nullif(btrim(coalesce(cerrar_caja.nota, '')), ''), c.nota)
   where id = c.id;

  return (select to_jsonb(x) from public.cajas x where x.id = c.id);
end;
$$;

-- Solo admin: suma a la caja abierta los cobros que quedaron sin arqueo
-- (por ejemplo, porque se borró el arqueo en el que estaban).
create or replace function public.asignar_cobros_sin_caja()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja uuid;
  v_n    int;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  v_caja := public._caja_abierta();
  if v_caja is null then
    raise exception 'No hay una caja abierta.';
  end if;
  update public.pagos set caja_id = v_caja where caja_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Solo admin: cobra un turno de la cancha. Arma la venta (turno 'cancha', una
-- línea "Alquiler de cancha") y la cobra con las mismas reglas que cobrar_venta.
-- Todo o nada: si el cobro falla (por ejemplo, caja cerrada), no queda la venta.
create or replace function public.cobrar_turno_cancha(turno_id uuid, pagos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.cancha_turnos%rowtype;
  v_venta uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into t from public.cancha_turnos c where c.id = cobrar_turno_cancha.turno_id for update;
  if not found then
    raise exception 'El turno no existe.';
  end if;

  v_venta := public._venta_de_turno(t.id);
  perform public._cobrar(v_venta, cobrar_turno_cancha.pagos);

  return (select jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = v_venta);
end;
$$;

-- Solo admin: anula el cobro de un turno de la cancha (borra su venta y el
-- cobro sale de la caja). No se puede si el cobro ya está en un arqueo cerrado.
create or replace function public.anular_cobro_cancha(turno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta uuid;
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede anular un cobro.';
  end if;
  select c.venta_id into v_venta from public.cancha_turnos c where c.id = anular_cobro_cancha.turno_id for update;
  if v_venta is null then
    raise exception 'Este turno no está cobrado.';
  end if;
  delete from public.ventas v where v.id = v_venta;   -- el turno queda sin cobrar (on delete set null)
end;
$$;

-- La venta de un turno de cancha (la crea la primera vez que se paga algo)
create or replace function public._venta_de_turno(p_turno_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.cancha_turnos%rowtype;
  v_venta uuid;
begin
  select * into t from public.cancha_turnos c where c.id = p_turno_id for update;
  if t.venta_id is not null then
    return t.venta_id;
  end if;

  insert into public.ventas (estado, total, cliente_nombre, nota, origen, turno)
  values ('entregado', t.precio, t.cliente_nombre, t.nota, 'manual', 'cancha')
  returning id into v_venta;

  insert into public.venta_items (venta_id, comida_id, nombre, detalle, precio_unitario, cantidad, subtotal)
  values (v_venta, null, case when t.fijo_id is null then 'Alquiler de cancha' else 'Alquiler de cancha (turno fijo)' end,
          to_char(t.fecha, 'DD/MM') || ' · ' || to_char(t.desde, 'HH24:MI') || ' a '
            || to_char(t.desde + make_interval(mins => t.minutos), 'HH24:MI'),
          t.precio, 1, t.precio);

  update public.cancha_turnos c set venta_id = v_venta where c.id = t.id;
  return v_venta;
end;
$$;

-- Admin: seña de un turno (parte del precio, en efectivo o transferencia).
-- Entra en la caja abierta; al cobrar el turno se cobra solo lo que falta.
create or replace function public.senar_turno_cancha(turno_id uuid, monto numeric, metodo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t        public.cancha_turnos%rowtype;
  v_venta  uuid;
  v_pagado numeric(12,2);
  v_caja   uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select * into t from public.cancha_turnos c where c.id = senar_turno_cancha.turno_id for update;
  if not found then
    raise exception 'El turno no existe.';
  end if;
  if senar_turno_cancha.metodo is null or senar_turno_cancha.metodo not in ('efectivo', 'transferencia') then
    raise exception 'La seña se cobra en efectivo o por transferencia.';
  end if;
  if senar_turno_cancha.monto is null or senar_turno_cancha.monto <= 0 then
    raise exception 'La seña tiene que ser mayor a 0.';
  end if;
  if exists (select 1 from public.ventas v where v.id = t.venta_id and v.estado = 'cerrado') then
    raise exception 'Este turno ya está cobrado.';
  end if;
  v_pagado := (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = t.venta_id);
  if round(senar_turno_cancha.monto, 2) >= t.precio - v_pagado then
    raise exception 'La seña tiene que ser menor que lo que falta pagar (%). Si paga todo, usá Cobrar.',
      public._pesos(t.precio - v_pagado);
  end if;
  v_caja := public._caja_abierta();
  if v_caja is null then
    raise exception 'La caja está cerrada. Abrí la caja para cobrar la seña.';
  end if;

  v_venta := public._venta_de_turno(t.id);
  insert into public.pagos (venta_id, caja_id, metodo, monto, concepto, nota)
  values (v_venta, v_caja, senar_turno_cancha.metodo, round(senar_turno_cancha.monto, 2), 'venta', 'Seña');

  return jsonb_build_object('pagado', v_pagado + round(senar_turno_cancha.monto, 2),
                            'resta', t.precio - v_pagado - round(senar_turno_cancha.monto, 2));
end;
$$;

-- Solo dueño: el turno señado no vino. Se cierra cobrando solo la seña.
create or replace function public.cerrar_turno_con_sena(turno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t        public.cancha_turnos%rowtype;
  v_pagado numeric(12,2);
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede cerrar un turno con la seña.';
  end if;
  select * into t from public.cancha_turnos c where c.id = cerrar_turno_con_sena.turno_id for update;
  if t.venta_id is null or exists (select 1 from public.ventas v where v.id = t.venta_id and v.estado = 'cerrado') then
    raise exception 'Este turno no tiene una seña pendiente.';
  end if;
  v_pagado := (select coalesce(sum(p.monto), 0) from public.pagos p where p.venta_id = t.venta_id);

  update public.venta_items i
     set precio_unitario = v_pagado, subtotal = v_pagado, detalle = coalesce(i.detalle || ' · ', '') || 'no vino: quedó la seña'
   where i.venta_id = t.venta_id;
  update public.ventas v set total = v_pagado, estado = 'cerrado', cerrada_at = now() where v.id = t.venta_id;
  perform public._registrar('cancha', 'Cerró un turno con la seña (no vino)',
    to_char(t.fecha, 'DD/MM') || ' ' || to_char(t.desde, 'HH24:MI') || ' · ' || t.cliente_nombre, v_pagado);
end;
$$;

-- Admin: anota los turnos fijos de un día (desde hoy en adelante). Si ese
-- día está liberado, o ya hay un turno suelto en ese horario, no lo anota.
create or replace function public.preparar_turnos_fijos(fecha date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  f   public.cancha_fijos%rowtype;
  v_n int := 0;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  if preparar_turnos_fijos.fecha < (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    return 0;
  end if;
  perform set_config('palmeras.automatico', 'si', true);
  for f in select * from public.cancha_fijos x
            where x.activo and x.dia_semana = extract(dow from preparar_turnos_fijos.fecha)
              and not exists (select 1 from public.cancha_turnos t where t.fijo_id = x.id and t.fecha = preparar_turnos_fijos.fecha)
              and not exists (select 1 from public.cancha_fijos_libres l where l.fijo_id = x.id and l.fecha = preparar_turnos_fijos.fecha)
  loop
    begin
      insert into public.cancha_turnos (fecha, desde, minutos, cliente_nombre, cliente_telefono, precio, nota, fijo_id, creado_por)
      values (preparar_turnos_fijos.fecha, f.desde, f.minutos, f.cliente_nombre, f.cliente_telefono, f.precio, f.nota, f.id, f.creado_por);
      v_n := v_n + 1;
    exception when raise_exception or unique_violation then
      null;   -- se pisa con un turno suelto: queda el que ya estaba
    end;
  end loop;
  perform set_config('palmeras.automatico', '', true);
  return v_n;
end;
$$;

-- Admin (dueño o empleado): entra mercadería de kiosco. Suma al stock.
-- items: [{ "comida_id": "<uuid>", "cantidad": 24 }]
create or replace function public.cargar_mercaderia(items jsonb, nota text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_stock int;
  v_nom   text;
  v_nota  text := nullif(btrim(coalesce(cargar_mercaderia.nota, '')), '');
  v_n     int := 0;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'Agregá al menos un producto.';
  end if;
  if v_nota is not null and length(v_nota) > 200 then
    raise exception 'La nota es demasiado larga (máximo 200 caracteres).';
  end if;
  begin
    for r in select x.comida_id, x.cantidad from jsonb_to_recordset(items) as x (comida_id uuid, cantidad int) loop
      if r.comida_id is null or r.cantidad is null or r.cantidad <= 0 or r.cantidad > 100000 then
        raise exception 'Revisá las cantidades: tienen que ser números enteros mayores a 0.';
      end if;
      update public.comidas c
         set stock = coalesce(c.stock, 0) + r.cantidad
       where c.id = r.comida_id
         and exists (select 1 from public.categorias k where k.id = c.categoria_id and k.controla_stock)
      returning c.stock, c.nombre into v_stock, v_nom;
      if not found then
        raise exception 'Solo se carga mercadería de productos de kiosco (bebidas y golosinas).';
      end if;
      insert into public.stock_movimientos (comida_id, nombre, tipo, cantidad, stock_resultante, nota)
      values (r.comida_id, v_nom, 'ingreso', r.cantidad, v_stock, v_nota);
      perform public._registrar('stock', 'Cargó mercadería', v_nom || ' +' || r.cantidad || coalesce(' · ' || v_nota, ''), null);
      v_n := v_n + 1;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato de la mercadería no es válido.';
  end;
  return v_n;
end;
$$;

-- Solo dueño: corrige el stock con lo que hay de verdad (después de contar).
create or replace function public.ajustar_stock(comida_id uuid, stock_real int, nota text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c      public.comidas%rowtype;
  v_nota text := nullif(btrim(coalesce(ajustar_stock.nota, '')), '');
  v_dif  int;
begin
  if not public.es_dueno() then
    raise exception 'Solo el dueño puede ajustar el stock.';
  end if;
  if ajustar_stock.stock_real is null or ajustar_stock.stock_real < 0 or ajustar_stock.stock_real > 1000000 then
    raise exception 'Poné la cantidad que hay (0 o más).';
  end if;
  if v_nota is not null and length(v_nota) > 200 then
    raise exception 'La nota es demasiado larga (máximo 200 caracteres).';
  end if;
  select * into c from public.comidas x where x.id = ajustar_stock.comida_id for update;
  if not found or not exists (select 1 from public.categorias k where k.id = c.categoria_id and k.controla_stock) then
    raise exception 'Solo los productos de kiosco llevan stock.';
  end if;
  v_dif := ajustar_stock.stock_real - coalesce(c.stock, 0);
  update public.comidas x set stock = ajustar_stock.stock_real where x.id = c.id;
  insert into public.stock_movimientos (comida_id, nombre, tipo, cantidad, stock_resultante, nota)
  values (c.id, c.nombre, 'ajuste', v_dif, ajustar_stock.stock_real, v_nota);
  perform public._registrar('stock', 'Ajustó el stock',
    c.nombre || ': ' || coalesce(c.stock::text, 'sin cargar') || ' → ' || ajustar_stock.stock_real || coalesce(' · ' || v_nota, ''), null);
end;
$$;

-- Saldos de las cuentas corrientes (respeta las políticas RLS de quien consulta)
drop view if exists public.clientes_saldos;
create view public.clientes_saldos
with (security_invoker = true)
as
select c.id, c.nombre, c.telefono, c.documento, c.notas, c.limite_credito, c.activo, c.created_at,
       coalesce(s.cargado, 0) as total_cargado,
       coalesce(s.pagado, 0)  as total_pagado,
       coalesce(s.cargado, 0) - coalesce(s.pagado, 0) as saldo,
       s.ultimo_movimiento
  from public.clientes c
  left join (
    select p.cliente_id,
           sum(p.monto) filter (where p.metodo = 'cuenta_corriente') as cargado,
           sum(p.monto) filter (where p.concepto = 'cobro_cuenta')   as pagado,
           max(p.created_at) as ultimo_movimiento
      from public.pagos p
     where p.cliente_id is not null
     group by p.cliente_id
  ) s on s.cliente_id = c.id;

-- Permisos de ejecución: por defecto Postgres deja ejecutar a todos.
revoke execute on function public._agregar_items(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public._recalcular_venta(uuid) from public, anon, authenticated;
revoke execute on function public._crear_venta(jsonb, text, text, text, boolean, text, text, text) from public, anon, authenticated;
revoke execute on function public._normalizar_telefono(text) from public, anon, authenticated;
revoke execute on function public._caja_abierta() from public, anon, authenticated;
revoke execute on function public._saldo_cliente(uuid) from public, anon, authenticated;
revoke execute on function public._cobrar(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._resumen_caja(uuid) from public, anon, authenticated;
revoke execute on function public._turno_de_categoria() from public, anon, authenticated;
revoke execute on function public._eliminar_cancelado() from public, anon, authenticated;
revoke execute on function public._controlar_cierre_venta() from public, anon, authenticated;
revoke execute on function public._bloquear_movimiento_cerrado() from public, anon, authenticated;
revoke execute on function public._ajustar_stock(uuid, int, boolean, uuid) from public, anon, authenticated;
revoke execute on function public._mover_stock() from public, anon, authenticated;
revoke execute on function public._controlar_turno_cancha() from public, anon, authenticated;
revoke execute on function public.cobrar_turno_cancha(uuid, jsonb) from public, anon;
revoke execute on function public.anular_cobro_cancha(uuid) from public, anon;
revoke execute on function public.registrar_venta_local(jsonb, text, text, text, jsonb) from public, anon;
revoke execute on function public.cobrar_venta(uuid, jsonb) from public, anon;
revoke execute on function public.anular_cobro(uuid) from public, anon;
revoke execute on function public.editar_venta(uuid, jsonb, jsonb, text, text) from public, anon;
revoke execute on function public.cobrar_cuenta_corriente(uuid, numeric, text, text) from public, anon;
revoke execute on function public.abrir_caja(numeric, text, text) from public, anon;
revoke execute on function public.resumen_caja(uuid) from public, anon;
revoke execute on function public.cerrar_caja(uuid, numeric, jsonb, text) from public, anon;
revoke execute on function public.asignar_cobros_sin_caja() from public, anon;

grant execute on function public.es_admin() to anon, authenticated;   -- lo usan las políticas RLS
revoke execute on function public.es_dueno() from public, anon;
revoke execute on function public.mi_rol() from public, anon;
grant execute on function public.es_dueno() to authenticated;
grant execute on function public.mi_rol() to authenticated;
grant execute on function public.local_abierto(timestamptz) to anon, authenticated;
grant execute on function public.crear_pedido(jsonb, text, text, text) to anon, authenticated;
grant execute on function public.registrar_venta_local(jsonb, text, text, text, jsonb) to authenticated;
grant execute on function public.cobrar_venta(uuid, jsonb) to authenticated;
grant execute on function public.anular_cobro(uuid) to authenticated;
grant execute on function public.editar_venta(uuid, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.cobrar_cuenta_corriente(uuid, numeric, text, text) to authenticated;
grant execute on function public.abrir_caja(numeric, text, text) to authenticated;
grant execute on function public.resumen_caja(uuid) to authenticated;
grant execute on function public.cerrar_caja(uuid, numeric, jsonb, text) to authenticated;
grant execute on function public.asignar_cobros_sin_caja() to authenticated;
grant execute on function public.cobrar_turno_cancha(uuid, jsonb) to authenticated;
grant execute on function public.anular_cobro_cancha(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Seguridad a nivel de fila (RLS)
-- ---------------------------------------------------------------------

alter table public.categorias       enable row level security;
alter table public.comidas          enable row level security;
alter table public.ventas           enable row level security;
alter table public.venta_items      enable row level security;
alter table public.admins           enable row level security;
alter table public.horarios         enable row level security;
alter table public.clientes         enable row level security;
alter table public.menu_dia         enable row level security;
alter table public.cajas            enable row level security;
alter table public.pagos            enable row level security;
alter table public.caja_movimientos enable row level security;
alter table public.gastos           enable row level security;
alter table public.cancha_turnos    enable row level security;

-- Defensa extra: el rol anónimo no toca ventas, plata ni admins de forma directa.
revoke all on public.ventas, public.venta_items, public.admins, public.clientes, public.menu_dia,
              public.cajas, public.pagos, public.caja_movimientos, public.gastos, public.cancha_turnos from anon;
revoke all on public.clientes_saldos from anon;
revoke insert, update, delete on public.admins from authenticated;
-- Los cobros y los arqueos se crean y se cierran solo con las funciones de arriba
revoke insert, update on public.pagos from authenticated;

-- categorias: el público ve las de la carta (noche); escritura solo admin
drop policy if exists "categorias_lectura_publica" on public.categorias;
create policy "categorias_lectura_publica" on public.categorias
  for select to anon, authenticated using (turno = 'noche' or public.es_admin());

drop policy if exists "categorias_admin_inserta" on public.categorias;
create policy "categorias_admin_inserta" on public.categorias
  for insert to authenticated with check (public.es_admin());

drop policy if exists "categorias_admin_edita" on public.categorias;
create policy "categorias_admin_edita" on public.categorias
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "categorias_admin_borra" on public.categorias;
create policy "categorias_admin_borra" on public.categorias
  for delete to authenticated using (public.es_admin());

-- comidas: el público ve solo las activas de la carta (sin las de kiosco que se
-- quedaron sin stock); el admin ve y edita todo
drop policy if exists "comidas_lectura" on public.comidas;
create policy "comidas_lectura" on public.comidas
  for select to anon, authenticated using (
    (activo and turno = 'noche'
     and not (coalesce(stock, 1) <= 0
              and exists (select 1 from public.categorias k where k.id = categoria_id and k.controla_stock)))
    or public.es_admin());

drop policy if exists "comidas_admin_inserta" on public.comidas;
create policy "comidas_admin_inserta" on public.comidas
  for insert to authenticated with check (public.es_admin());

drop policy if exists "comidas_admin_edita" on public.comidas;
create policy "comidas_admin_edita" on public.comidas
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "comidas_admin_borra" on public.comidas;
create policy "comidas_admin_borra" on public.comidas
  for delete to authenticated using (public.es_admin());

-- horarios: lectura pública (la carta muestra si está abierto), escritura solo admin
drop policy if exists "horarios_lectura_publica" on public.horarios;
create policy "horarios_lectura_publica" on public.horarios
  for select to anon, authenticated using (true);

drop policy if exists "horarios_admin_inserta" on public.horarios;
create policy "horarios_admin_inserta" on public.horarios
  for insert to authenticated with check (public.es_admin());

drop policy if exists "horarios_admin_edita" on public.horarios;
create policy "horarios_admin_edita" on public.horarios
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- Tablas de uso interno: todo solo para el admin
-- (ventas y venta_items: el público entra únicamente por crear_pedido)
do $$
declare
  t text;
begin
  foreach t in array array['ventas', 'venta_items', 'clientes', 'menu_dia', 'cajas', 'pagos', 'caja_movimientos', 'cancha_turnos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())',
                   t || '_admin', t);
  end loop;
end;
$$;

-- gastos: solo el dueño los carga y los ve. El empleado ve únicamente los
-- que se pagaron con la plata de la caja (aparecen en el arqueo).
drop policy if exists "gastos_admin" on public.gastos;
drop policy if exists "gastos_dueno" on public.gastos;
create policy "gastos_dueno" on public.gastos
  for all to authenticated using (public.es_dueno()) with check (public.es_dueno());

drop policy if exists "gastos_empleado_ve_caja" on public.gastos;
create policy "gastos_empleado_ve_caja" on public.gastos
  for select to authenticated using (caja_id is not null and public.es_admin());

-- admins: cada usuario puede ver solamente su propio registro
drop policy if exists "admins_ver_propio" on public.admins;
create policy "admins_ver_propio" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Empleados: permisos, actividad, stock y cancha (29/10/2026)
revoke execute on function public._venta_de_turno(uuid) from public, anon, authenticated;
revoke execute on function public._registrar(text, text, text, numeric) from public, anon, authenticated;
revoke execute on function public._registrar_venta(uuid) from public, anon, authenticated;
revoke execute on function public._actividad() from public, anon, authenticated;
revoke execute on function public._controlar_fijo() from public, anon, authenticated;
revoke execute on function public._fijo_cambiado() from public, anon, authenticated;
revoke execute on function public.senar_turno_cancha(uuid, numeric, text) from public, anon;
revoke execute on function public.cerrar_turno_con_sena(uuid) from public, anon;
revoke execute on function public.preparar_turnos_fijos(date) from public, anon;
revoke execute on function public.cargar_mercaderia(jsonb, text) from public, anon;
revoke execute on function public.ajustar_stock(uuid, int, text) from public, anon;
grant execute on function public.senar_turno_cancha(uuid, numeric, text) to authenticated;
grant execute on function public.cerrar_turno_con_sena(uuid) to authenticated;
grant execute on function public.preparar_turnos_fijos(date) to authenticated;
grant execute on function public.cargar_mercaderia(jsonb, text) to authenticated;
grant execute on function public.ajustar_stock(uuid, int, text) to authenticated;

alter table public.cancha_fijos        enable row level security;
alter table public.cancha_fijos_libres enable row level security;
alter table public.ajustes             enable row level security;
alter table public.stock_movimientos   enable row level security;
alter table public.actividad           enable row level security;

revoke all on public.cancha_fijos, public.cancha_fijos_libres, public.ajustes,
              public.stock_movimientos, public.actividad from anon;
-- Historiales: solo los escribe la base; nadie los edita ni los borra
revoke insert, update, delete on public.stock_movimientos, public.actividad, public.cancha_fijos_libres from authenticated;
-- Los productos de una venta y los cobros se tocan solo con las funciones
revoke insert, update, delete on public.venta_items from authenticated;
revoke delete on public.pagos from authenticated;

drop policy if exists "cancha_fijos_admin" on public.cancha_fijos;
create policy "cancha_fijos_admin" on public.cancha_fijos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "cancha_fijos_libres_admin" on public.cancha_fijos_libres;
create policy "cancha_fijos_libres_admin" on public.cancha_fijos_libres
  for select to authenticated using (public.es_admin());

drop policy if exists "ajustes_lectura" on public.ajustes;
create policy "ajustes_lectura" on public.ajustes
  for select to authenticated using (public.es_admin());
drop policy if exists "ajustes_dueno" on public.ajustes;
create policy "ajustes_dueno" on public.ajustes
  for all to authenticated using (public.es_dueno()) with check (public.es_dueno());

drop policy if exists "stock_movimientos_admin" on public.stock_movimientos;
create policy "stock_movimientos_admin" on public.stock_movimientos
  for select to authenticated using (public.es_admin());

drop policy if exists "actividad_dueno" on public.actividad;
create policy "actividad_dueno" on public.actividad
  for select to authenticated using (public.es_dueno());

-- Tiempo real: el panel se entera al instante de los pedidos nuevos o cambiados.
-- Respeta las políticas de arriba: solo el admin recibe los cambios de "ventas".
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ventas') then
    alter publication supabase_realtime add table public.ventas;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Storage: bucket público "comidas"
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comidas', 'comidas', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Al ser público, las imágenes se ven por su URL pública sin política de
-- lectura. Listar, subir, reemplazar y borrar: solo admin.
drop policy if exists "comidas_storage_admin_lista" on storage.objects;
create policy "comidas_storage_admin_lista" on storage.objects
  for select to authenticated using (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_sube" on storage.objects;
create policy "comidas_storage_admin_sube" on storage.objects
  for insert to authenticated with check (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_reemplaza" on storage.objects;
create policy "comidas_storage_admin_reemplaza" on storage.objects
  for update to authenticated
  using (bucket_id = 'comidas' and public.es_admin())
  with check (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_borra" on storage.objects;
create policy "comidas_storage_admin_borra" on storage.objects
  for delete to authenticated using (bucket_id = 'comidas' and public.es_admin());

-- ---------------------------------------------------------------------
-- 8. Datos iniciales: el menú impreso de Las Palmeras Club
-- Solo inserta lo que falta (no pisa cambios hechos desde el panel).
-- ---------------------------------------------------------------------

insert into public.categorias (nombre, orden, controla_stock) values
  ('Burguers', 1, false),
  ('Combos', 2, false),
  ('Pizzas', 3, false),
  ('Sandwiches', 4, false),
  ('Napolitanas', 5, false),
  ('Papas', 6, false),
  ('Bebidas', 7, true),
  ('Golosinas', 8, true)
on conflict (turno, nombre) do nothing;

-- Hamburguesas: un solo producto por hamburguesa, con variantes (Simple / Doble)
-- y los ingredientes que se pueden sacar. Si la base todavía tiene los
-- productos separados ("X doble" y "X simple"), los une en uno (conserva la
-- foto del doble). Se puede volver a correr sin problema.
do $$
declare
  v_cat   uuid;
  r       record;
  d       public.comidas%rowtype;
  s       public.comidas%rowtype;
  v_vars  jsonb;
  v_opc   jsonb;
  -- Extras de arranque con precio 0: el local confirma el precio por WhatsApp.
  -- El dueño les pone precio (o los saca) desde el panel: Comidas → Editar.
  v_extras jsonb := '[{"nombre":"Carne extra","precio":0},{"nombre":"Cheddar extra","precio":0},{"nombre":"Bacon extra","precio":0},{"nombre":"Huevo","precio":0}]'::jsonb;
begin
  select id into v_cat from public.categorias where nombre = 'Burguers';
  if v_cat is null then
    return;
  end if;

  for r in
    select * from (values
      ('Burguer Cheese', 'Medallones de carne y cheddar.', 7500, 11000, '[]'::jsonb),
      ('Burguer Big Mac', 'Medallones de carne, salsa Big Mac, cheddar, pepinillos, lechuga y cebolla.', 8500, 11000,
        '["Salsa Big Mac","Cheddar","Pepinillos","Lechuga","Cebolla"]'::jsonb),
      ('Burguer Big Bang', 'Medallones de carne, salsa de la casa, cheddar, cebolla y bacon.', 8500, 11000,
        '["Salsa de la casa","Cheddar","Cebolla","Bacon"]'::jsonb),
      ('Burguer Texas', 'Medallones de carne, cheddar, bacon, barbacoa y aros de cebolla.', 8500, 11000,
        '["Cheddar","Bacon","Barbacoa","Aros de cebolla"]'::jsonb),
      ('Burguer Milwaukee', 'Medallones de carne, cheddar, bacon, cebolla crispy, lechuga, tomate y mayonesa.', 8500, 11000,
        '["Cheddar","Bacon","Cebolla crispy","Lechuga","Tomate","Mayonesa"]'::jsonb),
      ('Burguer Cuarto de Libra', 'Medallones de carne, cheddar, extra bacon y cebolla en cubos.', 8500, 11000,
        '["Cheddar","Extra bacon","Cebolla en cubos"]'::jsonb),
      ('Burguer Americana', 'Medallones de carne, cheddar, extra bacon, pepinillos, cebolla morada, ketchup y alioli.', 8500, 11000,
        '["Cheddar","Extra bacon","Pepinillos","Cebolla morada","Ketchup","Alioli"]'::jsonb),
      ('Burguer Alabama', 'Medallones de carne, cheddar, pepinillos, cebolla crispy, lechuga, tomate y mayonesa.', 8500, 11000,
        '["Cheddar","Pepinillos","Cebolla crispy","Lechuga","Tomate","Mayonesa"]'::jsonb),
      ('Burguer CBH', 'Medallones de carne, cheddar, extra bacon, manteca y miel.', 8500, 11000,
        '["Cheddar","Extra bacon","Manteca","Miel"]'::jsonb)
    ) as t (base, descripcion, precio_simple, precio_doble, quitar)
  loop
    v_vars := jsonb_build_array(
      jsonb_build_object('nombre', 'Simple', 'precio', r.precio_simple),
      jsonb_build_object('nombre', 'Doble',  'precio', r.precio_doble));
    v_opc := jsonb_build_object('variantes', v_vars, 'quitar', r.quitar, 'agregar', v_extras);

    if exists (select 1 from public.comidas where nombre = r.base) then
      -- ya está unificada: solo le damos los extras si nunca tuvo la lista
      -- (si el dueño la dejó vacía desde el panel, queda guardada como [] y no se toca)
      update public.comidas
         set opciones = opciones || jsonb_build_object('agregar', v_extras)
       where nombre = r.base and not (opciones ? 'agregar');
      continue;
    end if;

    select * into d from public.comidas where nombre = r.base || ' doble';
    select * into s from public.comidas where nombre = r.base || ' simple';

    if d.id is not null then
      update public.comidas
         set nombre       = r.base,
             descripcion  = r.descripcion,
             precio       = r.precio_simple,
             precio_promo = null,
             opciones     = v_opc,
             imagen_url   = coalesce(d.imagen_url, s.imagen_url),
             imagen_path  = case when d.imagen_url is null then s.imagen_path else d.imagen_path end
       where id = d.id;
      if s.id is not null then
        delete from public.comidas where id = s.id;   -- las ventas viejas conservan el nombre
      end if;
    else
      insert into public.comidas (nombre, descripcion, precio, categoria_id, opciones)
      values (r.base, r.descripcion, r.precio_simple, v_cat, v_opc);
    end if;
  end loop;
end;
$$;

-- Napolitana: un solo producto y el cliente elige para cuántas personas.
-- Si la base todavía tiene las tres separadas, las une en una (conserva sus
-- precios y la primera foto que encuentre). Se puede volver a correr.
do $$
declare
  v_cat  uuid;
  u      public.comidas%rowtype;
  d      public.comidas%rowtype;
  t      public.comidas%rowtype;
  v_base uuid;
  v_vars jsonb;
  v_opc  jsonb;
begin
  if exists (select 1 from public.comidas where nombre = 'Napolitana') then
    return;
  end if;

  select * into u from public.comidas where nombre = 'Napolitana para una persona';
  select * into d from public.comidas where nombre = 'Napolitana para dos personas';
  select * into t from public.comidas where nombre = 'Napolitana para tres personas';

  v_vars := jsonb_build_array(
    jsonb_build_object('nombre', 'Para 1 persona',  'precio', coalesce(u.precio_promo, u.precio, 10000)),
    jsonb_build_object('nombre', 'Para 2 personas', 'precio', coalesce(d.precio_promo, d.precio, 19000)),
    jsonb_build_object('nombre', 'Para 3 personas', 'precio', coalesce(t.precio_promo, t.precio, 28000)));
  v_opc := jsonb_build_object('variantes', v_vars, 'pregunta', '¿Para cuántas personas?');
  v_base := coalesce(u.id, d.id, t.id);

  if v_base is null then
    select id into v_cat from public.categorias where nombre = 'Napolitanas';
    if v_cat is not null then
      insert into public.comidas (nombre, precio, categoria_id, opciones)
      values ('Napolitana', (v_vars -> 0 ->> 'precio')::numeric, v_cat, v_opc);
    end if;
    return;
  end if;

  update public.comidas
     set nombre       = 'Napolitana',
         precio       = (v_vars -> 0 ->> 'precio')::numeric,
         precio_promo = null,
         opciones     = opciones || v_opc,
         imagen_url   = coalesce(u.imagen_url, d.imagen_url, t.imagen_url),
         imagen_path  = case when u.imagen_url is not null then u.imagen_path
                             when d.imagen_url is not null then d.imagen_path
                             else t.imagen_path end
   where id = v_base;

  -- las ventas viejas conservan el nombre de cada napolitana
  delete from public.comidas where id in (u.id, d.id, t.id) and id <> v_base;
end;
$$;

insert into public.comidas (nombre, descripcion, precio, destacado, categoria_id)
select m.nombre, m.descripcion, m.precio, m.destacado, c.id
from (values
  ('Combos', 'Promo Cheese Simples', '3 burguers cheese simples con papas.', 17000, true),
  ('Combos', 'Promo Burritos Burguer', '2 burritos a elección (Texas o Milwaukee) con papas.', 16000, true),
  ('Pizzas', 'Pizza muzzarella clásica', null, 9000, false),
  ('Pizzas', 'Pizza muzzarella especial', null, 9000, false),
  ('Pizzas', 'Pizza napolitana', null, 9000, false),
  ('Pizzas', 'Pizza de huevo', null, 9000, false),
  ('Pizzas', 'Pizza de choclo', null, 9000, false),
  ('Pizzas', 'Pizza provenzal', null, 9000, false),
  ('Pizzas', 'Pizza americana', null, 10000, false),
  ('Pizzas', 'Pizza fugazzeta', null, 9000, false),
  ('Sandwiches', 'Sándwich de lomito especial', null, 9500, false),
  ('Sandwiches', 'Sándwich de lomito criollo', null, 9500, false),
  ('Sandwiches', 'Sándwich de lomito americano', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa especial', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa criolla', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa de la casa', null, 9500, false),
  ('Papas', 'Papas con salchicha', null, 8500, false),
  ('Papas', 'Papas tradicionales a caballo', null, 9000, false),
  ('Papas', 'Papas americanas', null, 10000, false),
  ('Papas', 'Papas con huevo revuelto', null, 8500, false),
  ('Papas', 'Papas simples', null, 8000, false),
  ('Bebidas', 'Coca-Cola 500 ml', null, 3000, false),
  ('Bebidas', 'Aquarius 1,5 L', null, 3500, false),
  ('Bebidas', 'Coca-Cola 1,5 L', null, 4500, false),
  ('Bebidas', 'Agua mineral 500 ml', null, 2000, false)
) as m (categoria, nombre, descripcion, precio, destacado)
join public.categorias c on c.nombre = m.categoria
where not exists (select 1 from public.comidas x where x.nombre = m.nombre);

-- ---------------------------------------------------------------------
-- 9. Dar permisos de administrador al dueño
-- Primero creá el usuario en Authentication → Users → Add user, y después
-- descomentá y corré esta línea con su correo:
-- ---------------------------------------------------------------------

-- insert into public.admins (user_id)
-- select id from auth.users where email = 'dueño@ejemplo.com';
--
-- Empleados (sin Gastos ni Finanzas): igual, pero con rol 'empleado':
-- insert into public.admins (user_id, rol)
-- select id, 'empleado' from auth.users where email = 'caja1@laspalmeras.club'
-- on conflict (user_id) do update set rol = excluded.rol;
