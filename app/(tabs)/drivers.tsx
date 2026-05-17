import { useEffect, useState } from 'react'
import { Plus, X, Trash2, Edit2, Link as LinkIcon, UserX, Copy, Check, KeyRound, AlertTriangle, Users, Map as MapIcon } from 'lucide-react'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import type { Driver, Trip } from '../../src/types'

const BACKEND_URL = 'http://localhost:3001'

type DriverWithStats = Driver & { trip_count: number; last_trip_at: string | null; user_id?: string | null }
type FormState = { full_name: string; email: string; phone: string; license_number: string }
const EMPTY_FORM: FormState = { full_name: '', email: '', phone: '', license_number: '' }

function formatDate(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function initialsOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?'
}

async function getJwt(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

async function apiCall(path: string, options: RequestInit = {}) {
  const jwt = await getJwt()
  if (!jwt) throw new Error('Sesión expirada. Volvé a iniciar sesión.')
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      ...(options.headers || {}),
    },
  })
  let body: any = null
  try { body = await res.json() } catch {}
  if (!res.ok) throw new Error(body?.error || `Error ${res.status}`)
  return body
}

type CredentialsDisplay = { email: string; password: string; title: string; subtitle: string }

function CredentialField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <div className="dash-credential-row">
      <div className="dash-credential-row__label">{label}</div>
      <div className="dash-credential-row__value-box">
        <span className="dash-credential-row__value">{value}</span>
        <button
          type="button"
          onClick={copy}
          className={`dash-credential-row__copy${copied ? ' dash-credential-row__copy--copied' : ''}`}
          title={copied ? 'Copiado' : 'Copiar'}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  )
}

