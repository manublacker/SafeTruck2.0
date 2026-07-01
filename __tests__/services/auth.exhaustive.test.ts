/**
 * Tests EXHAUSTIVOS de los validadores/formateadores PUROS de
 * `src/services/auth.ts`: email, contraseña, CUIT, máscara de CUIT (dígito por
 * dígito y con basura intercalada) y sanitización de dígitos OTP (pegado de
 * varios dígitos y no-dígitos).
 *
 * Importar `auth.ts` arrastra `./supabase`, pero está stubbeado vía jest.config,
 * así que no hace falta nada extra acá.
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

describe('auth.exhaustive — constantes', () => {
  it('MIN_PASSWORD_LENGTH === 8', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
  })
  it('OTP_LENGTH === 8', () => {
    expect(OTP_LENGTH).toBe(8)
  })
  it('ambas constantes son enteros positivos', () => {
    expect(Number.isInteger(MIN_PASSWORD_LENGTH)).toBe(true)
    expect(Number.isInteger(OTP_LENGTH)).toBe(true)
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThan(0)
    expect(OTP_LENGTH).toBeGreaterThan(0)
  })
})

describe('auth.exhaustive — isValidEmail: válidos', () => {
  const validos = [
    'test@example.com',
    'user.name@domain.co',
    'a@b.cd',
    'MAYUS@DOMINIO.COM',
    'con+etiqueta@gmail.com',
    'muchos.puntos.aca@sub.dominio.org',
    'numeros123@dominio456.io',
    'guion-medio@dominio-largo.net',
    'guion_bajo@dominio.com',
    "raro!#$%&'*@ejemplo.com",
    'x@y.z',
    'a.b.c@d.e.f',
    'pcappelletti@itba.edu.ar',
    'nombre@sub.sub.sub.dominio.com',
    'usuario@127x0x0x1.com',
    'tag@dominio.museum',
  ]

  it.each(validos)('%s es válido', (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  const conEspaciosAlrededor = [
    '  test@example.com  ',
    '\ttest@example.com\t',
    ' a@b.cd',
    'a@b.cd ',
    '\n user@dominio.com \n',
  ]

  it.each(conEspaciosAlrededor)('%j se trimea y queda válido', (email) => {
    expect(isValidEmail(email)).toBe(true)
  })
})

describe('auth.exhaustive — isValidEmail: inválidos', () => {
  const invalidos: Array<[string, string]> = [
    ['string vacío', ''],
    ['sólo espacios', '   '],
    ['sin arroba', 'testexample.com'],
    ['sin dominio', 'test@'],
    ['sin usuario', '@example.com'],
    ['sin TLD (sin punto)', 'test@example'],
    ['doble arroba', 'test@@example.com'],
    ['espacio en el medio', 'test @example.com'],
    ['espacio antes del punto dominio', 'test@exa mple.com'],
    ['arroba con espacio después', 'test@ example.com'],
    ['dos arrobas separadas', 'a@b@c.com'],
    ['termina en punto sin TLD', 'test@example.'],
    ['empieza con punto no rompe pero sin dominio real', 'test@.com'],
    ['sólo arroba', '@'],
    ['sólo punto', '.'],
    ['tab interno', 'te\tst@example.com'],
    ['newline interno', 'test@exam\nple.com'],
    ['espacio interno en usuario', 'te st@example.com'],
    ['nada antes de la arroba tras trim', '   @example.com   '],
  ]

  it.each(invalidos)('%s → inválido', (_label, email) => {
    expect(isValidEmail(email)).toBe(false)
  })

  it('un mail con TLD pero dominio "punto-arroba" es inválido', () => {
    expect(isValidEmail('a@.b')).toBe(false)
  })

  it('el trim NO arregla espacios internos', () => {
    expect(isValidEmail('  a b@c.com  ')).toBe(false)
  })
})

describe('auth.exhaustive — isValidPassword: borde de 8', () => {
  const casos: Array<[string, number, boolean]> = [
    ['0 chars', 0, false],
    ['1 char', 1, false],
    ['7 chars (uno menos)', 7, false],
    ['8 chars (borde exacto)', 8, true],
    ['9 chars', 9, true],
    ['12 chars', 12, true],
    ['100 chars', 100, true],
  ]

  it.each(casos)('%s → %s', (_l, largo, esperado) => {
    expect(isValidPassword('x'.repeat(largo))).toBe(esperado)
  })

  it('exactamente MIN_PASSWORD_LENGTH caracteres es válido', () => {
    expect(isValidPassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true)
  })

  it('MIN_PASSWORD_LENGTH - 1 caracteres es inválido', () => {
    expect(isValidPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false)
  })

  it('cuenta caracteres, no valida contenido: 8 espacios es válido', () => {
    expect(isValidPassword('        ')).toBe(true)
  })

  it('8 caracteres con símbolos/emojis (por code units) — "abcdefgh" válido', () => {
    expect(isValidPassword('abcdefgh')).toBe(true)
  })

  it('string vacío es inválido', () => {
    expect(isValidPassword('')).toBe(false)
  })

  it('password larga con espacios internos válida', () => {
    expect(isValidPassword('hola mundo 123')).toBe(true)
  })
})

describe('auth.exhaustive — isValidCuit: válidos (formato XX-XXXXXXXX-X)', () => {
  const validos = [
    '20-12345678-9',
    '27-00000000-0',
    '30-99999999-9',
    '23-11111111-4',
    '33-70987654-3',
    '20-00000000-0',
    '99-99999999-9',
    '00-00000000-0',
  ]

  it.each(validos)('%s es válido', (cuit) => {
    expect(isValidCuit(cuit)).toBe(true)
  })
})

describe('auth.exhaustive — isValidCuit: inválidos', () => {
  const invalidos: Array<[string, string]> = [
    ['sin guiones', '20123456789'],
    ['sólo un guion', '20-123456789'],
    ['guiones mal ubicados', '201-2345678-9'],
    ['primer grupo con 1 dígito', '2-12345678-9'],
    ['primer grupo con 3 dígitos', '203-1234567-8'],
    ['grupo medio con 7 dígitos', '20-1234567-9'],
    ['grupo medio con 9 dígitos', '20-123456789-0'],
    ['último grupo con 2 dígitos', '20-12345678-90'],
    ['último grupo vacío', '20-12345678-'],
    ['con letras', '20-1234567a-9'],
    ['con espacios', '20 12345678 9'],
    ['string vacío', ''],
    ['sólo dígitos sin longitud', '123'],
    ['guiones de más', '20--12345678-9'],
    ['espacio al final', '20-12345678-9 '],
    ['espacio al inicio', ' 20-12345678-9'],
    ['barra en vez de guion', '20/12345678/9'],
    ['punto en vez de guion', '20.12345678.9'],
    ['todo pegado con 11 dígitos', '20123456789'],
    ['guion medio como último char', '20-12345678-'],
  ]

  it.each(invalidos)('%s → inválido', (_label, cuit) => {
    expect(isValidCuit(cuit)).toBe(false)
  })

  it('isValidCuit NO trimea (a diferencia de isValidEmail)', () => {
    expect(isValidCuit(' 20-12345678-9 ')).toBe(false)
    expect(isValidCuit('20-12345678-9')).toBe(true)
  })

  it('valida sólo formato, no el dígito verificador real', () => {
    // 00-00000000-0 no es un CUIT real pero cumple el formato.
    expect(isValidCuit('00-00000000-0')).toBe(true)
  })
})

describe('auth.exhaustive — formatCuit: dígito por dígito', () => {
  // Escribir "20123456789" un dígito a la vez.
  const progresivo: Array<[string, string]> = [
    ['', ''],
    ['2', '2'],
    ['20', '20'],
    ['201', '20-1'],
    ['2012', '20-12'],
    ['20123', '20-123'],
    ['201234', '20-1234'],
    ['2012345', '20-12345'],
    ['20123456', '20-123456'],
    ['201234567', '20-1234567'],
    ['2012345678', '20-12345678'],
    ['20123456789', '20-12345678-9'],
  ]

  it.each(progresivo)('formatCuit(%j) === %j', (entrada, esperado) => {
    expect(formatCuit(entrada)).toBe(esperado)
  })

  it('el resultado final de 11 dígitos es un CUIT con formato válido', () => {
    const formateado = formatCuit('20123456789')
    expect(formateado).toBe('20-12345678-9')
    expect(isValidCuit(formateado)).toBe(true)
  })
})

describe('auth.exhaustive — formatCuit: truncado a 11 dígitos', () => {
  const casos: Array<[string, string]> = [
    ['12 dígitos se trunca a 11', '201234567890'],
    ['15 dígitos se trunca', '201234567890000'],
    ['20 dígitos se trunca', '20123456789ZZZZZZZZZ'],
  ]

  it.each(casos)('%s → siempre XX-XXXXXXXX-X', (_l, entrada) => {
    expect(formatCuit(entrada)).toBe('20-12345678-9')
  })

  it('nunca produce más de 13 caracteres (11 dígitos + 2 guiones)', () => {
    expect(formatCuit('99999999999999999999').length).toBe(13)
  })
})

describe('auth.exhaustive — formatCuit: basura intercalada (saca no-dígitos)', () => {
  const casos: Array<[string, string, string]> = [
    ['con guiones ya puestos', '20-12345678-9', '20-12345678-9'],
    ['con espacios', '20 12345678 9', '20-12345678-9'],
    ['con letras intercaladas', '2a0b1c2d3e4f5g6h7i8j9', '20-12345678-9'],
    ['con símbolos', '20/12.345,678#9', '20-12345678-9'],
    ['con paréntesis y barras', '(20)-1234/5678-9', '20-12345678-9'],
    ['todo pegado', '20123456789', '20-12345678-9'],
    ['con tabs y newlines', '20\t1234\n5678 9', '20-12345678-9'],
    ['prefijo CUIT texto', 'CUIT: 20123456789', '20-12345678-9'],
  ]

  it.each(casos)('%s → %j', (_l, entrada, esperado) => {
    expect(formatCuit(entrada)).toBe(esperado)
  })

  it('sin ningún dígito devuelve string vacío', () => {
    expect(formatCuit('')).toBe('')
    expect(formatCuit('sin numeros aca')).toBe('')
    expect(formatCuit('----')).toBe('')
    expect(formatCuit('   ')).toBe('')
    expect(formatCuit('!@#$%^&*()')).toBe('')
  })
})

describe('auth.exhaustive — formatCuit: rangos de longitud del guion', () => {
  it('<= 2 dígitos: sin guion', () => {
    expect(formatCuit('2')).toBe('2')
    expect(formatCuit('20')).toBe('20')
  })

  it('3 a 10 dígitos: un solo guion tras los primeros dos', () => {
    expect(formatCuit('203')).toBe('20-3')
    expect(formatCuit('2034')).toBe('20-34')
    expect(formatCuit('2012345678')).toBe('20-12345678')
  })

  it('exactamente 10 dígitos: aún sin el segundo guion (sólo un guion en total)', () => {
    const formateado = formatCuit('2012345678')
    expect(formateado).toBe('20-12345678')
    expect((formateado.match(/-/g) || []).length).toBe(1)
  })

  it('11 dígitos: aparece el segundo guion', () => {
    expect(formatCuit('20123456789')).toBe('20-12345678-9')
  })

  const conteos: Array<[number, string]> = [
    [1, '2'],
    [2, '20'],
    [3, '20-1'],
    [10, '20-12345678'],
    [11, '20-12345678-9'],
  ]

  it.each(conteos)('con %d dígitos → %j', (n, esperado) => {
    const fuente = '20123456789'
    expect(formatCuit(fuente.slice(0, n))).toBe(esperado)
  })
})

describe('auth.exhaustive — sanitizeOtpDigit', () => {
  const casos: Array<[string, string, string]> = [
    ['string vacío', '', ''],
    ['un dígito', '5', '5'],
    ['una letra', 'a', ''],
    ['dígito precedido de letra', 'a5', '5'],
    ['varios dígitos toma el último', '123', '3'],
    ['pegado de 8 dígitos toma el último', '12345678', '8'],
    ['dígitos con basura, último dígito', '1a2b3', '3'],
    ['termina en letra tras un dígito', '5x', '5'],
    ['sólo no-dígitos', 'abc', ''],
    ['espacios y un dígito', '  7  ', '7'],
    ['símbolos y dígito', '#@7!', '7'],
    ['cero', '0', '0'],
    ['múltiples ceros toma el último', '000', '0'],
    ['0 al final tras dígitos', '9990', '0'],
    ['newline entre dígitos', '1\n2', '2'],
    ['tab entre dígitos', '4\t9', '9'],
    ['pega un OTP completo, deja el último', '87654321', '1'],
    ['dígitos y letras alternados largo', 'a1b2c3d4e5f', '5'],
  ]

  it.each(casos)('%s: %j → %j', (_l, entrada, esperado) => {
    expect(sanitizeOtpDigit(entrada)).toBe(esperado)
  })

  it('el resultado siempre tiene largo 0 o 1', () => {
    const entradas = ['', 'a', '1', '123', 'a1b2c3', '   ', '!!!9!!!']
    for (const e of entradas) {
      const r = sanitizeOtpDigit(e)
      expect(r.length).toBeLessThanOrEqual(1)
      expect(r.length).toBeGreaterThanOrEqual(0)
    }
  })

  it('si hay al menos un dígito, el resultado es exactamente ese último dígito', () => {
    for (let d = 0; d <= 9; d++) {
      expect(sanitizeOtpDigit(`basura${d}`)).toBe(String(d))
    }
  })

  it('cada dígito individual 0-9 se conserva tal cual', () => {
    for (let d = 0; d <= 9; d++) {
      expect(sanitizeOtpDigit(String(d))).toBe(String(d))
    }
  })
})

describe('auth.exhaustive — interacción formatCuit + isValidCuit', () => {
  it('formatear 11 dígitos siempre produce un CUIT válido por formato', () => {
    const fuentes = ['20123456789', '27000000000', '30999999999', '00000000000']
    for (const f of fuentes) {
      expect(isValidCuit(formatCuit(f))).toBe(true)
    }
  })

  it('formatear menos de 11 dígitos NO produce un CUIT válido por formato', () => {
    expect(isValidCuit(formatCuit('2012345678'))).toBe(false)
    expect(isValidCuit(formatCuit('201'))).toBe(false)
    expect(isValidCuit(formatCuit('20'))).toBe(false)
  })

  it('un CUIT ya válido pasado por formatCuit se mantiene válido (idempotente en formato)', () => {
    const cuit = '20-12345678-9'
    expect(formatCuit(cuit)).toBe(cuit)
    expect(isValidCuit(formatCuit(cuit))).toBe(true)
  })
})
