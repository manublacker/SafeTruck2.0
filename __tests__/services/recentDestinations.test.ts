/**
 * Tests del servicio de destinos recientes (`src/services/recentDestinations.ts`).
 * Persiste en SecureStore (stub in-memory de jest.config). Se ejercita el
 * dedup por display_name, el orden (más reciente primero), el tope de 5 y la
 * tolerancia a datos corruptos.
 */
import * as SecureStore from 'expo-secure-store'
import {
  getRecentDestinations,
  addRecentDestination,
  type RecentDest,
} from '../../src/services/recentDestinations'

const KEY = 'recent_destinations'

function dest(name: string, lat = '0', lon = '0'): RecentDest {
  return { display_name: name, lat, lon }
}

beforeEach(async () => {
  // Reset del almacenamiento entre tests (el stub es un singleton de módulo).
  await SecureStore.deleteItemAsync(KEY)
})

describe('recentDestinations — getRecentDestinations', () => {
  it('devuelve lista vacía cuando no hay nada guardado', async () => {
    expect(await getRecentDestinations()).toEqual([])
  })

  it('devuelve lo que se haya persistido', async () => {
    await SecureStore.setItemAsync(KEY, JSON.stringify([dest('A')]))
    const res = await getRecentDestinations()
    expect(res).toHaveLength(1)
    expect(res[0].display_name).toBe('A')
  })

  it('devuelve lista vacía si el JSON está corrupto', async () => {
    await SecureStore.setItemAsync(KEY, '{no es json valido')
    expect(await getRecentDestinations()).toEqual([])
  })

  it('devuelve lista vacía si el valor persistido no es un array', async () => {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ foo: 'bar' }))
    expect(await getRecentDestinations()).toEqual([])
  })

  it('devuelve lista vacía si el valor es un número serializado', async () => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(42))
    expect(await getRecentDestinations()).toEqual([])
  })
})

describe('recentDestinations — addRecentDestination', () => {
  it('agrega el primer destino', async () => {
    const res = await addRecentDestination(dest('Obelisco'))
    expect(res).toHaveLength(1)
    expect(res[0].display_name).toBe('Obelisco')
  })

  it('persiste el destino para la próxima lectura', async () => {
    await addRecentDestination(dest('Obelisco'))
    const leido = await getRecentDestinations()
    expect(leido).toHaveLength(1)
    expect(leido[0].display_name).toBe('Obelisco')
  })

  it('agrega el más nuevo al frente', async () => {
    await addRecentDestination(dest('A'))
    const res = await addRecentDestination(dest('B'))
    expect(res.map((d) => d.display_name)).toEqual(['B', 'A'])
  })

  it('deduplica por display_name moviendo el repetido al frente', async () => {
    await addRecentDestination(dest('A'))
    await addRecentDestination(dest('B'))
    const res = await addRecentDestination(dest('A'))
    expect(res.map((d) => d.display_name)).toEqual(['A', 'B'])
    expect(res).toHaveLength(2)
  })

  it('el dedup actualiza las coordenadas del destino repetido', async () => {
    await addRecentDestination(dest('A', '1', '1'))
    const res = await addRecentDestination(dest('A', '2', '2'))
    expect(res).toHaveLength(1)
    expect(res[0].lat).toBe('2')
    expect(res[0].lon).toBe('2')
  })

  it('limita la lista a 5 destinos, descartando el más viejo', async () => {
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) {
      await addRecentDestination(dest(n))
    }
    const res = await getRecentDestinations()
    expect(res).toHaveLength(5)
    expect(res.map((d) => d.display_name)).toEqual(['F', 'E', 'D', 'C', 'B'])
    // 'A' (el más viejo) se descartó.
    expect(res.map((d) => d.display_name)).not.toContain('A')
  })

  it('al agregar un existente no crece más allá del tope', async () => {
    for (const n of ['A', 'B', 'C', 'D', 'E']) {
      await addRecentDestination(dest(n))
    }
    const res = await addRecentDestination(dest('C'))
    expect(res).toHaveLength(5)
    expect(res[0].display_name).toBe('C')
  })

  it('mantiene exactamente el orden esperado tras varias operaciones', async () => {
    await addRecentDestination(dest('uno'))
    await addRecentDestination(dest('dos'))
    await addRecentDestination(dest('tres'))
    await addRecentDestination(dest('dos')) // re-visita "dos"
    const res = await getRecentDestinations()
    expect(res.map((d) => d.display_name)).toEqual(['dos', 'tres', 'uno'])
  })

  it('el resultado devuelto coincide con lo persistido', async () => {
    const devuelto = await addRecentDestination(dest('X'))
    const leido = await getRecentDestinations()
    expect(leido).toEqual(devuelto)
  })

  it('trata display_name distintos como entradas separadas aunque compartan coords', async () => {
    await addRecentDestination(dest('Casa', '5', '5'))
    const res = await addRecentDestination(dest('Trabajo', '5', '5'))
    expect(res).toHaveLength(2)
  })
})
