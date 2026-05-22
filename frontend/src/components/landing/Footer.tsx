const cols = [
  { title: "Producto", links: ["Cómo funciona", "Planes", "App mobile", "API"] },
  { title: "Empresa",  links: ["Nosotros", "Blog", "Prensa", "Contacto"] },
  { title: "Legal",    links: ["Términos", "Privacidad", "Cookies"] },
];

const Footer = () => (
  <footer id="contacto" className="landing-footer">
    <div className="landing-footer__inner">
      <div className="landing-footer__grid">
        <div>
          <div className="landing-footer__brand">Safe Truck</div>
          <p className="landing-footer__tagline">Gestión de flotas simple y poderosa.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h4 className="landing-footer__col-title">{c.title}</h4>
            <ul>
              {c.links.map((l) => (
                <li key={l}>
                  <a href="#" className="landing-footer__link">{l}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="landing-footer__bottom">
        © 2025 Safe Truck. Todos los derechos reservados.
      </div>
    </div>
  </footer>
);

export default Footer;
