/**
 * Tests EXHAUSTIVOS de la geometría pura de `src/lib/simRoute.ts`, foco en las
 * propiedades geométricas de `haversineMeters` y `bearingDeg`. Se usan
 * coordenadas reales del AMBA (Área Metropolitana de Buenos Aires) para que los
 * casos sean realistas, y `toBeCloseTo` allí donde hay floats.
 */
import { haversineMeters, bearingDeg, type LatLng } from '../../src/lib/simRoute'

// Metros por grado (de latitud) con R = 6371000. Aprox. 111195 m.
const M_PER_DEG = (6371000 * Math.PI) / 180

// ---------------------------------------------------------------------------
// Puntos de referencia reales del AMBA (lat, lng).
// ---------------------------------------------------------------------------
const OBELISCO: LatLng = [-34.6037, -58.3816]
const CONGRESO: LatLng = [-34.6099, -58.3921]
const CASA_ROSADA: LatLng = [-34.608, -58.3703]
const RETIRO: LatLng = [-34.5924, -58.3745]
const LA_PLATA: LatLng = [-34.9215, -57.9545]
const EZEIZA: LatLng = [-34.812, -58.5348]
const TIGRE: LatLng = [-34.426, -58.5796]
const ORIGEN: LatLng = [0, 0]

describe('simRoute — haversineMeters (propiedades geométricas)', () => {
  describe('identidad y distancia nula', () => {
    it('distancia cero de un punto a sí mismo (ecuador)', () => {
      expect(haversineMeters([0, 0], [0, 0])).toBe(0)
    })

    it('distancia cero de un punto a sí mismo (Obelisco)', () => {
      expect(haversineMeters(OBELISCO, OBELISCO)).toBe(0)
    })

    it.each<[string, LatLng]>([
      ['Congreso', CONGRESO],
      ['Casa Rosada', CASA_ROSADA],
      ['Retiro', RETIRO],
      ['La Plata', LA_PLATA],
      ['Ezeiza', EZEIZA],
      ['Tigre', TIGRE],
      ['polo norte', [90, 0]],
      ['polo sur', [-90, 123.45]],
    ])('distancia cero de %s a sí mismo', (_nombre, p) => {
      expect(haversineMeters(p, p)).toBe(0)
    })

    it('nunca devuelve un valor negativo', () => {
      expect(haversineMeters(OBELISCO, LA_PLATA)).toBeGreaterThan(0)
      expect(haversineMeters(LA_PLATA, OBELISCO)).toBeGreaterThan(0)
      expect(haversineMeters(ORIGEN, [0.00001, 0])).toBeGreaterThanOrEqual(0)
    })
  })

  describe('simetría', () => {
    it.each<[string, LatLng, LatLng]>([
      ['Obelisco↔Congreso', OBELISCO, CONGRESO],
      ['Obelisco↔Casa Rosada', OBELISCO, CASA_ROSADA],
      ['Obelisco↔La Plata', OBELISCO, LA_PLATA],
      ['Retiro↔Ezeiza', RETIRO, EZEIZA],
      ['Tigre↔La Plata', TIGRE, LA_PLATA],
      ['origen↔Obelisco', ORIGEN, OBELISCO],
    ])('haversine(a,b) === haversine(b,a) para %s', (_n, a, b) => {
      const ab = haversineMeters(a, b)
      const ba = haversineMeters(b, a)
      expect(ab).toBeCloseTo(ba, 6)
    })
  })

  describe('grados de latitud → metros', () => {
    it('1 grado de latitud ≈ 111195 m (en el ecuador)', () => {
      expect(haversineMeters([0, 0], [1, 0])).toBeCloseTo(M_PER_DEG, 0)
    })

    it('1 grado de latitud ≈ 111195 m (partiendo de Buenos Aires)', () => {
      // El largo de un grado de latitud es casi constante con la latitud.
      const d = haversineMeters([-34, -58], [-33, -58])
      expect(d).toBeCloseTo(M_PER_DEG, 0)
    })

    it.each<[number]>([[0.5], [2], [5], [10], [30], [45]])(
      '%s grados de latitud escalan linealmente (± tolerancia)',
      (deg) => {
        const d = haversineMeters([0, 0], [deg, 0])
        expect(d).toBeCloseTo(M_PER_DEG * deg, 0)
      },
    )

    it('la distancia en latitud es proporcional al delta de grados', () => {
      const d1 = haversineMeters([0, 0], [1, 0])
      const d2 = haversineMeters([0, 0], [2, 0])
      const d3 = haversineMeters([0, 0], [3, 0])
      expect(d2 / d1).toBeCloseTo(2, 3)
      expect(d3 / d1).toBeCloseTo(3, 3)
    })

    it('la distancia en latitud no depende de la longitud de partida', () => {
      const enCero = haversineMeters([10, 0], [11, 0])
      const enCien = haversineMeters([10, 100], [11, 100])
      const enMenos = haversineMeters([10, -58], [11, -58])
      expect(enCero).toBeCloseTo(enCien, 3)
      expect(enCero).toBeCloseTo(enMenos, 3)
      expect(enCero).toBeCloseTo(M_PER_DEG, 0)
    })
  })

  describe('grados de longitud → metros (se acortan con cos(lat))', () => {
    it('1 grado de longitud en el ecuador ≈ 111195 m', () => {
      expect(haversineMeters([0, 0], [0, 1])).toBeCloseTo(M_PER_DEG, 0)
    })

    it('en el ecuador, 1° de longitud ≈ 1° de latitud', () => {
      const lat = haversineMeters([0, 0], [1, 0])
      const lng = haversineMeters([0, 0], [0, 1])
      expect(lng).toBeCloseTo(lat, 0)
    })

    it.each<[number]>([[15], [30], [45], [60], [75]])(
      'a %s° de latitud, 1° de longitud ≈ M_PER_DEG * cos(lat)',
      (lat) => {
        const d = haversineMeters([lat, 0], [lat, 1])
        const esperado = M_PER_DEG * Math.cos((lat * Math.PI) / 180)
        // A esta latitud la distancia meridional/paralela difiere levemente de
        // la aproximación plana; toleramos ~1% del valor esperado.
        expect(d).toBeCloseTo(esperado, -Math.ceil(Math.log10(esperado * 0.01)))
      },
    )

    it('a mayor latitud (en valor absoluto), más se acorta 1° de longitud', () => {
      const ecuador = haversineMeters([0, 0], [0, 1])
      const bsAs = haversineMeters([-34.6, 0], [-34.6, 1])
      const alta = haversineMeters([-60, 0], [-60, 1])
      expect(bsAs).toBeLessThan(ecuador)
      expect(alta).toBeLessThan(bsAs)
    })

    it('en Buenos Aires (~34.6°S), 1° de longitud ≈ 91.5 km', () => {
      const d = haversineMeters([-34.6, -58], [-34.6, -57])
      const esperado = M_PER_DEG * Math.cos((34.6 * Math.PI) / 180)
      expect(d).toBeCloseTo(esperado, -3) // dentro de ~1 km
      expect(d).toBeGreaterThan(90000)
      expect(d).toBeLessThan(93000)
    })

    it('es simétrico respecto al hemisferio: cos(lat) === cos(-lat)', () => {
      const norte = haversineMeters([34.6, 0], [34.6, 1])
      const sur = haversineMeters([-34.6, 0], [-34.6, 1])
      expect(norte).toBeCloseTo(sur, 3)
    })

    it('en el polo, 1° de longitud tiende a 0', () => {
      const cercaPolo = haversineMeters([89.9, 0], [89.9, 1])
      expect(cercaPolo).toBeLessThan(200)
      expect(cercaPolo).toBeGreaterThanOrEqual(0)
    })
  })

  describe('desigualdad triangular y monotonía', () => {
    it('cumple la desigualdad triangular (Obelisco, Congreso, La Plata)', () => {
      const ab = haversineMeters(OBELISCO, CONGRESO)
      const bc = haversineMeters(CONGRESO, LA_PLATA)
      const ac = haversineMeters(OBELISCO, LA_PLATA)
      expect(ac).toBeLessThanOrEqual(ab + bc + 1e-6)
    })

    it('cumple la desigualdad triangular (Tigre, Retiro, Ezeiza)', () => {
      const ab = haversineMeters(TIGRE, RETIRO)
      const bc = haversineMeters(RETIRO, EZEIZA)
      const ac = haversineMeters(TIGRE, EZEIZA)
      expect(ac).toBeLessThanOrEqual(ab + bc + 1e-6)
    })

    it('puntos colineales en latitud: suma exacta de tramos', () => {
      const total = haversineMeters([0, 0], [3, 0])
      const t1 = haversineMeters([0, 0], [1, 0])
      const t2 = haversineMeters([1, 0], [2, 0])
      const t3 = haversineMeters([2, 0], [3, 0])
      expect(t1 + t2 + t3).toBeCloseTo(total, 0)
    })

    it('más lejos en latitud → más distancia (monótono)', () => {
      const d1 = haversineMeters(OBELISCO, [-34.7, -58.3816])
      const d2 = haversineMeters(OBELISCO, [-34.8, -58.3816])
      const d3 = haversineMeters(OBELISCO, [-34.9, -58.3816])
      expect(d1).toBeLessThan(d2)
      expect(d2).toBeLessThan(d3)
    })
  })

  describe('distancias conocidas del AMBA (sanidad de magnitud)', () => {
    it('Obelisco → Congreso: cientos de metros (~1.3 km)', () => {
      const d = haversineMeters(OBELISCO, CONGRESO)
      expect(d).toBeGreaterThan(1000)
      expect(d).toBeLessThan(1600)
    })

    it('Obelisco → Casa Rosada: ~1 km', () => {
      const d = haversineMeters(OBELISCO, CASA_ROSADA)
      expect(d).toBeGreaterThan(800)
      expect(d).toBeLessThan(1400)
    })

    it('Obelisco → La Plata: decenas de km (~55-60 km)', () => {
      const d = haversineMeters(OBELISCO, LA_PLATA)
      expect(d).toBeGreaterThan(50000)
      expect(d).toBeLessThan(65000)
    })

    it('Obelisco → Ezeiza: ~25-30 km', () => {
      const d = haversineMeters(OBELISCO, EZEIZA)
      expect(d).toBeGreaterThan(20000)
      expect(d).toBeLessThan(35000)
    })

    it.each<[string, LatLng, LatLng, number, number]>([
      ['Obelisco→Retiro', OBELISCO, RETIRO, 800, 2500],
      ['Obelisco→Tigre', OBELISCO, TIGRE, 20000, 35000],
      ['Retiro→Congreso', RETIRO, CONGRESO, 1500, 3500],
    ])('%s cae en el rango esperado', (_n, a, b, min, max) => {
      const d = haversineMeters(a, b)
      expect(d).toBeGreaterThan(min)
      expect(d).toBeLessThan(max)
    })
  })

  describe('robustez con desplazamientos diminutos', () => {
    it('desplazamiento de 1e-5° de latitud ≈ ~1.11 m', () => {
      const d = haversineMeters([-34.6, -58.38], [-34.60001, -58.38])
      expect(d).toBeCloseTo(M_PER_DEG * 1e-5, 2)
    })

    it('desplazamientos crecientes producen distancias crecientes', () => {
      const base: LatLng = [-34.6, -58.38]
      const d1 = haversineMeters(base, [-34.6001, -58.38])
      const d2 = haversineMeters(base, [-34.601, -58.38])
      const d3 = haversineMeters(base, [-34.61, -58.38])
      expect(d1).toBeLessThan(d2)
      expect(d2).toBeLessThan(d3)
    })
  })
})

