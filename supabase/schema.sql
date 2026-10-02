-- =====================================================================
-- Las Palmeras Club · Esquema completo de Supabase
-- Pegá este archivo entero en Supabase → SQL Editor → New query → Run.
-- Se puede volver a correr: usa "if not exists" / "create or replace"
-- y borra las políticas antes de crearlas de nuevo.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

create table if not exists public.categorias (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique check (length(btrim(nombre)) between 1 and 60),
  orden  int  not null default 0
);

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
  stock        int not null default 0 check (stock >= 0),
  -- Opciones para personalizar el pedido (todas opcionales):
  --   variantes: [{ "nombre": "Simple", "precio": 8500 }, ...]  (si hay, el precio sale de acá)
  --   quitar:    ["Cebolla", "Tomate"]                          (ingredientes que se pueden sacar)
  --   agregar:   [{ "nombre": "Huevo", "precio": 1000 }, ...]   (extras con costo)
  opciones     jsonb not null default '{}'::jsonb check (jsonb_typeof(opciones) = 'object'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Para bases creadas con una versión anterior de este archivo
alter table public.comidas
  add column if not exists opciones jsonb not null default '{}'::jsonb;

create index if not exists comidas_categoria_idx on public.comidas (categoria_id);

create table if not exists public.ventas (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated always as identity unique,  -- número de pedido legible
  created_at     timestamptz not null default now(),
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'cancelada')),
  total          numeric(12,2) not null default 0 check (total >= 0),
  cliente_nombre text check (cliente_nombre is null or length(cliente_nombre) <= 80),
  nota           text check (nota is null or length(nota) <= 300),
  origen         text not null default 'web' check (origen in ('web', 'manual'))
);

create index if not exists ventas_created_at_idx on public.ventas (created_at desc);
create index if not exists ventas_estado_idx on public.ventas (estado);

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

-- ---------------------------------------------------------------------
-- 2. Trigger de updated_at
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

-- ---------------------------------------------------------------------
-- 3. es_admin()
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

-- ---------------------------------------------------------------------
-- 4. Funciones internas (no se pueden llamar desde el cliente)
-- ---------------------------------------------------------------------

