/**
 * Tests de las funciones puras de validación y formateo de `src/services/auth.ts`.
 * Requiere `jest` con el preset `jest-expo` (no incluido aún — ver deuda técnica).
 *
 * Los wrappers de Supabase (signUp, verifyOtp, etc.) no se testean aquí: son
 * thin wrappers sin lógica propia y requerirían mockear el SDK.
 */
import {
  formatCuit,
  isValidCuit,
  isValidEmail,
  isValidPassword,
  sanitizeOtpDigit,
  MIN_PASSWORD_LENGTH,
} from '../auth'

describe('isValidEmail', () => {
  it('acepta un email bien formado', () => {
    expect(isValidEmail('empresa@mail.com')).toBe(true)
  })

  it('ignora espacios alrededor del email', () => {
    expect(isValidEmail('  empresa@mail.com  ')).toBe(true)
  })

  it('rechaza un email sin dominio', () => {
    expect(isValidEmail('empresa@')).toBe(false)
  })

  it('rechaza un email sin arroba', () => {
    expect(isValidEmail('empresamail.com')).toBe(false)
  })

  it('rechaza una cadena vacía', () => {
    expect(isValidEmail('')).toBe(false)
  })
})

describe('isValidPassword', () => {
  it('acepta una contraseña con el largo mínimo exacto', () => {
    expect(isValidPassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true)
  })

  it('rechaza una contraseña más corta que el mínimo', () => {
    expect(isValidPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false)
  })

  it('rechaza una contraseña vacía', () => {
    expect(isValidPassword('')).toBe(false)
  })
})

describe('isValidCuit', () => {
  it('acepta un CUIT con la máscara correcta', () => {
    expect(isValidCuit('30-12345678-9')).toBe(true)
  })

  it('rechaza un CUIT sin guiones', () => {
    expect(isValidCuit('30123456789')).toBe(false)
  })

  it('rechaza un CUIT con cantidad incorrecta de dígitos', () => {
    expect(isValidCuit('30-1234567-9')).toBe(false)
  })

  it('rechaza una cadena vacía', () => {
    expect(isValidCuit('')).toBe(false)
  })
})

describe('formatCuit', () => {
  it('no agrega guiones con 2 o menos dígitos', () => {
    expect(formatCuit('30')).toBe('30')
  })

  it('agrega el primer guion al pasar los 2 dígitos', () => {
    expect(formatCuit('301234')).toBe('30-1234')
  })

  it('agrega ambos guiones con 11 dígitos', () => {
    expect(formatCuit('30123456789')).toBe('30-12345678-9')
  })

  it('descarta caracteres no numéricos', () => {
    expect(formatCuit('30-abc-123')).toBe('30-123')
  })

  it('trunca al largo válido cuando hay dígitos de más', () => {
    expect(formatCuit('301234567890000')).toBe('30-12345678-9')
  })
})

describe('sanitizeOtpDigit', () => {
  it('devuelve el único dígito tipeado', () => {
    expect(sanitizeOtpDigit('5')).toBe('5')
  })

  it('conserva solo el último dígito ante un pegado de varios', () => {
    expect(sanitizeOtpDigit('123')).toBe('3')
  })

  it('descarta caracteres no numéricos', () => {
    expect(sanitizeOtpDigit('a')).toBe('')
  })

  it('devuelve cadena vacía ante input vacío (borrado)', () => {
    expect(sanitizeOtpDigit('')).toBe('')
  })
})
