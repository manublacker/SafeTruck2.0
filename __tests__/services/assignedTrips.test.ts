/**
 * Tests de los helpers de error del servicio de viajes asignados
 * (`src/services/assignedTrips.ts`): la clase ApiError, el detector de error de
 * suscripción (402) y el mensaje al chofer.
 */
import {
  ApiError,
  isSubscriptionError,
  SUBSCRIPTION_INACTIVE_MESSAGE,
} from '../../src/services/assignedTrips'

describe('assignedTrips — ApiError', () => {
  it('guarda status y message', () => {
    const err = new ApiError(404, 'No encontrado')
    expect(err.status).toBe(404)
    expect(err.message).toBe('No encontrado')
  })

  it('es una instancia de Error', () => {
    const err = new ApiError(500, 'boom')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
  })

  it('tiene name "ApiError"', () => {
    const err = new ApiError(400, 'x')
    expect(err.name).toBe('ApiError')
  })

  it('se puede lanzar y atrapar conservando el status', () => {
    try {
      throw new ApiError(402, 'sin plan')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(402)
    }
  })
})

describe('assignedTrips — isSubscriptionError', () => {
  it('es true para un ApiError con status 402', () => {
    expect(isSubscriptionError(new ApiError(402, 'Payment Required'))).toBe(true)
  })

  it('es false para un ApiError con otro status', () => {
    expect(isSubscriptionError(new ApiError(401, 'no auth'))).toBe(false)
    expect(isSubscriptionError(new ApiError(403, 'forbidden'))).toBe(false)
    expect(isSubscriptionError(new ApiError(404, 'not found'))).toBe(false)
    expect(isSubscriptionError(new ApiError(500, 'server'))).toBe(false)
  })

  it('es false para un Error genérico', () => {
    expect(isSubscriptionError(new Error('402'))).toBe(false)
  })

  it('es false para valores que no son errores', () => {
    expect(isSubscriptionError(null)).toBe(false)
    expect(isSubscriptionError(undefined)).toBe(false)
    expect(isSubscriptionError(402)).toBe(false)
    expect(isSubscriptionError('402')).toBe(false)
    expect(isSubscriptionError({ status: 402 })).toBe(false)
    expect(isSubscriptionError({})).toBe(false)
  })

  it('distingue el 402 de otros errores HTTP comunes', () => {
    const statuses = [400, 401, 402, 403, 404, 409, 422, 429, 500, 502, 503]
    for (const status of statuses) {
      expect(isSubscriptionError(new ApiError(status, ''))).toBe(status === 402)
    }
  })
})

describe('assignedTrips — SUBSCRIPTION_INACTIVE_MESSAGE', () => {
  it('es un mensaje no vacío y en español', () => {
    expect(typeof SUBSCRIPTION_INACTIVE_MESSAGE).toBe('string')
    expect(SUBSCRIPTION_INACTIVE_MESSAGE.length).toBeGreaterThan(20)
  })

  it('menciona el plan y al administrador', () => {
    expect(SUBSCRIPTION_INACTIVE_MESSAGE.toLowerCase()).toContain('plan')
    expect(SUBSCRIPTION_INACTIVE_MESSAGE.toLowerCase()).toContain('administrador')
  })
})