describe('simRoute — bearingDeg (propiedades geométricas)', () => {
  describe('rumbos cardinales exactos desde el ecuador', () => {
    it('norte = 0°', () => {
      expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(0, 5)
    })

    it('este = 90°', () => {
      expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(90, 5)
    })

    it('sur = 180°', () => {
      expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(180, 5)
    })

    it('oeste = 270°', () => {
      expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(270, 5)
    })
  })

  describe('rumbos cardinales desde Buenos Aires', () => {
    const centro: LatLng = [-34.6, -58.38]

    it('hacia el norte ≈ 0°', () => {
      expect(bearingDeg(centro, [-33.6, -58.38])).toBeCloseTo(0, 3)
    })

    it('hacia el sur ≈ 180°', () => {
      expect(bearingDeg(centro, [-35.6, -58.38])).toBeCloseTo(180, 3)
    })

    it('hacia el este ≈ 90° (aprox, curva levemente por la esfera)', () => {
      const b = bearingDeg(centro, [-34.6, -57.38])
      expect(b).toBeGreaterThan(89)
      expect(b).toBeLessThan(91)
    })

    it('hacia el oeste ≈ 270° (aprox)', () => {
      const b = bearingDeg(centro, [-34.6, -59.38])
      expect(b).toBeGreaterThan(269)
      expect(b).toBeLessThan(271)
    })
  })

  describe('rango de salida [0, 360)', () => {
    it.each<[string, LatLng, LatLng]>([
      ['NE', [0, 0], [1, 1]],
      ['SE', [0, 0], [-1, 1]],
      ['SO', [0, 0], [-1, -1]],
      ['NO', [0, 0], [1, -1]],
      ['norte', [0, 0], [1, 0]],
      ['este', [0, 0], [0, 1]],
      ['sur', [0, 0], [-1, 0]],
      ['oeste', [0, 0], [0, -1]],
      ['AMBA', OBELISCO, LA_PLATA],
      ['AMBA inverso', LA_PLATA, OBELISCO],
    ])('el rumbo de %s está en [0, 360)', (_n, a, b) => {
      const deg = bearingDeg(a, b)
      expect(deg).toBeGreaterThanOrEqual(0)
      expect(deg).toBeLessThan(360)
    })

    it('el rumbo oeste es 270, nunca -90 (normalizado a [0,360))', () => {
      const deg = bearingDeg([0, 0], [0, -1])
      expect(deg).toBeCloseTo(270, 5)
      expect(deg).not.toBeLessThan(0)
    })
  })

  describe('cuadrantes intercardinales', () => {
    it('NE está estrictamente entre 0 y 90', () => {
      const deg = bearingDeg([0, 0], [1, 1])
      expect(deg).toBeGreaterThan(0)
      expect(deg).toBeLessThan(90)
    })

    it('en el ecuador, NE simétrico ≈ 45° (leve desvío esférico)', () => {
      expect(bearingDeg([0, 0], [1, 1])).toBeCloseTo(45, 1)
    })

    it('SE está estrictamente entre 90 y 180', () => {
      const deg = bearingDeg([0, 0], [-1, 1])
      expect(deg).toBeGreaterThan(90)
      expect(deg).toBeLessThan(180)
    })

    it('en el ecuador, SE ≈ 135°', () => {
      expect(bearingDeg([0, 0], [-1, 1])).toBeCloseTo(135, 1)
    })

    it('SO está estrictamente entre 180 y 270', () => {
      const deg = bearingDeg([0, 0], [-1, -1])
      expect(deg).toBeGreaterThan(180)
      expect(deg).toBeLessThan(270)
    })

    it('en el ecuador, SO ≈ 225°', () => {
      expect(bearingDeg([0, 0], [-1, -1])).toBeCloseTo(225, 1)
    })

    it('NO está estrictamente entre 270 y 360', () => {
      const deg = bearingDeg([0, 0], [1, -1])
      expect(deg).toBeGreaterThan(270)
      expect(deg).toBeLessThan(360)
    })

    it('en el ecuador, NO ≈ 315°', () => {
      expect(bearingDeg([0, 0], [1, -1])).toBeCloseTo(315, 1)
    })
  })

  describe('opuestos: rumbo inverso difiere ~180°', () => {
    it.each<[string, LatLng, LatLng]>([
      ['norte↔sur', [0, 0], [1, 0]],
      ['este↔oeste', [0, 0], [0, 1]],
      ['NE↔SO', [0, 0], [1, 1]],
      ['AMBA Obelisco↔La Plata', OBELISCO, LA_PLATA],
      ['AMBA Retiro↔Ezeiza', RETIRO, EZEIZA],
    ])('bearing(a→b) y bearing(b→a) difieren ~180° para %s', (_n, a, b) => {
      const ab = bearingDeg(a, b)
      const ba = bearingDeg(b, a)
      let diff = Math.abs(ab - ba)
      if (diff > 180) diff = 360 - diff
      // Sobre distancias grandes el rumbo inicial y el de vuelta difieren algo
      // de 180° exactos (curvatura del círculo máximo); toleramos ~0.5°.
      expect(diff).toBeCloseTo(180, 0)
    })
  })

  describe('coherencia con haversine (mismo par → rumbo estable)', () => {
    it('el rumbo Obelisco→Congreso es determinístico', () => {
      const b1 = bearingDeg(OBELISCO, CONGRESO)
      const b2 = bearingDeg(OBELISCO, CONGRESO)
      expect(b1).toBe(b2)
    })

    it('Congreso está al SO del Obelisco (más al sur y al oeste)', () => {
      // Congreso: lat menor (más sur), lng menor (más oeste) → cuadrante SO.
      const deg = bearingDeg(OBELISCO, CONGRESO)
      expect(deg).toBeGreaterThan(180)
      expect(deg).toBeLessThan(270)
    })

    it('Casa Rosada está al E/NE del Obelisco (más al este)', () => {
      // Casa Rosada: lng mayor (más este), lat apenas menor → cerca del este.
      const deg = bearingDeg(OBELISCO, CASA_ROSADA)
      expect(deg).toBeGreaterThan(90)
      expect(deg).toBeLessThan(180)
    })

    it('Retiro está al N/NE del Obelisco (más al norte)', () => {
      // Retiro: lat mayor (más norte), lng mayor (más este) → cuadrante NE.
      const deg = bearingDeg(OBELISCO, RETIRO)
      expect(deg).toBeGreaterThanOrEqual(0)
      expect(deg).toBeLessThan(90)
    })
  })

  describe('desplazamientos diminutos también dan rumbo válido', () => {
    it.each<[string, LatLng, number, number]>([
      ['micro-norte', [-34.6, -58.38], 0.0000001, 0],
      ['micro-este', [-34.6, -58.38], 0, 0.0000001],
    ])('%s produce un rumbo en [0,360)', (_n, base, dLat, dLng) => {
      const deg = bearingDeg(base, [base[0] + dLat, base[1] + dLng])
      expect(deg).toBeGreaterThanOrEqual(0)
      expect(deg).toBeLessThan(360)
    })
  })
})
