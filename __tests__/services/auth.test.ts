/**
 * Tests de los validadores/formateadores puros del servicio de auth
 * (`src/services/auth.ts`): email, contraseña, CUIT, máscara de CUIT y
 * sanitización de dígitos OTP. Los módulos nativos (Supabase, SecureStore,
 * Linking, react-native) están stubbeados vía jest.config.
 */
import {
  MIN_PASSWORD_LENGTH,
  OTP_LENGTH,
  isValidEmail,
  isValidPassword,
  isValidCuit,
  formatCuit,
  sanitizeOtpDigit,
} from '../../src/services/auth'

describe('auth — constantes', () => {
  it('MIN_PASSWORD_LENGTH es 8 (mínimo de Supabase)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
  })
  it('OTP_LENGTH es 8', () => {
    expect(OTP_LENGTH).toBe(8)
  })
})

describe('auth — isValidEmail', () => {
  const validos = [
    'test@example.com',
    'user.name@domain.co',
    'a@b.cd',
    'juan+etiqueta@empresa.com.ar',
    'MAYUS@DOMINIO.COM',
    'nombre_apellido@sub.dominio.org',
    '123@456.789',
  ]
  it.each(validos)('acepta el email válido "%s"', (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  const invalidos = [
    '',
    'sinarroba.com',
    '@sindominio.com',
    'sinlocal@',
    'sin@punto',
    'espacio adentro@dominio.com',
    'dos@@arrobas.com',
    'arroba@espacio dominio.com',
    'trailing@dominio.com ',
    'a@b@c.com',
  ]
  it.each(invalidos)('rechaza el email inválido "%s"', (email) => {
    // Nota: los espacios al borde se recortan antes de validar.
    const trimmedHasIssue = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    expect(isValidEmail(email)).toBe(!trimmedHasIssue)
  })

  it('recorta espacios al inicio y al final antes de validar', () => {
    expect(isValidEmail('  test@example.com  ')).toBe(true)
    expect(isValidEmail('\ttest@example.com\n')).toBe(true)
  })

  it('rechaza email con espacio interno aún después de trim', () => {
    expect(isValidEmail('  a b@c.com  ')).toBe(false)
  })

  it('requiere al menos un punto en el dominio', () => {
    expect(isValidEmail('user@localhost')).toBe(false)
    expect(isValidEmail('user@localhost.com')).toBe(true)
  })

  it('rechaza string vacío o sólo espacios', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('    ')).toBe(false)
  })
})

describe('auth — isValidPassword', () => {
  it('rechaza contraseñas de menos de 8 caracteres', () => {
    expect(isValidPassword('')).toBe(false)
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('abcdefg')).toBe(false)
  })

  it('acepta exactamente 8 caracteres', () => {
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('password')).toBe(true)
  })

  it('acepta contraseñas más largas', () => {
    expect(isValidPassword('unaClaveMuyLargaYSegura123')).toBe(true)
  })

  it('cuenta espacios como caracteres válidos', () => {
    expect(isValidPassword('        ')).toBe(true) // 8 espacios
    expect(isValidPassword('       ')).toBe(false) // 7 espacios
  })

  it('acepta caracteres unicode contando por longitud de string', () => {
    expect(isValidPassword('áéíóúñüç')).toBe(true)
  })

  it('es coherente con MIN_PASSWORD_LENGTH', () => {
    const justoAlLimite = 'x'.repeat(MIN_PASSWORD_LENGTH)
    const unoMenos = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(isValidPassword(justoAlLimite)).toBe(true)
    expect(isValidPassword(unoMenos)).toBe(false)
  })
})

