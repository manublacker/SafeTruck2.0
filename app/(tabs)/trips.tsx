import { useEffect, useState } from 'react'
import { Plus, X, Trash2, Edit2, MapPin, Truck } from 'lucide-react'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import AddressAutocomplete, { type AddressSelection } from '../../src/components/AddressAutocomplete'
import type { Driver, Trip } from '../../src/types'

const STATUS_OPTIONS: Array<{ value: Trip['status']; label: string }> = [
  { value: 'pending',     label: 'Pendiente' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed',   label: 'Completado' },
  { value: 'cancelled',   label: 'Cancelado' },
]

type Coords = { lat: number; lng: number } | null

type FormState = {
  origin_address: string
  origin_coords: Coords
  destination_address: string
  destination_coords: Coords
  scheduled_at: string
  driver_id: string
}

const EMPTY_FORM: FormState = {
  origin_address: '',
  origin_coords: null,
  destination_address: '',
  destination_coords: null,
  scheduled_at: '',
  driver_id: '',
}

function parsePoint(p: any): Coords {
  if (!p) return null
  if (typeof p === 'object' && Array.isArray(p.coordinates)) {
    return { lng: p.coordinates[0], lat: p.coordinates[1] }
  }
  if (typeof p === 'string') {
    const m = p.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i)
    if (m) return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) }
  }
  return null
}


