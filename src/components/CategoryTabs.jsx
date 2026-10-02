// Barra de categorías: cada link salta (#id) a la sección correspondiente
function CategoryTabs({ categorias }) {
  return (
    <nav className="tabs" aria-label="Categorías">
      {categorias.map((c) => (
        <a key={c.id} href={`#${c.id}`} className="tabs__link">
          {c.nombre}
        </a>
      ))}
    </nav>
  );
}

export default CategoryTabs;
