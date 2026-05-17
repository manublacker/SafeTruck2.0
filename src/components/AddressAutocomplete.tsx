import { useEffect, useRef, useState } from 'react'
import { MapPin, Loader2 } from 'lucide-react'

export type AddressSelection = { address: string; lat: number; lng: number }

type Props = {
  value: string
  onChange: (selection: AddressSelection | { address: string; lat: null; lng: null }) => void
  placeholder?: string
  countryCodes?: string
  language?: string
  required?: boolean
  disabled?: boolean
}

type Suggestion = {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const DEBOUNCE_MS = 350
const MIN_QUERY_LENGTH = 3

export default function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  countryCodes = 'ar',
  language = 'es',
  required,
  disabled,
}: Props) {
  const [query, setQuery] = useState(value)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastSelectedRef = useRef<string>(value)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (query === lastSelectedRef.current) return
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      setLoading(false)
      return
    }
    const handle = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=0&countrycodes=${countryCodes}&accept-language=${language}`
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'Accept': 'application/json' },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: Suggestion[] = await res.json()
        setSuggestions(data)
        setOpen(true)
        setHighlighted(0)
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setSuggestions([])
        }
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [query, countryCodes, language])

  const select = (s: Suggestion) => {
    const lat = parseFloat(s.lat)
    const lng = parseFloat(s.lon)
    lastSelectedRef.current = s.display_name
    setQuery(s.display_name)
    setOpen(false)
    setSuggestions([])
    onChange({ address: s.display_name, lat, lng })
  }

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    // Si el usuario edita después de elegir, las coords dejan de ser válidas
    onChange({ address: v, lat: null, lng: null })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(suggestions[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="dash-autocomplete" ref={containerRef}>
      <div className="dash-autocomplete__input-wrap">
        <input
          className="dash-form__input"
          type="text"
          value={query}
          onChange={onInput}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete="off"
        />
        {loading && <Loader2 size={16} className="dash-autocomplete__spinner" />}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="dash-autocomplete__list">
          {suggestions.map((s, idx) => (
            <li
              key={s.place_id}
              className={`dash-autocomplete__item${idx === highlighted ? ' dash-autocomplete__item--active' : ''}`}
              onMouseDown={e => { e.preventDefault(); select(s) }}
              onMouseEnter={() => setHighlighted(idx)}
            >
              <MapPin size={14} className="dash-autocomplete__icon" />
              <span className="dash-autocomplete__text">{s.display_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