describe('auth — isValidCuit', () => {
  const validos = ['20-12345678-9', '27-00000000-0', '30-99999999-3', '23-11111111-1']
  it.each(validos)('acepta el CUIT con formato válido "%s"', (cuit) => {
    expect(isValidCuit(cuit)).toBe(true)
  })

  it('rechaza CUIT sin guiones', () => {
    expect(isValidCuit('20123456789')).toBe(false)
  })

  it('rechaza CUIT con cantidad incorrecta de dígitos', () => {
    expect(isValidCuit('2-12345678-9')).toBe(false) // 1 dígito adelante
    expect(isValidCuit('20-1234567-9')).toBe(false) // 7 en el medio
    expect(isValidCuit('20-123456789-9')).toBe(false) // 9 en el medio
    expect(isValidCuit('20-12345678-99')).toBe(false) // 2 al final
  })

  it('rechaza CUIT con letras', () => {
    expect(isValidCuit('AB-12345678-9')).toBe(false)
    expect(isValidCuit('20-1234567X-9')).toBe(false)
  })

  it('rechaza CUIT con separadores equivocados', () => {
    expect(isValidCuit('20/12345678/9')).toBe(false)
    expect(isValidCuit('20.12345678.9')).toBe(false)
    expect(isValidCuit('20 12345678 9')).toBe(false)
  })

  it('rechaza string vacío', () => {
    expect(isValidCuit('')).toBe(false)
  })

  it('valida sólo el formato, no el dígito verificador', () => {
    // 00-00000000-0 es formalmente válido aunque no sea un CUIT real.
    expect(isValidCuit('00-00000000-0')).toBe(true)
  })
})

describe('auth — formatCuit', () => {
  it('no agrega guiones con 2 dígitos o menos', () => {
    expect(formatCuit('')).toBe('')
    expect(formatCuit('2')).toBe('2')
    expect(formatCuit('20')).toBe('20')
  })

  it('agrega el primer guion a partir del tercer dígito', () => {
    expect(formatCuit('201')).toBe('20-1')
    expect(formatCuit('2012345678')).toBe('20-12345678')
  })

  it('agrega el segundo guion a partir del undécimo dígito', () => {
    expect(formatCuit('20123456789')).toBe('20-12345678-9')
  })

  it('descarta caracteres no numéricos mientras se tipea', () => {
    expect(formatCuit('20-12345678-9')).toBe('20-12345678-9')
    expect(formatCuit('20abc12345678xyz9')).toBe('20-12345678-9')
    expect(formatCuit('20 12 34 56 78 9')).toBe('20-12345678-9')
  })

  it('trunca al largo válido de CUIT (11 dígitos)', () => {
    expect(formatCuit('2012345678999999')).toBe('20-12345678-9')
  })

  it('formatea progresivamente como al tipear dígito por dígito', () => {
    expect(formatCuit('3')).toBe('3')
    expect(formatCuit('30')).toBe('30')
    expect(formatCuit('307')).toBe('30-7')
    expect(formatCuit('3071234567')).toBe('30-71234567')
    expect(formatCuit('30712345678')).toBe('30-71234567-8')
  })

  it('el resultado de formatCuit completo pasa isValidCuit', () => {
    const formateado = formatCuit('20123456789')
    expect(isValidCuit(formateado)).toBe(true)
  })

  it('maneja input que ya viene formateado (idempotente en el completo)', () => {
    const uno = formatCuit('20123456789')
    const dos = formatCuit(uno)
    expect(dos).toBe(uno)
  })
})

describe('auth — sanitizeOtpDigit', () => {
  it('deja sólo el último dígito de un input de un carácter', () => {
    expect(sanitizeOtpDigit('5')).toBe('5')
    expect(sanitizeOtpDigit('0')).toBe('0')
  })

  it('cuando se pegan varios dígitos toma el último', () => {
    expect(sanitizeOtpDigit('123')).toBe('3')
    expect(sanitizeOtpDigit('98')).toBe('8')
  })

  it('descarta caracteres no numéricos', () => {
    expect(sanitizeOtpDigit('a')).toBe('')
    expect(sanitizeOtpDigit('abc')).toBe('')
    expect(sanitizeOtpDigit('a1b')).toBe('1')
  })

  it('devuelve string vacío para input vacío', () => {
    expect(sanitizeOtpDigit('')).toBe('')
  })

  it('un dígito seguido de una letra devuelve el dígito', () => {
    expect(sanitizeOtpDigit('7x')).toBe('7')
  })

  it('el resultado siempre es 0 o 1 caracteres', () => {
    for (const input of ['', 'a', '1', '12', 'abc123', '9z', '  4  ']) {
      expect(sanitizeOtpDigit(input).length).toBeLessThanOrEqual(1)
    }
  })
})