function formatDate(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function statusBadgeClass(status: Trip['status']) {
  if (status === 'completed') return 'dash-badge dash-badge--success'
  if (status === 'in_progress') return 'dash-badge dash-badge--accent'
  if (status === 'cancelled') return 'dash-badge dash-badge--danger'
  return 'dash-badge dash-badge--warning'
}

function statusLabel(status: Trip['status']) {
  return STATUS_OPTIONS.find(o => o.value === status)?.label || status
}

export default function TripsScreen() {
  const profile = useStore(s => s.profile)
  const adminId = profile?.id

  const [trips, setTrips] = useState<Trip[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Trip | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [filter, setFilter] = useState<'all' | 'unassigned' | Trip['status']>('all')

  useEffect(() => { if (adminId) loadAll() }, [adminId])

  const loadAll = async () => {
    if (!adminId) return
    setLoading(true); setError(null)
    const [{ data: ts, error: et }, { data: ds, error: ed }] = await Promise.all([
      supabase.from('st_trips').select('*').eq('admin_id', adminId).order('created_at', { ascending: false }),
      supabase.from('st_drivers').select('*').eq('admin_id', adminId).order('full_name'),
    ])
    if (et) setError(et.message)
    else if (ed) setError(ed.message)
    setTrips((ts as Trip[]) || [])
    setDrivers((ds as Driver[]) || [])
    setLoading(false)
  }

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setFormErr(null); setShowForm(true) }
  const openEdit = (t: Trip) => {
    setEditing(t)
    setForm({
      origin_address: t.origin_address || '',
      origin_coords: parsePoint((t as any).origin),
      destination_address: t.destination_address || '',
      destination_coords: parsePoint((t as any).destination),
      scheduled_at: t.scheduled_at ? t.scheduled_at.slice(0, 16) : '',
      driver_id: t.driver_id || '',
    })
    setFormErr(null); setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); setFormErr(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adminId) return
    if (!form.origin_address.trim() || !form.destination_address.trim()) {
      setFormErr('Origen y destino son obligatorios.'); return
    }
    setSaving(true); setFormErr(null)

    const payload: any = {
      admin_id: adminId,
      origin_address: form.origin_address.trim(),
      destination_address: form.destination_address.trim(),
      origin: form.origin_coords ? `SRID=4326;POINT(${form.origin_coords.lng} ${form.origin_coords.lat})` : null,
      destination: form.destination_coords ? `SRID=4326;POINT(${form.destination_coords.lng} ${form.destination_coords.lat})` : null,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      driver_id: form.driver_id || null,
    }
    const { error: err } = editing
      ? await supabase.from('st_trips').update(payload).eq('id', editing.id)
      : await supabase.from('st_trips').insert(payload)
    if (err) { setFormErr(err.message); setSaving(false); return }
    closeForm(); setSaving(false); loadAll()
  }

  const remove = async (t: Trip) => {
    if (!confirm('¿Eliminar este viaje? Esta acción no se puede deshacer.')) return
    const { error: err } = await supabase.from('st_trips').delete().eq('id', t.id)
    if (err) { alert(err.message); return }
    loadAll()
  }

  const reassign = async (tripId: string, driverId: string) => {
    const { error: err } = await supabase.from('st_trips').update({ driver_id: driverId || null }).eq('id', tripId)
    if (err) { alert(err.message); return }
    loadAll()
  }

  const driverName = (id?: string | null) => {
    if (!id) return null
    return drivers.find(d => d.id === id)?.full_name || '—'
  }

  const visibleTrips = trips.filter(t => {
    if (filter === 'all') return true
    if (filter === 'unassigned') return !t.driver_id
    return t.status === filter
  })

  const countByStatus = (s: Trip['status']) => trips.filter(t => t.status === s).length
  const unassignedCount = trips.filter(t => !t.driver_id).length

  return (
    <>
      <div className="dash-section-header">
        <div>
          <div className="dash-section-header__title">{trips.length} viaje{trips.length !== 1 ? 's' : ''}</div>
          <div className="dash-section-header__subtitle">Programá y asigná los viajes de tu flota.</div>
        </div>
        <button className="dash-btn dash-btn--primary" onClick={openNew}>
          <Plus size={16} /> Agregar viaje
        </button>
      </div>

      {error && <div className="dash-banner-error">{error}</div>}

      <div className="dash-filters">
        <button className={`dash-filter-chip${filter === 'all' ? ' dash-filter-chip--active' : ''}`} onClick={() => setFilter('all')}>
          Todos ({trips.length})
        </button>
        <button className={`dash-filter-chip${filter === 'unassigned' ? ' dash-filter-chip--active' : ''}`} onClick={() => setFilter('unassigned')}>
          Sin asignar ({unassignedCount})
        </button>
        {STATUS_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`dash-filter-chip${filter === opt.value ? ' dash-filter-chip--active' : ''}`}
            onClick={() => setFilter(opt.value)}
          >
            {opt.label} ({countByStatus(opt.value)})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="dash-empty"><span className="dash-spinner" /></div>
      ) : visibleTrips.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty__icon"><Truck size={28} /></div>
          <div className="dash-empty__title">{trips.length === 0 ? 'Todavía no agregaste viajes' : 'No hay viajes con este filtro'}</div>
          <div className="dash-empty__text">{trips.length === 0 ? 'Hacé clic en "Agregar viaje" para crear el primero.' : 'Probá cambiar el filtro.'}</div>
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Origen → Destino</th>
                <th>Conductor</th>
                <th>Distancia</th>
                <th>Duración</th>
                <th>Estado</th>
                <th>Programado</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleTrips.map(t => (
                <tr key={t.id}>
                  <td style={{ fontSize: '0.88rem' }}>
                    <div style={{ fontWeight: 500 }}>{t.origin_address || '—'}</div>
                    <div style={{ color: 'var(--dash-text-soft)' }}>↓ {t.destination_address || '—'}</div>
                  </td>
                  <td>
                    <select
                      className="dash-inline-select"
                      value={t.driver_id || ''}
                      onChange={e => reassign(t.id, e.target.value)}
                    >
                      <option value="">Sin asignar</option>
                      {drivers.map(d => (
                        <option key={d.id} value={d.id}>{d.full_name}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ color: 'var(--dash-text-muted)' }}>{t.distance_km != null ? `${t.distance_km} km` : '—'}</td>
                  <td style={{ color: 'var(--dash-text-muted)' }}>{t.duration_min != null ? `${t.duration_min} min` : '—'}</td>
                  <td><span className={statusBadgeClass(t.status)}>{statusLabel(t.status)}</span></td>
                  <td style={{ color: 'var(--dash-text-muted)', fontSize: '0.85rem' }}>{formatDate(t.scheduled_at) !== '—' ? formatDate(t.scheduled_at) : <span style={{ color: 'var(--dash-text-soft)' }}>—</span>}</td>
                  <td>
                    <div className="dash-row-actions">
                      <button className="dash-icon-btn" title="Editar" onClick={() => openEdit(t)}><Edit2 size={14} /></button>
                      <button className="dash-icon-btn dash-icon-btn--danger" title="Eliminar" onClick={() => remove(t)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="dash-modal-overlay" onClick={closeForm}>
          <div className="dash-modal" onClick={e => e.stopPropagation()}>
            <div className="dash-modal__header">
              <div>
                <h3 className="dash-modal__title">{editing ? 'Editar viaje' : 'Nuevo viaje'}</h3>
                <div className="dash-modal__subtitle">Datos básicos del viaje.</div>
              </div>
              <button className="dash-modal__close" onClick={closeForm}><X size={20} /></button>
            </div>
            <form className="dash-modal__body" onSubmit={submit}>
              <div className="dash-form">
                {formErr && <div className="dash-banner-error">{formErr}</div>}
                <div className="dash-form__field">
                  <label className="dash-form__label dash-form__label--req">Origen</label>
                  <AddressAutocomplete
                    value={form.origin_address}
                    onChange={sel => setForm(f => ({
                      ...f,
                      origin_address: sel.address,
                      origin_coords: sel.lat != null && sel.lng != null ? { lat: sel.lat, lng: sel.lng } : null,
                    }))}
                    placeholder="Empezá a escribir una dirección…"
                  />
                  {form.origin_coords && (
                    <span className="dash-coord-hint dash-coord-hint--ok">
                      <MapPin size={12} />
                      {form.origin_coords.lat.toFixed(4)}, {form.origin_coords.lng.toFixed(4)}
                    </span>
                  )}
                </div>
                <div className="dash-form__field">
                  <label className="dash-form__label dash-form__label--req">Destino</label>
                  <AddressAutocomplete
                    value={form.destination_address}
                    onChange={sel => setForm(f => ({
                      ...f,
                      destination_address: sel.address,
                      destination_coords: sel.lat != null && sel.lng != null ? { lat: sel.lat, lng: sel.lng } : null,
                    }))}
                    placeholder="Empezá a escribir una dirección…"
                  />
                  {form.destination_coords && (
                    <span className="dash-coord-hint dash-coord-hint--ok">
                      <MapPin size={12} />
                      {form.destination_coords.lat.toFixed(4)}, {form.destination_coords.lng.toFixed(4)}
                    </span>
                  )}
                </div>
                <div className="dash-form__row">
                  <div className="dash-form__field">
                    <label className="dash-form__label">Fecha programada</label>
                    <input className="dash-form__input" type="datetime-local" value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} />
                  </div>
                  <div className="dash-form__field">
                    <label className="dash-form__label">Conductor</label>
                    <select className="dash-form__select" value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })}>
                      <option value="">Sin asignar</option>
                      {drivers.map(d => (<option key={d.id} value={d.id}>{d.full_name}</option>))}
                    </select>
                    {drivers.length === 0 && (
                      <div className="dash-form__error" style={{ color: 'var(--dash-text-soft)' }}>
                        Podés crearlo sin asignar y asignarlo después.
                      </div>
                    )}
                  </div>
                </div>
                <div className="dash-form__actions">
                  <button type="button" className="dash-btn dash-btn--ghost" onClick={closeForm}>Cancelar</button>
                  <button type="submit" className="dash-btn dash-btn--primary" disabled={saving}>
                    {saving ? 'Guardando…' : (editing ? 'Guardar cambios' : 'Crear viaje')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