-- Crea una venta con sus ítems tomando los precios de la base.
-- p_items: [{ "comida_id": "<uuid>", "cantidad": 2,
--             "variante": "Doble", "quitar": ["Cebolla"], "agregar": ["Huevo"],
--             "aclaracion": "bien cocida" }, ...]
-- Solo comida_id y cantidad son obligatorios. Cada combinación distinta
-- (por ejemplo una doble sin cebolla) es una línea aparte.
create or replace function public._crear_venta(
  p_items jsonb,
  p_cliente_nombre text,
  p_nota text,
  p_origen text,
  p_solo_activas boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta_id uuid;
  v_total    numeric(12,2) := 0;
  v_unidades int := 0;
  v_cliente  text := nullif(btrim(coalesce(p_cliente_nombre, '')), '');
  v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido está vacío.';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'El pedido tiene demasiados productos (máximo 30 distintos).';
  end if;
  if v_cliente is not null and length(v_cliente) > 80 then
    raise exception 'El nombre es demasiado largo (máximo 80 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es demasiado larga (máximo 300 caracteres).';
  end if;

  insert into public.ventas (estado, total, cliente_nombre, nota, origen)
  values ('pendiente', 0, v_cliente, v_nota, p_origen)
  returning id into v_venta_id;

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
      if not found or (p_solo_activas and not c.activo) then
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

      v_unidades := v_unidades + r.cantidad;
      v_total    := v_total + v_precio * r.cantidad;

      insert into public.venta_items (venta_id, comida_id, nombre, detalle, precio_unitario, cantidad, subtotal)
      values (v_venta_id, c.id, c.nombre, nullif(array_to_string(v_partes, ' · '), ''),
              v_precio, r.cantidad, v_precio * r.cantidad);
    end loop;

    -- Stock y tope por producto, sumando todas sus líneas
    for r in
      select vi.comida_id, sum(vi.cantidad)::int as cantidad
      from public.venta_items vi
      where vi.venta_id = v_venta_id
      group by vi.comida_id
    loop
      select * into c from public.comidas where id = r.comida_id;
      if r.cantidad > 50 then
        raise exception 'Se pueden pedir hasta 50 unidades de cada producto.';
      end if;
      if c.stock < r.cantidad then
        if c.stock = 0 then
          raise exception '"%" está agotado.', c.nombre;
        end if;
        raise exception 'No hay stock suficiente de "%": quedan %.', c.nombre, c.stock;
      end if;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pedido no es válido.';
  end;

  if v_unidades > 100 then
    raise exception 'El pedido supera el máximo de 100 unidades.';
  end if;

  update public.ventas set total = v_total where id = v_venta_id;
  return v_venta_id;
end;
$$;

-- Descuenta el stock de todos los ítems de una venta. Falla (y deshace
-- todo) si algún producto no alcanza.
create or replace function public._descontar_stock(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_stock int;
begin
  for r in
    select vi.comida_id, sum(vi.cantidad)::int as cantidad, max(vi.nombre) as nombre
    from public.venta_items vi
    where vi.venta_id = p_venta_id and vi.comida_id is not null
    group by vi.comida_id
    order by vi.comida_id            -- orden fijo para evitar bloqueos cruzados
  loop
    update public.comidas
       set stock = stock - r.cantidad
     where id = r.comida_id and stock >= r.cantidad;

    if not found then
      select stock into v_stock from public.comidas where id = r.comida_id;
      raise exception 'No hay stock suficiente de "%": quedan % y la venta lleva %.',
        r.nombre, coalesce(v_stock, 0), r.cantidad;
    end if;
  end loop;
end;
$$;

-- Devuelve al stock lo que se había descontado (al cancelar una confirmada).
create or replace function public._devolver_stock(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comidas c
     set stock = c.stock + t.cantidad
    from (
      select vi.comida_id, sum(vi.cantidad)::int as cantidad
      from public.venta_items vi
      where vi.venta_id = p_venta_id and vi.comida_id is not null
      group by vi.comida_id
    ) t
   where c.id = t.comida_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Funciones RPC (las que llama el frontend)
-- ---------------------------------------------------------------------

-- La llama el catálogo (anónimo) justo antes de abrir WhatsApp.
-- Devuelve { numero, total, items: [{ nombre, cantidad, precio_unitario, subtotal }] }
create or replace function public.crear_pedido(
  items jsonb,
  cliente_nombre text default null,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Freno simple contra abuso: como mucho 20 pedidos web por minuto en total.
  if (select count(*) from public.ventas
       where origen = 'web' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Estamos recibiendo muchos pedidos en este momento. Probá de nuevo en un minuto.';
  end if;

  v_id := public._crear_venta(crear_pedido.items, crear_pedido.cliente_nombre, crear_pedido.nota, 'web', true);

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

-- Solo admin: pasa un pedido pendiente a confirmado y descuenta stock.
create or replace function public.confirmar_venta(venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select v.estado into v_estado from public.ventas v where v.id = confirmar_venta.venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'Solo se pueden confirmar pedidos pendientes (este está %).', v_estado;
  end if;

  perform public._descontar_stock(confirmar_venta.venta_id);
  update public.ventas v set estado = 'confirmada' where v.id = confirmar_venta.venta_id;
end;
$$;

-- Solo admin: cancela. Si estaba confirmada, devuelve el stock.
create or replace function public.cancelar_venta(venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select v.estado into v_estado from public.ventas v where v.id = cancelar_venta.venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v_estado = 'cancelada' then
    raise exception 'La venta ya estaba cancelada.';
  end if;

  if v_estado = 'confirmada' then
    perform public._devolver_stock(cancelar_venta.venta_id);
  end if;
  update public.ventas v set estado = 'cancelada' where v.id = cancelar_venta.venta_id;
end;
$$;

-- Solo admin: venta en el local. Queda confirmada y descuenta stock.
-- Permite vender comidas inactivas (ocultas en el catálogo).
create or replace function public.registrar_venta_manual(
  items jsonb,
  cliente_nombre text default null,
  nota text default null
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

  v_id := public._crear_venta(registrar_venta_manual.items, registrar_venta_manual.cliente_nombre,
                              registrar_venta_manual.nota, 'manual', false);
  perform public._descontar_stock(v_id);
  update public.ventas v set estado = 'confirmada' where v.id = v_id;

  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = v_id);
end;
$$;

-- Permisos de ejecución: por defecto Postgres deja ejecutar a todos.
revoke execute on function public._crear_venta(jsonb, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public._descontar_stock(uuid) from public, anon, authenticated;
revoke execute on function public._devolver_stock(uuid) from public, anon, authenticated;
revoke execute on function public.confirmar_venta(uuid) from public, anon;
revoke execute on function public.cancelar_venta(uuid) from public, anon;
revoke execute on function public.registrar_venta_manual(jsonb, text, text) from public, anon;

grant execute on function public.es_admin() to anon, authenticated;   -- lo usan las políticas RLS
grant execute on function public.crear_pedido(jsonb, text, text) to anon, authenticated;
grant execute on function public.confirmar_venta(uuid) to authenticated;
grant execute on function public.cancelar_venta(uuid) to authenticated;
grant execute on function public.registrar_venta_manual(jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Seguridad a nivel de fila (RLS)
-- ---------------------------------------------------------------------

alter table public.categorias  enable row level security;
alter table public.comidas     enable row level security;
alter table public.ventas      enable row level security;
alter table public.venta_items enable row level security;
alter table public.admins      enable row level security;

-- Defensa extra: el rol anónimo no toca ventas ni admins de forma directa.
revoke all on public.ventas, public.venta_items, public.admins from anon;
revoke insert, update, delete on public.admins from authenticated;

-- categorias: lectura pública, escritura solo admin
drop policy if exists "categorias_lectura_publica" on public.categorias;
create policy "categorias_lectura_publica" on public.categorias
  for select to anon, authenticated using (true);

drop policy if exists "categorias_admin_inserta" on public.categorias;
create policy "categorias_admin_inserta" on public.categorias
  for insert to authenticated with check (public.es_admin());

drop policy if exists "categorias_admin_edita" on public.categorias;
create policy "categorias_admin_edita" on public.categorias
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "categorias_admin_borra" on public.categorias;
create policy "categorias_admin_borra" on public.categorias
  for delete to authenticated using (public.es_admin());

-- comidas: el público ve solo las activas; el admin ve y edita todo
drop policy if exists "comidas_lectura" on public.comidas;
create policy "comidas_lectura" on public.comidas
  for select to anon, authenticated using (activo or public.es_admin());

drop policy if exists "comidas_admin_inserta" on public.comidas;
create policy "comidas_admin_inserta" on public.comidas
  for insert to authenticated with check (public.es_admin());

drop policy if exists "comidas_admin_edita" on public.comidas;
create policy "comidas_admin_edita" on public.comidas
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "comidas_admin_borra" on public.comidas;
create policy "comidas_admin_borra" on public.comidas
  for delete to authenticated using (public.es_admin());

-- ventas y venta_items: solo admin (el público entra únicamente por crear_pedido)
drop policy if exists "ventas_admin" on public.ventas;
create policy "ventas_admin" on public.ventas
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "venta_items_admin" on public.venta_items;
create policy "venta_items_admin" on public.venta_items
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- admins: cada usuario puede ver solamente su propio registro
drop policy if exists "admins_ver_propio" on public.admins;
create policy "admins_ver_propio" on public.admins
  for select to authenticated using (user_id = auth.uid());

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
-- El stock arranca en 20 unidades: ajustalo desde el panel antes de abrir.
-- ---------------------------------------------------------------------

insert into public.categorias (nombre, orden) values
  ('Burguers', 1),
  ('Combos', 2),
  ('Pizzas', 3),
  ('Sandwiches', 4),
  ('Napolitanas', 5),
  ('Papas', 6),
  ('Bebidas', 7)
on conflict (nombre) do nothing;

-- Hamburguesas: un solo producto por hamburguesa, con variantes (Simple / Doble)
-- y los ingredientes que se pueden sacar. Si la base todavía tiene los
-- productos separados ("X doble" y "X simple"), los une en uno (conserva la
-- foto y el stock del doble). Se puede volver a correr sin problema.
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
      insert into public.comidas (nombre, descripcion, precio, stock, categoria_id, opciones)
      values (r.base, r.descripcion, r.precio_simple, 20, v_cat, v_opc);
    end if;
  end loop;
end;
$$;

insert into public.comidas (nombre, descripcion, precio, destacado, stock, categoria_id)
select m.nombre, m.descripcion, m.precio, m.destacado, 20, c.id
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
  ('Napolitanas', 'Napolitana para una persona', null, 10000, false),
  ('Napolitanas', 'Napolitana para dos personas', null, 19000, false),
  ('Napolitanas', 'Napolitana para tres personas', null, 28000, false),
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
