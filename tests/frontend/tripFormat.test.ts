import { describe, it, expect } from 'vitest'
import {
  STATUS_LABELS,
  statusLabel,
  statusBadgeClass,
  tripSource,
  SOURCE_LABELS,
  durationMinutes,
  formatDuration,
  durationParts,
  distanceParts,
  csvEscape,
  tripDate,
} from '../../frontend/src/lib/tripFormat'

describe('estados', () => {
  it('statusLabel devuelve la etiqueta legible', () => {
    expect(statusLabel('pending')).toBe('Pendiente')
    expect(statusLabel('in_progress')).toBe('En curso')
    expect(statusLabel('completed')).toBe('Completado')
  })

  it('statusLabel cae al valor crudo si es desconocido', () => {
    expect(statusLabel('weird')).toBe('weird')
  })

  it('STATUS_LABELS cubre los 5 estados', () => {
    expect(Object.keys(STATUS_LABELS)).toHaveLength(5)
  })

  it('statusBadgeClass asigna la clase correcta', () => {
    expect(statusBadgeClass('in_progress')).toContain('st-badge-encurso')
    expect(statusBadgeClass('accepted')).toContain('st-badge-aceptado')
    expect(statusBadgeClass('completed')).toContain('st-badge-completado')
    expect(statusBadgeClass('cancelled')).toContain('st-badge-cancelado')
    expect(statusBadgeClass('pending')).toContain('st-badge-pendiente')
  })

  it('statusBadgeClass cae a pendiente para desconocidos', () => {
    expect(statusBadgeClass('xxx')).toContain('st-badge-pendiente')
  })
})

describe('tripSource', () => {
  it('personal cuando trip_source es personal', () => {
    expect(tripSource({ trip_source: 'personal' })).toBe('personal')
  })

  it('company por defecto', () => {
    expect(tripSource({})).toBe('company')
    expect(tripSource({ trip_source: null })).toBe('company')
    expect(tripSource({ trip_source: 'company' })).toBe('company')
    expect(tripSource({ trip_source: 'cualquiera' })).toBe('company')
  })

  it('SOURCE_LABELS', () => {
    expect(SOURCE_LABELS.company).toBe('Empresa')
    expect(SOURCE_LABELS.personal).toBe('Personal')
  })
})

describe('durationMinutes', () => {
  it('usa la duración real (completed - started)', () => {
    expect(
      durationMinutes({
        started_at: '2026-06-28T10:00:00Z',
        completed_at: '2026-06-28T10:45:00Z',
      }),
    ).toBe(45)
  })

  it('redondea los segundos al minuto', () => {
    expect(
      durationMinutes({
        started_at: '2026-06-28T10:00:00Z',
        completed_at: '2026-06-28T10:00:40Z',
      }),
    ).toBe(1)
  })

  it('cae a la duración estimada si no hay timestamps reales', () => {
    expect(durationMinutes({ duration_min: 17 })).toBe(17)
    expect(durationMinutes({ duration_min: 17.6 })).toBe(18)
  })

  it('ignora rangos inválidos (fin antes que inicio)', () => {
    expect(
      durationMinutes({
        started_at: '2026-06-28T11:00:00Z',
        completed_at: '2026-06-28T10:00:00Z',
        duration_min: 30,
      }),
    ).toBe(30) // cae a la estimada
  })

  it('null si no hay nada', () => {
    expect(durationMinutes({})).toBeNull()
  })
})

describe('formatDuration', () => {
  it('minutos solos', () => {
    expect(formatDuration({ duration_min: 45 })).toBe('45 min')
    expect(formatDuration({ duration_min: 2 })).toBe('2 min')
  })

  it('horas justas', () => {
    expect(formatDuration({ duration_min: 60 })).toBe('1 h')
    expect(formatDuration({ duration_min: 120 })).toBe('2 h')
  })

  it('horas y minutos', () => {
    expect(formatDuration({ duration_min: 75 })).toBe('1 h 15 min')
    expect(formatDuration({ duration_min: 135 })).toBe('2 h 15 min')
  })

  it('sin datos → guion', () => {
    expect(formatDuration({})).toBe('—')
  })
})

describe('durationParts', () => {
  it('menos de una hora → min', () => {
    expect(durationParts({ duration_min: 2 })).toEqual({ value: '2', unit: 'min' })
    expect(durationParts({ duration_min: 59 })).toEqual({ value: '59', unit: 'min' })
  })

  it('horas justas → h', () => {
    expect(durationParts({ duration_min: 120 })).toEqual({ value: '2', unit: 'h' })
  })

  it('horas y minutos', () => {
    expect(durationParts({ duration_min: 80 })).toEqual({ value: '1 h 20', unit: 'min' })
  })

  it('sin datos', () => {
    expect(durationParts({})).toEqual({ value: '—', unit: '' })
  })
})

describe('distanceParts', () => {
  it('kilómetros con un decimal', () => {
    expect(distanceParts(20500)).toEqual({ value: '20.5', unit: 'km' })
    expect(distanceParts(1000)).toEqual({ value: '1.0', unit: 'km' })
  })

  it('metros redondeados por debajo de 1 km', () => {
    expect(distanceParts(950)).toEqual({ value: '950', unit: 'm' })
    expect(distanceParts(12.4)).toEqual({ value: '12', unit: 'm' })
  })

  it('null', () => {
    expect(distanceParts(null)).toEqual({ value: '—', unit: '' })
    expect(distanceParts(undefined)).toEqual({ value: '—', unit: '' })
  })
})

describe('csvEscape', () => {
  it('no toca valores simples', () => {
    expect(csvEscape('Santiago')).toBe('Santiago')
    expect(csvEscape('AC-777-AC')).toBe('AC-777-AC')
  })

  it('entrecomilla y escapa cuando hay separador, comillas o saltos', () => {
    expect(csvEscape('Av. Corrientes; 1234')).toBe('"Av. Corrientes; 1234"')
    expect(csvEscape('dijo "hola"')).toBe('"dijo ""hola"""')
    expect(csvEscape('línea1\nlínea2')).toBe('"línea1\nlínea2"')
  })
})

describe('tripDate', () => {
  it('prioriza completed_at', () => {
    const d = tripDate({
      completed_at: '2026-06-28T10:00:00Z',
      started_at: '2026-06-27T10:00:00Z',
      created_at: '2026-06-26T10:00:00Z',
    })
    expect(d?.toISOString()).toBe('2026-06-28T10:00:00.000Z')
  })

  it('cae a started, luego scheduled, luego created', () => {
    expect(tripDate({ started_at: '2026-06-27T10:00:00Z' })?.toISOString()).toBe(
      '2026-06-27T10:00:00.000Z',
    )
    expect(tripDate({ scheduled_at: '2026-06-25T10:00:00Z' })?.toISOString()).toBe(
      '2026-06-25T10:00:00.000Z',
    )
    expect(tripDate({ created_at: '2026-06-24T10:00:00Z' })?.toISOString()).toBe(
      '2026-06-24T10:00:00.000Z',
    )
  })

  it('null si no hay ninguna fecha', () => {
    expect(tripDate({})).toBeNull()
  })

  it('null si la fecha es inválida', () => {
    expect(tripDate({ created_at: 'no-es-fecha' })).toBeNull()
  })
})
