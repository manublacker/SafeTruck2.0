import { MapPin } from 'lucide-react'

export default function MapScreen() {
  return (
    <div className="dash-placeholder">
      <div className="dash-placeholder__tag">Próximamente</div>
      <div className="dash-placeholder__icon"><MapPin size={56} /></div>
      <h2 className="dash-placeholder__title">Mapa de la flota</h2>
      <p className="dash-placeholder__text">
        Acá vas a poder ver la posición en tiempo real de todos los camiones de tu empresa,
        sus rutas activas y los incidentes reportados sobre el mapa.
      </p>
    </div>
  )
}
