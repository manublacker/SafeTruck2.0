import { useState, useEffect } from 'react'
import { CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'

const INCIDENT_LABELS: Record<string, string> = {
  fine: 'Multa a camión',
  police_check: 'Control policial',
  accident: 'Accidente',
  road_work: 'Obras',
  low_bridge: 'Puente bajo',
  road_closed: 'Calle cerrada',
  weight_check: 'Control de peso',
  other: 'Otro',
}

const INCIDENT_COLORS: Record<string, string> = {
  fine: '#dc2626',
  police_check: '#f59e0b',
  accident: '#dc2626',
  road_work: '#f59e0b',
  low_bridge: '#dc2626',
  road_closed: '#dc2626',
  weight_check: '#f59e0b',
  other: '#9ca3af',
}

const FILTERS = ['fine', 'accident', 'police_check', 'road_work', 'low_bridge', 'road_closed']

type Incident = {
  id: string
  incident_type: string
  description?: string
  created_at: string
  expires_at: string
  upvotes?: number
  downvotes?: number
  user_id?: string
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'recién'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs} h`
  const days = Math.floor(hrs / 24)
  return `hace ${days} d`
}

function timeUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'expirado'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `expira en ${mins} min`
  const hrs = Math.floor(mins / 60)
  return `expira en ${hrs} h`
}

export default function IncidentsScreen() {
  const profile = useStore(s => s.profile)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => {
    loadIncidents()
    const sub = supabase
      .channel('incidents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'st_incidents' }, () => loadIncidents())
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [])

  const loadIncidents = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('st_incidents')
      .select('*')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    setIncidents((data as Incident[]) || [])
    setLoading(false)
  }

  const vote = async (incidentId: string, voteValue: number) => {
    if (!profile) return
    await supabase.from('st_incident_votes').upsert({
      user_id: profile.id,
      incident_id: incidentId,
      vote: voteValue,
    })
    loadIncidents()
  }

  const deactivate = async (incidentId: string) => {
    if (!confirm('¿Marcar este incidente como resuelto?')) return
    await supabase.from('st_incidents').update({ is_active: false }).eq('id', incidentId)
    loadIncidents()
  }

  const filtered = filter ? incidents.filter(i => i.incident_type === filter) : incidents

  return (
    <>
      <div className="dash-filters">
        <button
          className={`dash-filter-chip${!filter ? ' dash-filter-chip--active' : ''}`}
          onClick={() => setFilter(null)}
        >
          Todos ({incidents.length})
        </button>
        {FILTERS.map(f => {
          const count = incidents.filter(i => i.incident_type === f).length
          return (
            <button
              key={f}
              className={`dash-filter-chip${filter === f ? ' dash-filter-chip--active' : ''}`}
              onClick={() => setFilter(filter === f ? null : f)}
            >
              {INCIDENT_LABELS[f]} {count > 0 ? `(${count})` : ''}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="dash-empty"><span className="dash-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty__icon"><CheckCircle2 size={28} /></div>
          <div className="dash-empty__title">No hay alertas activas</div>
          <div className="dash-empty__text">
            {filter ? 'Probá quitar el filtro para ver otros tipos de incidente.' : 'Cuando un conductor reporte algo, va a aparecer acá.'}
          </div>
        </div>
      ) : (
        <div className="dash-incident-list">
          {filtered.map(item => (
            <div key={item.id} className="dash-incident-card">
              <div
                className="dash-incident-card__accent"
                style={{ background: INCIDENT_COLORS[item.incident_type] || '#9ca3af' }}
              />
              <div className="dash-incident-card__body">
                <div className="dash-incident-card__header">
                  <div className="dash-incident-card__type">
                    <span
                      className="dash-incident-card__type-dot"
                      style={{ background: INCIDENT_COLORS[item.incident_type] || '#9ca3af' }}
                    />
                    {INCIDENT_LABELS[item.incident_type] || 'Incidente'}
                  </div>
                  <div className="dash-incident-card__time">{timeAgo(item.created_at)}</div>
                </div>
                {item.description && (
                  <div className="dash-incident-card__desc">{item.description}</div>
                )}
                <div className="dash-incident-card__footer">
                  <div className="dash-incident-card__expiry">{timeUntil(item.expires_at)}</div>
                  <div className="dash-incident-card__votes">
                    <button className="dash-vote-btn" onClick={() => vote(item.id, 1)}>
                      <ThumbsUp size={13} /> {item.upvotes || 0}
                    </button>
                    <button className="dash-vote-btn" onClick={() => vote(item.id, -1)}>
                      <ThumbsDown size={13} /> {item.downvotes || 0}
                    </button>
                    {item.user_id === profile?.id && (
                      <button
                        className="dash-vote-btn"
                        style={{ color: '#dc2626' }}
                        onClick={() => deactivate(item.id)}
                      >
                        Resolver
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
