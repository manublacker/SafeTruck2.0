import { useState, type MouseEvent } from "react";
import safeTruckLogo from "@/assets/logo_safetruck.png";
import { Menu, X } from "lucide-react";

const links = [
  { label: "Qué ofrecemos", targetId: "que-ofrecemos" },
  { label: "Cómo funciona", targetId: "como-funciona" },
  { label: "Planes", targetId: "planes" },
  { label: "Nosotros", targetId: "nosotros" },
];

const Navbar = () => {
  const [open, setOpen] = useState(false);

  const scrollToSection = (
    event: MouseEvent<HTMLAnchorElement>,
    targetId: string,
    closeMenu = false,
  ) => {
    const target = document.getElementById(targetId);
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", "#" + targetId);

    if (closeMenu) {
      setOpen(false);
    }
  };

  return (
    <nav className="landing-nav">
      <div className="landing-nav__inner">
        <a
          href="#top"
          onClick={(event) => scrollToSection(event, "top")}
          className="landing-nav__brand"
        >
          <img src={safeTruckLogo} alt="Safe Truck" className="landing-nav__logo" />
          Safe Truck
        </a>

        <div className="landing-nav__links">
          {links.map((link) => (
            <a
              key={link.label}
              href={"#" + link.targetId}
              onClick={(event) => scrollToSection(event, link.targetId)}
              className="landing-nav__link"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="landing-nav__actions">
          <a href="/login" className="landing-nav__button landing-nav__button--ghost">
            Iniciar sesión
          </a>
          <a href="/register" className="landing-nav__button landing-nav__button--primary">
            Registrá tu empresa
          </a>
        </div>

        <button
          className="landing-nav__menu-toggle"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X size={28} /> : <Menu size={28} />}
        </button>
      </div>

      {open && (
        <div className="landing-nav__mobile-panel">
          {links.map((link) => (
            <a
              key={link.label}
              href={"#" + link.targetId}
              onClick={(event) => scrollToSection(event, link.targetId, true)}
              className="landing-nav__mobile-link"
            >
              {link.label}
            </a>
          ))}
          <a href="/login" className="landing-nav__button landing-nav__button--ghost landing-nav__button--full">
            Iniciar sesión
          </a>
          <a href="/register" className="landing-nav__button landing-nav__button--primary landing-nav__button--full">
            Registrá tu empresa
          </a>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
