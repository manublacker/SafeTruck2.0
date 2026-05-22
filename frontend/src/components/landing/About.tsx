const stats = [
  { num: "500+", label: "Camiones trackeados" },
  { num: "80+",  label: "Empresas activas" },
  { num: "99.9%", label: "Uptime garantizado" },
];

const About = () => (
  <section id="nosotros" className="landing-about">
    <div className="landing-about__inner">
      <div>
        <p className="landing-about__tag">Nuestra historia</p>
        <h2 className="landing-about__title">Construido por gente del transporte</h2>
        <p className="landing-about__body">
          Safe Truck nació de la necesidad real de las empresas de logística
          argentinas: saber dónde está cada camión, en todo momento, sin depender
          de llamadas ni mensajes. Somos un equipo apasionado por la tecnología y
          el transporte, comprometidos con hacer la gestión de flotas simple y
          accesible para empresas de todos los tamaños.
        </p>
      </div>
      <div className="landing-about__stats">
        {stats.map((s) => (
          <div key={s.label} className="landing-about__stat">
            <div className="landing-about__stat-num">{s.num}</div>
            <div className="landing-about__stat-label">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default About;
