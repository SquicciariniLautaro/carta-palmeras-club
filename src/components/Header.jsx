import logo from "../assets/LasPalmeraslogo_-_blanco.png";

function Header() {
  return (
    <header className="header">
      <img className="header__logo" src={logo} alt="Las Palmeras Club" />
      <p className="header__texto">Burguers, pizzas, papas y más. Pedí y lo recibís en minutos.</p>
    </header>
  );
}

export default Header;
