-- =====================================================================
-- Las Palmeras Club · Actualización del 29/10/2026
-- Lista de platos del mediodía (44 platos en 5 categorías), sin precio.
--
-- Los platos entran SIN PRECIO y NO DISPONIBLES: el dueño les pone el
-- precio desde Venta mediodía → Platos → Editar, y al guardar quedan
-- disponibles para vender y para el Menú del día.
--
-- Para una base que YA está andando: pegá este archivo entero en
-- Supabase → SQL Editor → New query → Run. No borra ni pisa nada:
-- si un plato o una categoría ya existe, lo deja como está.
-- Se puede volver a correr sin romper nada.
-- =====================================================================

begin;

-- 1. Platos sin precio -------------------------------------------------
-- Mientras no tengan precio no pueden estar disponibles, así nadie los vende a $ 0.
alter table public.comidas alter column precio drop not null;
alter table public.comidas drop constraint if exists comidas_precio_activo_check;
alter table public.comidas add constraint comidas_precio_activo_check check (precio is not null or not activo);

-- En el registro de actividad, "Cambió el precio · sin precio → $ 9000.00"
create or replace function public._pesos(p numeric)
returns text
language sql
immutable
as $$
  select coalesce('$ ' || trim(to_char(p, '999999999990.00')), 'sin precio');
$$;

-- 2. Categorías del mediodía --------------------------------------------
insert into public.categorias (nombre, orden, turno, controla_stock)
select m.nombre, coalesce((select max(orden) from public.categorias where turno = 'mediodia'), 0) + m.orden, 'mediodia', false
from (values
  ('Pollo', 1),
  ('Carnes', 2),
  ('Guisos y estofados', 3),
  ('Pastas', 4),
  ('Al horno y rellenos', 5)
) as m (nombre, orden)
on conflict (turno, nombre) do nothing;

-- 3. Platos -------------------------------------------------------------
insert into public.comidas (nombre, precio, activo, categoria_id, turno)
select m.nombre, null, false, c.id, 'mediodia'
from (values
  ('Pollo', 'Pollo al limón'),
  ('Pollo', 'Pollo a la mostaza'),
  ('Pollo', 'Pollo a la naranja'),
  ('Pollo', 'Pollo frito'),
  ('Pollo', 'Bife de pollo al verdeo'),
  ('Pollo', 'Bife de pollo a la strogonoff'),
  ('Pollo', 'Bife de pollo al champiñón'),
  ('Pollo', 'Arrollado de pollo'),
  ('Pollo', 'Napolitana de pollo'),
  ('Pollo', 'Hamburguesa de pollo'),

  ('Carnes', 'Hamburguesa a la napolitana'),
  ('Carnes', 'Napolitana de carne'),
  ('Carnes', 'Milanesa rellena'),
  ('Carnes', 'Lampreado'),
  ('Carnes', 'Lomo al champiñón'),
  ('Carnes', 'Bife al ajillo'),
  ('Carnes', 'Bife a la criolla'),
  ('Carnes', 'Bife a la provenzal'),
  ('Carnes', 'Arrollado de carne'),
  ('Carnes', 'Pique a lo macho'),
  ('Carnes', 'Costeleta de cerdo'),
  ('Carnes', 'Chorizo a la pomarola'),

  ('Guisos y estofados', 'Estofado de carne'),
  ('Guisos y estofados', 'Estofado de pollo'),
  ('Guisos y estofados', 'Osobuco al vino'),
  ('Guisos y estofados', 'Carbonada'),
  ('Guisos y estofados', 'Albóndigas en salsa'),

  ('Pastas', 'Lasaña de carne'),
  ('Pastas', 'Lasaña de jamón y queso'),
  ('Pastas', 'Canelones de carne y espinaca'),
  ('Pastas', 'Ñoquis'),
  ('Pastas', 'Ravioles'),
  ('Pastas', 'Raviolón'),
  ('Pastas', 'Sorrentinos'),
  ('Pastas', 'Capeletinis'),
  ('Pastas', 'Fideos caseros'),

  ('Al horno y rellenos', 'Pastel de papa'),
  ('Al horno y rellenos', 'Pastel de choclo'),
  ('Al horno y rellenos', 'Kupe'),
  ('Al horno y rellenos', 'Kupe frito'),
  ('Al horno y rellenos', 'Bomba de carne'),
  ('Al horno y rellenos', 'Papa con queso'),
  ('Al horno y rellenos', 'Zapallito relleno'),
  ('Al horno y rellenos', 'Canastita de verduras')
) as m (categoria, nombre)
join public.categorias c on c.turno = 'mediodia' and c.nombre = m.categoria
where not exists (
  select 1 from public.comidas x where x.turno = 'mediodia' and lower(x.nombre) = lower(m.nombre)
);

-- La carga la hace el SQL Editor (sin usuario): no la anotamos plato por
-- plato en el registro de actividad, como si la hubiera hecho la carta online.
delete from public.actividad
 where usuario is null and tipo = 'catalogo' and accion = 'Creó un producto' and created_at = now();

commit;

-- Comprobación: tiene que mostrar las 5 categorías con sus platos
-- (Pollo 10, Carnes 12, Guisos y estofados 5, Pastas 9, Al horno y rellenos 8)
select c.nombre as categoria, count(m.id) as platos, count(m.id) filter (where m.precio is null) as sin_precio
from public.categorias c
left join public.comidas m on m.categoria_id = c.id
where c.turno = 'mediodia' and c.nombre in ('Pollo', 'Carnes', 'Guisos y estofados', 'Pastas', 'Al horno y rellenos')
group by c.nombre, c.orden
order by c.orden;
