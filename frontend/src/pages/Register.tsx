import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Mail, CheckCircle2, ArrowLeft } from "lucide-react";
import safeTruckLogo from "@/assets/logo_safetruck.png";
import {
  signUpStart,
  resendSignupConfirmation,
  fetchUserProfile,
} from "@/services/authApi";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type FormData = {
  email: string;
  password: string;
  confirmPassword: string;
  terms: boolean;
  companyName: string;
  cuit: string;
  legalName: string;
  industry: string;
  fleetSize: string;
  country: string;
  province: string;
  code: string[];
  plan: string;
};

const initialData: FormData = {
  email: "",
  password: "",
  confirmPassword: "",
  terms: false,
  companyName: "",
  cuit: "",
  legalName: "",
  industry: "",
  fleetSize: "",
  country: "Argentina",
  province: "",
  code: ["", "", "", "", "", ""],
  plan: "",
};

const provinces = [
  "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba",
  "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan",
  "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero",
  "Tierra del Fuego", "Tucumán",
];

const stepLabels = ["Acceso", "Tu empresa", "Verificación", "Plan"];

const ProgressIndicator = ({ step }: { step: number }) => (
  <div className="register-progress">
    <div className="register-progress__track">
      {stepLabels.map((label, i) => {
        const idx = i + 1;
        const completed = idx < step;
        const active = idx === step;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <div
                className={[
                  "register-progress__line",
                  completed && "register-progress__line--done",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            )}
            <div className="register-progress__col">
              <div
                className={[
                  "register-progress__circle",
                  completed && "register-progress__circle--done",
                  active && "register-progress__circle--active",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {completed ? <Check size={18} /> : idx}
              </div>
              <span
                className={[
                  "register-progress__label",
                  active && "register-progress__label--active",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {label}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  </div>
);

const formatCuit = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
};

const Register = () => {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resendIn, setResendIn] = useState(0);
  const navigate = useNavigate();
  const { user, login } = useAuth();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (user && step <= 3) setStep(4);
  }, [user, step]);

  const update = <K extends keyof FormData>(k: K, v: FormData[K]) => {
    setData((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: "" }));
  };

  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) e.email = "Email inválido";
    if (data.password.length < 8) e.password = "Debés ingresar mínimo 8 caracteres";
    if (data.password !== data.confirmPassword) e.confirmPassword = "Las contraseñas no coinciden";
    if (!data.terms) e.terms = "Debés aceptar los términos";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e: Record<string, string> = {};
    if (!data.companyName.trim()) e.companyName = "Requerido";
    if (!/^\d{2}-\d{8}-\d{1}$/.test(data.cuit)) e.cuit = "Formato XX-XXXXXXXX-X";
    if (!data.legalName.trim()) e.legalName = "Requerido";
    if (!data.industry) e.industry = "Requerido";
    if (!data.fleetSize) e.fleetSize = "Requerido";
    if (!data.province) e.province = "Requerido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep3 = () => {
    const e: Record<string, string> = {};
    if (data.code.some((c) => !c)) e.code = "Ingresá los 6 dígitos";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = async () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2) {
      if (!validateStep2()) return;
      try {
        await signUpStart({
          email: data.email,
          password: data.password,
          emailRedirectTo: `${window.location.origin}/register?verified=1`,
          metadata: {
            full_name: data.legalName,
            company: data.companyName,
            cuit: data.cuit,
            industry: data.industry,
            fleet_size: data.fleetSize,
            country: data.country,
            province: data.province,
          },
        });
      } catch (err) {
        setErrors({ general: err instanceof Error ? err.message : "Error al crear la cuenta." });
        return;
      }
      setResendIn(60);
    }
    if (step === 3) {
      if (!validateStep3()) return;
      try {
        const code = data.code.join("");
        const { data: otpData, error } = await supabase.auth.verifyOtp({
          email: data.email,
          token: code,
          type: "signup",
        });
        if (error) throw new Error(error.message);
        if (!otpData.session) throw new Error("No se pudo verificar el código.");
        const res = await fetchUserProfile(otpData.session.access_token, {
          full_name: data.legalName,
          company: data.companyName,
          cuit: data.cuit,
          industry: data.industry,
          fleet_size: data.fleetSize,
          country: data.country,
          province: data.province,
        });
        login(res.token, res.user);
      } catch (err) {
        setErrors({ code: err instanceof Error ? err.message : "Código inválido." });
        return;
      }
      setResendIn(0);
    }
    setStep(step + 1);
  };

  const handleCodeChange = (i: number, v: string) => {
    const digit = v.replace(/\D/g, "").slice(-1);
    const code = [...data.code];
    code[i] = digit;
    update("code", code);
    if (digit && i < 5) {
      (document.getElementById(`code-${i + 1}`) as HTMLInputElement | null)?.focus();
    }
  };

  const handleCodeKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !data.code[i] && i > 0) {
      (document.getElementById(`code-${i - 1}`) as HTMLInputElement | null)?.focus();
    }
  };

  const handleResend = async () => {
    try {
      await resendSignupConfirmation(data.email, `${window.location.origin}/register?verified=1`);
      setResendIn(60);
    } catch (err) {
      setErrors({ code: err instanceof Error ? err.message : "No se pudo reenviar." });
    }
  };

  const allCodeFilled = data.code.every((c) => c);

  const choosePlan = (plan: string) => {
    update("plan", plan);
    setTimeout(() => navigate("/"), 200);
  };

  return (
    <div className="auth-page tw-page">
      <main className="auth-main">
        <Link to="/" className="auth-logo">
          <img src={safeTruckLogo} alt="Safe Truck" className="auth-logo__img" />
        </Link>

        <div className="auth-card">
          <div className="auth-card__inner">
            <ProgressIndicator step={step} />

            {step > 1 && step < 4 && (
              <button onClick={() => setStep(step - 1)} className="auth-back">
                <ArrowLeft size={16} /> Volver
              </button>
            )}

            <div key={step}>
              {step === 1 && (
                <div>
                  <h1 className="auth-title">Creá tu cuenta</h1>
                  <p className="auth-subtitle">Ingresá los datos para acceder a Safe Truck.</p>

                  <div className="auth-fields">
                    <div className="auth-field">
                      <input
                        type="email"
                        placeholder="empresa@mail.com"
                        value={data.email}
                        onChange={(e) => update("email", e.target.value)}
                        className="auth-input"
                      />
                      {errors.email && <p className="auth-error">{errors.email}</p>}
                    </div>
                    <div className="auth-field">
                      <input
                        type="password"
                        placeholder="Contraseña"
                        value={data.password}
                        onChange={(e) => update("password", e.target.value)}
                        className="auth-input"
                      />
                      {errors.password && <p className="auth-error">{errors.password}</p>}
                    </div>
                    <div className="auth-field">
                      <input
                        type="password"
                        placeholder="Repetí tu contraseña"
                        value={data.confirmPassword}
                        onChange={(e) => update("confirmPassword", e.target.value)}
                        className="auth-input"
                      />
                      {errors.confirmPassword && <p className="auth-error">{errors.confirmPassword}</p>}
                    </div>
                    <div className="auth-field">
                      <label className="auth-checkbox-label">
                        <input
                          type="checkbox"
                          checked={data.terms}
                          onChange={(e) => update("terms", e.target.checked)}
                          className="auth-checkbox"
                        />
                        <span>
                          Acepto los{" "}
                          <a href="#" className="auth-link">Términos y condiciones</a>{" "}
                          y la{" "}
                          <a href="#" className="auth-link">Política de privacidad</a>
                        </span>
                      </label>
                      {errors.terms && <p className="auth-error">{errors.terms}</p>}
                    </div>
                  </div>

                  <button onClick={next} className="auth-btn">Continuar</button>
                  <p className="auth-footer-text">
                    ¿Ya tenés cuenta?{" "}
                    <Link to="/login" className="auth-link">Iniciá sesión</Link>
                  </p>
                </div>
              )}

              {step === 2 && (
                <div>
                  <h1 className="auth-title">Tu empresa</h1>
                  <p className="auth-subtitle">Contanos sobre tu flota.</p>

                  <div className="auth-fields">
                    <div className="auth-field">
                      <input
                        type="text"
                        placeholder="Transportes S.A."
                        value={data.companyName}
                        onChange={(e) => update("companyName", e.target.value)}
                        className="auth-input"
                      />
                      {errors.companyName && <p className="auth-error">{errors.companyName}</p>}
                    </div>
                    <div className="auth-field">
                      <input
                        type="text"
                        placeholder="XX-XXXXXXXX-X"
                        value={data.cuit}
                        onChange={(e) => update("cuit", formatCuit(e.target.value))}
                        className="auth-input"
                      />
                      {errors.cuit && <p className="auth-error">{errors.cuit}</p>}
                    </div>
                    <div className="auth-field">
                      <input
                        type="text"
                        placeholder="Razón social oficial"
                        value={data.legalName}
                        onChange={(e) => update("legalName", e.target.value)}
                        className="auth-input"
                      />
                      {errors.legalName && <p className="auth-error">{errors.legalName}</p>}
                    </div>
                    <div className="auth-field">
                      <select
                        value={data.industry}
                        onChange={(e) => update("industry", e.target.value)}
                        className="auth-input"
                      >
                        <option value="">Rubro / tipo de carga</option>
                        <option>Carga general</option>
                        <option>Granos / Agro</option>
                        <option>Materiales de construcción</option>
                        <option>Refrigerados</option>
                        <option>Combustibles</option>
                        <option>Otros</option>
                      </select>
                      {errors.industry && <p className="auth-error">{errors.industry}</p>}
                    </div>
                    <div className="auth-field">
                      <select
                        value={data.fleetSize}
                        onChange={(e) => update("fleetSize", e.target.value)}
                        className="auth-input"
                      >
                        <option value="">Cantidad de camiones</option>
                        <option>1 a 5</option>
                        <option>6 a 20</option>
                        <option>21 a 50</option>
                        <option>Más de 50</option>
                      </select>
                      {errors.fleetSize && <p className="auth-error">{errors.fleetSize}</p>}
                    </div>
                    <div className="auth-field">
                      <select
                        value={data.country}
                        onChange={(e) => update("country", e.target.value)}
                        className="auth-input"
                      >
                        <option>Argentina</option>
                        <option>Uruguay</option>
                        <option>Chile</option>
                        <option>Paraguay</option>
                        <option>Brasil</option>
                      </select>
                    </div>
                    <div className="auth-field">
                      <select
                        value={data.province}
                        onChange={(e) => update("province", e.target.value)}
                        className="auth-input"
                      >
                        <option value="">Provincia</option>
                        {provinces.map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                      {errors.province && <p className="auth-error">{errors.province}</p>}
                    </div>
                  </div>

                  {errors.general && <p className="auth-error">{errors.general}</p>}
                  <button onClick={next} className="auth-btn">Continuar</button>
                </div>
              )}

              {step === 3 && (
                <div>
                  <h1 className="auth-title">Verificá tu email</h1>
                  <p className="auth-subtitle">
                    Te enviamos un código de 6 dígitos a{" "}
                    <strong>{data.email || "tu email"}</strong>.
                  </p>

                  <div className="auth-mail-icon">
                    <Mail size={56} />
                  </div>

                  <div className="auth-code-inputs">
                    {data.code.map((c, i) => (
                      <input
                        key={i}
                        id={`code-${i}`}
                        inputMode="numeric"
                        maxLength={1}
                        value={c}
                        onChange={(e) => handleCodeChange(i, e.target.value)}
                        onKeyDown={(e) => handleCodeKey(i, e)}
                        className={[
                          "auth-code-input",
                          allCodeFilled
                            ? "auth-code-input--complete"
                            : c
                            ? "auth-code-input--filled"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    ))}
                  </div>
                  {errors.code && <p className="auth-error" style={{ textAlign: "center" }}>{errors.code}</p>}

                  <button onClick={next} className="auth-btn">Verificar código</button>
                  <p className="auth-footer-text">
                    ¿No recibiste el código?{" "}
                    {resendIn > 0 ? (
                      <span>Reenviar en {resendIn}s</span>
                    ) : (
                      <button onClick={handleResend} className="auth-link" style={{ background: "none", border: "none", cursor: "pointer", font: "inherit" }}>
                        Reenviar
                      </button>
                    )}
                  </p>
                </div>
              )}

              {step === 4 && (
                <div>
                  <h1 className="auth-title" style={{ textAlign: "center" }}>Elegí tu plan</h1>
                  <p className="auth-subtitle" style={{ textAlign: "center" }}>
                    Comenzá a trackear tu flota hoy.
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                    <PlanCard
                      name="Starter"
                      price="$29"
                      features={[
                        "Hasta 5 camiones",
                        "Tracking en tiempo real",
                        "App mobile para choferes",
                        "Historial 7 días",
                        "Soporte por email",
                      ]}
                      cta="Elegir Starter"
                      onClick={() => choosePlan("starter")}
                    />
                    <PlanCard
                      name="Pro"
                      price="$79"
                      features={[
                        "Hasta 20 camiones",
                        "Todo lo de Starter",
                        "Historial 30 días",
                        "Alertas personalizadas",
                        "Panel multi-usuario (3 admins)",
                        "Soporte prioritario",
                      ]}
                      cta="Elegir Pro"
                      highlighted
                      onClick={() => choosePlan("pro")}
                    />
                    <PlanCard
                      name="Enterprise"
                      price="$199"
                      features={[
                        "Camiones ilimitados",
                        "Todo lo de Pro",
                        "Historial 1 año",
                        "API de integración",
                        "Reportes avanzados",
                        "Manager dedicado",
                        "SLA garantizado",
                      ]}
                      cta="Contactar ventas"
                      onClick={() => choosePlan("enterprise")}
                    />
                  </div>

                  <button
                    onClick={() => setStep(3)}
                    className="auth-back"
                    style={{ margin: "1.5rem auto 0" }}
                  >
                    <ArrowLeft size={16} /> Volver
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

const PlanCard = ({
  name,
  price,
  features,
  cta,
  highlighted,
  onClick,
}: {
  name: string;
  price: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
  onClick: () => void;
}) => (
  <div className={["plan-card", highlighted && "plan-card--highlighted"].filter(Boolean).join(" ")}>
    {highlighted && <span className="plan-card__badge">Más elegido</span>}
    <p className="plan-card__name">{name}</p>
    <div className="plan-card__price-row">
      <span className="plan-card__price">{price}</span>
      <span className="plan-card__period">USD/mes</span>
    </div>
    <ul className="plan-card__features">
      {features.map((f) => (
        <li key={f} className="plan-card__feature">
          <CheckCircle2 size={18} className="plan-card__check" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
    <button
      onClick={onClick}
      className={[
        "plan-card__cta",
        highlighted ? "plan-card__cta--primary" : "plan-card__cta--outline",
      ].join(" ")}
    >
      {cta}
    </button>
  </div>
);

export default Register;