export default function DriversScreen() {
  const profile = useStore(s => s.profile)
  const adminId = profile?.id

  const [drivers, setDrivers] = useState<DriverWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<Driver | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [credentials, setCredentials] = useState<CredentialsDisplay | null>(null)

  const [selectedDriver, setSelectedDriver] = useState<DriverWithStats | null>(null)
  const [driverTrips, setDriverTrips] = useState<Trip[]>([])
  const [unassignedTrips, setUnassignedTrips] = useState<Trip[]>([])
  const [tripsLoading, setTripsLoading] = useState(false)

  useEffect(() => { if (adminId) loadDrivers() }, [adminId])

  const loadDrivers = async () => {
    if (!adminId) return
    setLoading(true); setError(null)
    const { data: rows, error: err } = await supabase
      .from('st_drivers')
      .select('*')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false })
    if (err) { setError(err.message); setLoading(false); return }

    const ids = (rows || []).map(r => r.id)
    let counts: Record<string, { count: number; last: string | null }> = {}
    if (ids.length > 0) {
      const { data: trips } = await supabase
        .from('st_trips')
        .select('driver_id, created_at')
        .in('driver_id', ids)
      ;(trips || []).forEach((t: any) => {
        const c = counts[t.driver_id] || { count: 0, last: null }
        c.count += 1
        if (!c.last || t.created_at > c.last) c.last = t.created_at
        counts[t.driver_id] = c
      })
    }

    setDrivers((rows || []).map((d: any) => ({
      ...d,
      trip_count: counts[d.id]?.count || 0,
      last_trip_at: counts[d.id]?.last || null,
    })))
    setLoading(false)
  }

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setFormErr(null); setShowForm(true) }
  const openEdit = (d: Driver) => {
    setEditing(d)
    setForm({
      full_name: d.full_name || '',
      email: d.email || '',
      phone: d.phone || '',
      license_number: d.license_number || '',
    })
    setFormErr(null); setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); setFormErr(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adminId) return
    if (!form.full_name.trim()) { setFormErr('El nombre es obligatorio.'); return }
    setSaving(true); setFormErr(null)
    try {
      if (editing) {
        // Edición: usar Supabase directo (no cambia credenciales)
        const { error: err } = await supabase
          .from('st_drivers')
          .update({
            full_name: form.full_name.trim(),
            phone: form.phone.trim() || null,
            license_number: form.license_number.trim() || null,
          })
          .eq('id', editing.id)
        if (err) throw new Error(err.message)
        closeForm()
        loadDrivers()
      } else {
        // Creación: pasa por el backend para generar credenciales
        const res = await apiCall('/admin/drivers', {
          method: 'POST',
          body: JSON.stringify({
            full_name: form.full_name.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            license_number: form.license_number.trim() || undefined,
          }),
        })
        closeForm()
        setCredentials({
          email: res.credentials.email,
          password: res.credentials.password,
          title: 'Conductor creado',
          subtitle: `Estas credenciales quedan asociadas a ${form.full_name.trim()} y se van a usar cuando esté la app mobile. Hoy todavía no permiten ingresar a ningún lado.`,
        })
        loadDrivers()
      }
    } catch (e: any) {
      setFormErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (d: Driver) => {
    if (!confirm(`¿Eliminar a ${d.full_name}? Se borrará su cuenta de acceso y los viajes que tenga asignados van a quedar sin conductor.`)) return
    try {
      await apiCall(`/admin/drivers/${d.id}`, { method: 'DELETE' })
      loadDrivers()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const resetPassword = async (d: Driver) => {
    if (!confirm(`¿Generar una contraseña nueva para ${d.full_name}? La actual va a dejar de funcionar.`)) return
    try {
      const res = await apiCall(`/admin/drivers/${d.id}/reset-password`, { method: 'POST' })
      setCredentials({
        email: res.credentials.email,
        password: res.credentials.password,
        title: 'Contraseña regenerada',
        subtitle: `Nueva contraseña para ${d.full_name}. La anterior queda invalidada (servirá cuando la app mobile esté lista).`,
      })
    } catch (e: any) {
      alert(e.message)
    }
  }

  const openDriver = async (driver: DriverWithStats) => {
    if (!adminId) return
    setSelectedDriver(driver)
    setTripsLoading(true)
    const [{ data: assigned }, { data: unassigned }] = await Promise.all([
      supabase.from('st_trips').select('*').eq('driver_id', driver.id).order('created_at', { ascending: false }),
      supabase.from('st_trips').select('*').eq('admin_id', adminId).is('driver_id', null).order('created_at', { ascending: false }),
    ])
    setDriverTrips((assigned as Trip[]) || [])
    setUnassignedTrips((unassigned as Trip[]) || [])
    setTripsLoading(false)
  }

  const closeDriverModal = () => { setSelectedDriver(null); setDriverTrips([]); setUnassignedTrips([]) }

  const assignTrip = async (tripId: string) => {
    if (!selectedDriver) return
    const { error: err } = await supabase.from('st_trips').update({ driver_id: selectedDriver.id }).eq('id', tripId)
    if (err) { alert(err.message); return }
    openDriver(selectedDriver)
    loadDrivers()
  }

  const unassignTrip = async (tripId: string) => {
    const { error: err } = await supabase.from('st_trips').update({ driver_id: null }).eq('id', tripId)
    if (err) { alert(err.message); return }
    if (selectedDriver) openDriver(selectedDriver)
    loadDrivers()
  }

  return (
    <>
      <div className="dash-section-header">
        <div>
          <div className="dash-section-header__title">{drivers.length} conductor{drivers.length !== 1 ? 'es' : ''}</div>
          <div className="dash-section-header__subtitle">Las credenciales generadas quedan guardadas hasta que la app mobile esté lista.</div>
        </div>
        <button className="dash-btn dash-btn--primary" onClick={openNew}>
          <Plus size={16} /> Agregar conductor
        </button>
      </div>

      {error && <div className="dash-banner-error">{error}</div>}

      {loading ? (
        <div className="dash-empty"><span className="dash-spinner" /></div>
      ) : drivers.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty__icon"><Users size={28} /></div>
          <div className="dash-empty__title">Todavía no agregaste conductores</div>
          <div className="dash-empty__text">Hacé clic en "Agregar conductor" para registrar el primero.</div>
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th style={{ width: '35%' }}>Conductor</th>
                <th>Contacto</th>
                <th>Licencia</th>
                <th>Viajes</th>
                <th>Último viaje</th>
                <th style={{ width: 130 }}></th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.id} className="dash-table__row--clickable" onClick={() => openDriver(d)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="dash-driver-avatar">{initialsOf(d.full_name)}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{d.full_name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--dash-text-soft)' }}>{d.email || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--dash-text-muted)' }}>{d.phone || '—'}</td>
                  <td style={{ color: 'var(--dash-text-muted)' }}>{d.license_number || '—'}</td>
                  <td><span className="dash-badge">{d.trip_count}</span></td>
                  <td style={{ color: 'var(--dash-text-muted)' }}>{d.last_trip_at ? formatDate(d.last_trip_at) : '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="dash-row-actions">
                      <button className="dash-icon-btn" title="Regenerar contraseña" onClick={() => resetPassword(d)} disabled={!d.user_id}>
                        <KeyRound size={14} />
                      </button>
                      <button className="dash-icon-btn" title="Editar" onClick={() => openEdit(d)}><Edit2 size={14} /></button>
                      <button className="dash-icon-btn dash-icon-btn--danger" title="Eliminar" onClick={() => remove(d)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form conductor */}
      {showForm && (
        <div className="dash-modal-overlay" onClick={closeForm}>
          <div className="dash-modal" onClick={e => e.stopPropagation()}>
            <div className="dash-modal__header">
              <div>
                <h3 className="dash-modal__title">{editing ? 'Editar conductor' : 'Nuevo conductor'}</h3>
                <div className="dash-modal__subtitle">
                  {editing ? 'Actualizá los datos del chofer.' : 'Vamos a generar credenciales y guardarlas para la futura app mobile.'}
                </div>
              </div>
              <button className="dash-modal__close" onClick={closeForm}><X size={20} /></button>
            </div>
            <form className="dash-modal__body" onSubmit={submit}>
              <div className="dash-form">
                {formErr && <div className="dash-banner-error">{formErr}</div>}
                <div className="dash-form__field">
                  <label className="dash-form__label dash-form__label--req">Nombre completo</label>
                  <input className="dash-form__input" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Juan Pérez" />
                </div>
                <div className="dash-form__row">
                  <div className="dash-form__field">
                    <label className="dash-form__label">Email {editing ? '' : '(opcional)'}</label>
                    <input
                      className="dash-form__input"
                      type="email"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder={editing ? '' : 'Si no ponés, generamos uno automático'}
                      disabled={!!editing}
                    />
                    {editing && (
                      <div className="dash-form__error" style={{ color: 'var(--dash-text-soft)' }}>
                        El email no se puede cambiar acá. Eliminá y volvé a crear si necesitás cambiarlo.
                      </div>
                    )}
                  </div>
                  <div className="dash-form__field">
                    <label className="dash-form__label">Teléfono</label>
                    <input className="dash-form__input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+54 11 1234-5678" />
                  </div>
                </div>
                <div className="dash-form__field">
                  <label className="dash-form__label">Nº de licencia</label>
                  <input className="dash-form__input" value={form.license_number} onChange={e => setForm({ ...form, license_number: e.target.value })} placeholder="B1-12345678" />
                </div>
                <div className="dash-form__actions">
                  <button type="button" className="dash-btn dash-btn--ghost" onClick={closeForm}>Cancelar</button>
                  <button type="submit" className="dash-btn dash-btn--primary" disabled={saving}>
                    {saving ? 'Guardando…' : (editing ? 'Guardar cambios' : 'Crear conductor')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal con credenciales */}
      {credentials && (
        <div className="dash-modal-overlay" onClick={() => setCredentials(null)}>
          <div className="dash-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="dash-modal__header">
              <div>
                <h3 className="dash-modal__title">{credentials.title}</h3>
                <div className="dash-modal__subtitle">{credentials.subtitle}</div>
              </div>
              <button className="dash-modal__close" onClick={() => setCredentials(null)}><X size={20} /></button>
            </div>
            <div className="dash-modal__body">
              <div className="dash-credentials">
                <CredentialField label="Email / Usuario" value={credentials.email} />
                <CredentialField label="Contraseña" value={credentials.password} />
              </div>
              <div className="dash-credentials-warning">
                <AlertTriangle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                <span>Estas credenciales quedan guardadas en la base de datos pero todavía no permiten ingresar a ningún sistema. Se van a activar cuando esté lista la app mobile para conductores.</span>
              </div>
              <div className="dash-form__actions" style={{ marginTop: '1rem' }}>
                <button type="button" className="dash-btn dash-btn--primary" onClick={() => setCredentials(null)}>Listo</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal con viajes del conductor */}
      {selectedDriver && (
        <div className="dash-modal-overlay" onClick={closeDriverModal}>
          <div className="dash-modal dash-modal--wide" onClick={e => e.stopPropagation()}>
            <div className="dash-modal__header">
              <div>
                <h3 className="dash-modal__title">{selectedDriver.full_name}</h3>
                <div className="dash-modal__subtitle">{selectedDriver.email || 'Sin email'}{selectedDriver.phone ? ` · ${selectedDriver.phone}` : ''}</div>
              </div>
              <button className="dash-modal__close" onClick={closeDriverModal}><X size={20} /></button>
            </div>
            <div className="dash-modal__body">
              {tripsLoading ? (
                <div className="dash-empty"><span className="dash-spinner" /></div>
              ) : (
                <>
                  <div className="dash-section-header">
                    <div className="dash-section-header__title">Viajes asignados ({driverTrips.length})</div>
                  </div>
                  {driverTrips.length === 0 ? (
                    <div className="dash-empty" style={{ padding: '1.5rem' }}>
                      <div className="dash-empty__text">Este conductor no tiene viajes asignados.</div>
                    </div>
                  ) : (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Origen → Destino</th>
                          <th>Estado</th>
                          <th style={{ width: 50 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {driverTrips.map(t => (
                          <tr key={t.id}>
                            <td style={{ color: 'var(--dash-text-muted)', fontSize: '0.85rem' }}>{formatDate(t.created_at)}</td>
                            <td style={{ fontSize: '0.85rem' }}>
                              <div>{t.origin_address || '—'}</div>
                              <div style={{ color: 'var(--dash-text-soft)' }}>↓ {t.destination_address || '—'}</div>
                            </td>
                            <td><span className={`dash-badge${t.status === 'completed' ? ' dash-badge--success' : t.status === 'pending' ? ' dash-badge--warning' : ''}`}>{t.status}</span></td>
                            <td>
                              <button className="dash-icon-btn dash-icon-btn--danger" title="Desasignar" onClick={() => unassignTrip(t.id)}>
                                <UserX size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="dash-section-header" style={{ marginTop: '1.5rem' }}>
                    <div className="dash-section-header__title">Asignar nuevo viaje</div>
                    <div className="dash-section-header__subtitle">{unassignedTrips.length} sin conductor</div>
                  </div>
                  {unassignedTrips.length === 0 ? (
                    <div className="dash-empty" style={{ padding: '1.5rem' }}>
                      <div className="dash-empty__text">No hay viajes sin conductor. Creá uno desde "Viajes".</div>
                    </div>
                  ) : (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Origen → Destino</th>
                          <th style={{ width: 100 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {unassignedTrips.map(t => (
                          <tr key={t.id}>
                            <td style={{ color: 'var(--dash-text-muted)', fontSize: '0.85rem' }}>{formatDate(t.created_at)}</td>
                            <td style={{ fontSize: '0.85rem' }}>
                              <div>{t.origin_address || '—'}</div>
                              <div style={{ color: 'var(--dash-text-soft)' }}>↓ {t.destination_address || '—'}</div>
                            </td>
                            <td>
                              <button className="dash-btn dash-btn--ghost" style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem' }} onClick={() => assignTrip(t.id)}>
                                <LinkIcon size={13} /> Asignar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
