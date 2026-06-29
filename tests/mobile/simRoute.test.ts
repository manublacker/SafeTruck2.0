import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  bearingDeg,
  flattenSegments,
  splitSegmentsByProgress,
  type Segment,
} from '../../src/lib/simRoute'

describe('haversineMeters', () => {
  it('distancia 0 para el mismo punto', () => {
    expect(haversineMeters([-34.6, -58.4], [-34.6, -58.4])).toBe(0)
  })

  it('un grado de latitud ≈ 111 km', () => {
    const d = haversineMeters([0, 0], [1, 0])
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_400)
  })

  it('es simétrica (a→b == b→a)', () => {
    const a: [number, number] = [-34.60, -58.38]
    const b: [number, number] = [-34.57, -58.46]
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })

  it('distancia corta razonable (~100 m)', () => {
    // ~0.001 grados de longitud en el ecuador ≈ 111 m
    const d = haversineMeters([0, 0], [0, 0.001])
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(120)
  })
})

describe('bearingDeg', () => {
  it('norte = 0°', () => {
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(0, 5)
  })

  it('este = 90°', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(90, 5)
  })

  it('sur = 180°', () => {
    expect(bearingDeg([1, 0], [0, 0])).toBeCloseTo(180, 5)
  })

  it('oeste = 270°', () => {
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(270, 5)
  })

  it('siempre en el rango [0, 360)', () => {
    const b = bearingDeg([-34.6, -58.4], [-34.61, -58.41])
    expect(b).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThan(360)
  })
})

describe('flattenSegments', () => {
  it('concatena los puntos en orden', () => {
    const segs: Segment[] = [
      { coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] },
      { coordinates: [{ lat: 0, lng: 1 }, { lat: 0, lng: 2 }] },
    ]
    expect(flattenSegments(segs)).toEqual([
      [0, 0],
      [0, 1],
      [0, 1], // punto de borde duplicado (fin de seg1 = inicio de seg2)
      [0, 2],
    ])
  })

  it('lista vacía → path vacío', () => {
    expect(flattenSegments([])).toEqual([])
  })
})

describe('splitSegmentsByProgress', () => {
  it('sin progreso: todo queda como "restante", nada en gris', () => {
    const segs: Segment[] = [{ coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] }]
    const { passed, remaining } = splitSegmentsByProgress(segs, null)
    expect(passed).toEqual([])
    expect(remaining).toBe(segs)
  })

  it('a mitad de un segmento: el gris llega EXACTO a la posición del camión', () => {
    const segs: Segment[] = [
      { coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }] },
    ]
    // idx 1 = borde entre el punto 1 (lng 1) y el 2 (lng 2); frac 0.5 → lng 1.5
    const { passed } = splitSegmentsByProgress(segs, { idx: 1, frac: 0.5 })
    expect(passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 1.5 }, // posición interpolada del camión
    ])
  })

  it('cruzando segmentos: el gris NO se adelanta (regresión del bug del contador)', () => {
    // Dos segmentos sobre el ecuador: A→B y B→C. El path plano es [A,B,B,C].
    const segs: Segment[] = [
      { coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], status: 'ok' },
      { coordinates: [{ lat: 0, lng: 1 }, { lat: 0, lng: 2 }], status: 'unauthorized' },
    ]
    // idx 2 = primer punto del 2º segmento (B), frac 0.5 → camión en lng 1.5
    const { passed, remaining } = splitSegmentsByProgress(segs, { idx: 2, frac: 0.5 })

    // El gris cubre todo el 1er segmento + hasta el camión, y termina EN el camión.
    expect(passed[passed.length - 1]).toEqual({ latitude: 0, longitude: 1.5 })
    // No se pasa de 1.5 (no se adelanta).
    for (const p of passed) expect(p.longitude).toBeLessThanOrEqual(1.5)

    // Lo restante arranca en la posición del camión y mantiene el color del tramo.
    expect(remaining[0].coordinates[0]).toEqual({ lat: 0, lng: 1.5 })
    expect(remaining[0].status).toBe('unauthorized')
  })

  it('preserva el status de cada tramo restante', () => {
    const segs: Segment[] = [
      { coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }], status: 'unknown' },
    ]
    const { remaining } = splitSegmentsByProgress(segs, { idx: 0, frac: 0.5 })
    expect(remaining[0].status).toBe('unknown')
  })
})
