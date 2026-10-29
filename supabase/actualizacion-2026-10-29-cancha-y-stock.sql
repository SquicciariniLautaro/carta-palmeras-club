-- =====================================================================
-- Las Palmeras Club · Actualización del 29/10/2026
-- Cancha de fútbol (turnos y cobros) + stock solo en bebidas y golosinas.
--
-- Para una base que YA está andando: pegá este archivo entero en
-- Supabase → SQL Editor → New query → Run. No borra ni pisa nada:
-- agrega lo nuevo. Se puede volver a correr sin romper nada.
-- (En una base nueva alcanza con schema.sql, que ya trae todo esto.)
-- =====================================================================

begin;

-- 1. Categorías de kiosco y stock ------------------------------------
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

-- Stock: solo cuenta en las categorías de kiosco (controla_stock).
-- null = sin control. Las ventas lo descuentan solas (trigger venta_items_stock).
-- Las comidas de cocina no llevan stock: si no hay, se desactivan desde el panel.
alter table public.comidas add column if not exists stock int;

-- 2. Ventas de la cancha ----------------------------------------------
alter table public.ventas drop constraint if exists ventas_turno_check;
-- 'cancha' = cobro de un turno de la cancha de fútbol (ver cancha_turnos)
alter table public.ventas add constraint ventas_turno_check check (turno in ('noche', 'mediodia', 'cancha'));

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

-- 3. Triggers: stock y turnos de la cancha ----------------------------
-- Stock de kiosco: suma o resta unidades a una comida, solo si su categoría
-- controla stock y la comida tiene stock cargado. Estricto = pedido web: no
-- deja vender más de lo que hay (en el local se puede quedar en negativo, así
-- se ve la diferencia y se corrige el conteo).
create or replace function public._ajustar_stock(p_comida_id uuid, p_delta int, p_estricto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock  int;
  v_nombre text;
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
  if found and p_delta < 0 and p_estricto and v_stock < 0 then
    raise exception 'No nos queda stock suficiente de "%" (quedan %). Actualizá la página.',
      v_nombre, greatest(v_stock - p_delta, 0);
  end if;
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
    perform public._ajustar_stock(old.comida_id, old.cantidad, false);
    return old;
  end if;
  select v.origen = 'web' into v_web from public.ventas v where v.id = new.venta_id;
  if tg_op = 'INSERT' then
    perform public._ajustar_stock(new.comida_id, -new.cantidad, coalesce(v_web, false));
  else
    perform public._ajustar_stock(new.comida_id, old.cantidad - new.cantidad, coalesce(v_web, false));
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
      raise exception 'Este turno ya está cobrado. Para borrarlo, primero anulá el cobro.';
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

-- 4. La caja suma lo cobrado de la cancha -----------------------------
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

-- 5. Cobrar y anular cobros de la cancha ------------------------------
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

  v_venta := t.venta_id;
  if v_venta is null then
    insert into public.ventas (estado, total, cliente_nombre, nota, origen, turno)
    values ('entregado', t.precio, t.cliente_nombre, t.nota, 'manual', 'cancha')
    returning id into v_venta;

    insert into public.venta_items (venta_id, comida_id, nombre, detalle, precio_unitario, cantidad, subtotal)
    values (v_venta, null, 'Alquiler de cancha',
            to_char(t.fecha, 'DD/MM') || ' · ' || to_char(t.desde, 'HH24:MI') || ' a '
              || to_char(t.desde + make_interval(mins => t.minutos), 'HH24:MI'),
            t.precio, 1, t.precio);

    update public.cancha_turnos c set venta_id = v_venta where c.id = t.id;
  end if;

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
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;
  select c.venta_id into v_venta from public.cancha_turnos c where c.id = anular_cobro_cancha.turno_id for update;
  if v_venta is null then
    raise exception 'Este turno no está cobrado.';
  end if;
  delete from public.ventas v where v.id = v_venta;   -- el turno queda sin cobrar (on delete set null)
end;
$$;

revoke execute on function public._ajustar_stock(uuid, int, boolean) from public, anon, authenticated;
revoke execute on function public._mover_stock() from public, anon, authenticated;
revoke execute on function public._controlar_turno_cancha() from public, anon, authenticated;
revoke execute on function public._resumen_caja(uuid) from public, anon, authenticated;
revoke execute on function public.cobrar_turno_cancha(uuid, jsonb) from public, anon;
revoke execute on function public.anular_cobro_cancha(uuid) from public, anon;
grant execute on function public.cobrar_turno_cancha(uuid, jsonb) to authenticated;
grant execute on function public.anular_cobro_cancha(uuid) to authenticated;

-- 6. Permisos (RLS) ---------------------------------------------------
alter table public.cancha_turnos enable row level security;
revoke all on public.cancha_turnos from anon;

drop policy if exists "cancha_turnos_admin" on public.cancha_turnos;
create policy "cancha_turnos_admin" on public.cancha_turnos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- comidas: el público ve solo las activas de la carta (sin las de kiosco que se
-- quedaron sin stock); el admin ve y edita todo
drop policy if exists "comidas_lectura" on public.comidas;
create policy "comidas_lectura" on public.comidas
  for select to anon, authenticated using (
    (activo and turno = 'noche'
     and not (coalesce(stock, 1) <= 0
              and exists (select 1 from public.categorias k where k.id = categoria_id and k.controla_stock)))
    or public.es_admin());


-- 7. Categoría Golosinas en la carta (no se ve en la carta hasta que tenga productos)
insert into public.categorias (nombre, orden, turno, controla_stock)
select 'Golosinas', coalesce(max(orden), 0) + 1, 'noche', true
  from public.categorias where turno = 'noche'
on conflict (turno, nombre) do nothing;

commit;

-- Comprobación: tiene que mostrar las categorías que llevan stock
-- (Bebidas y Golosinas) y la tabla de turnos de la cancha vacía.
select turno, nombre, controla_stock from public.categorias where controla_stock order by turno, orden;
select count(*) as turnos_de_cancha from public.cancha_turnos;
