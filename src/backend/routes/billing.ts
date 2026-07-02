import { Router, Request, Response } from 'express'
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'
import { createHmac } from 'crypto'
import { supabase } from '../supabaseClient'
import { authMiddleware } from '../middleware/authMiddleware'

const router = Router()

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN!,
})

const preferenceClient = new Preference(mp)
const paymentClient    = new Payment(mp)

const PLAN_CONFIG: Record<string, { amount: number; title: string }> = {
  starter:    { amount: 1, title: 'Plan Starter - SafeTruck' },
  pro:        { amount: 1, title: 'Plan Pro - SafeTruck' },
  enterprise: { amount: 1, title: 'Plan Enterprise - SafeTruck' },
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://safetruck20.vercel.app'

// Devuelve returnUrl solo si comparte origen con nuestro frontend; si no, el default.
function safeReturnUrl(returnUrl?: string): string {
  if (!returnUrl) return FRONTEND_URL
  try {
    const u = new URL(returnUrl)
    if (u.origin === new URL(FRONTEND_URL).origin) return returnUrl
    // Permitimos localhost para el flujo de desarrollo.
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return returnUrl
  } catch { /* URL inválida → default */ }
  return FRONTEND_URL
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout
// Crea una preferencia de pago en MercadoPago y devuelve la URL de pago.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/checkout', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { plan, returnUrl } = req.body as { plan: string; returnUrl?: string }
    const userId = req.user!.id
    const email  = req.user!.email

    const config = PLAN_CONFIG[plan]
    if (!config) {
      return res.status(400).json({ error: 'Plan inválido. Debe ser starter, pro o enterprise.' })
    }

    // Solo aceptamos returnUrl si apunta a nuestro propio frontend; si no, caemos
    // al default. Evita un open-redirect post-pago a un dominio arbitrario.
    const baseUrl = safeReturnUrl(returnUrl).replace(/\/$/, '')

    const result = await preferenceClient.create({
      body: {
        items: [{
          id:          plan,
          title:       config.title,
          quantity:    1,
          unit_price:  config.amount,
          currency_id: 'ARS',
        }],
        payer:       { email },
        back_urls: {
          success: `${baseUrl}/dashboard?billing=success&plan=${plan}`,
          failure: `${baseUrl}/dashboard?billing=cancelled`,
          pending: `${baseUrl}/dashboard?billing=success&plan=${plan}`,
        },
        external_reference: `${userId}|${plan}`,
      },
    })

    res.json({ url: result.init_point })
  } catch (err: any) {
    console.error('[/api/billing/checkout]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/billing/subscription
// Devuelve el pago activo del usuario.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subscription', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error

    res.json({ subscription: data ?? null })
  } catch (err: any) {
    console.error('[/api/billing/subscription]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/confirm
// Confirmación SÍNCRONA al volver del checkout. No dependemos del webhook de
// MercadoPago (que puede no llegar o fallar): buscamos el pago del usuario en
// MercadoPago por external_reference y activamos la suscripción al instante.
// Idempotente — el upsert usa onConflict, así que repetir la llamada no duplica.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/confirm', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const { plan } = req.body as { plan?: string }

    // external_reference = `${userId}|${plan}` (ver /checkout). Filtramos por él
    // si tenemos el plan; igual validamos el userId sobre cada resultado.
    const externalReference = plan ? `${userId}|${plan}` : undefined

    let paid: any = null
    try {
      const search = await paymentClient.search({
        options: {
          ...(externalReference ? { external_reference: externalReference } : {}),
          sort: 'date_created',
          criteria: 'desc',
        },
      })
      const results = (search as any).results ?? []
      paid = results.find((p: any) => {
        const [refUser] = String(p.external_reference ?? '').split('|')
        return refUser === userId && ['approved', 'pending'].includes(p.status ?? '')
      })
    } catch (searchErr: any) {
      // Si la búsqueda falla no abortamos: devolvemos la suscripción que ya exista.
      console.error('[/api/billing/confirm] búsqueda MP falló:', searchErr.message)
    }

    if (paid) {
      const [, refPlan] = String(paid.external_reference ?? '').split('|')
      await upsertSubscription({
        userId,
        plan:        refPlan || plan || '',
        mpPaymentId: String(paid.id),
        mpPayerId:   String(paid.payer?.id ?? ''),
        paidAt:      paid.date_approved ?? null,
      })
    }

    const { data } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    res.json({ subscription: data ?? null, confirmed: !!paid })
  } catch (err: any) {
    console.error('[/api/billing/confirm]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/webhook
// Recibe notificaciones de MercadoPago. Usa express.json() normal.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-signature'] as string | undefined
  const requestId = req.headers['x-request-id'] as string | undefined
  const secret    = process.env.MP_WEBHOOK_SECRET

  // Si hay un secret configurado, la firma es OBLIGATORIA: antes, omitir el header
  // x-signature salteaba toda la verificación HMAC y el body se procesaba igual.
  if (secret) {
    if (!signature) {
      console.error('[webhook] Falta la firma x-signature')
      return res.status(401).json({ error: 'Firma requerida' })
    }
    const parts  = Object.fromEntries(signature.split(',').map(p => p.trim().split('=')))
    const ts     = parts['ts']
    const v1     = parts['v1']
    const bodyId = (req.body as any)?.id
    if (!ts || !v1 || !requestId || !bodyId) {
      console.error('[webhook] Firma inválida (headers/body incompletos)')
      return res.status(400).json({ error: 'Firma inválida' })
    }
    const manifest = `id:${bodyId};request-id:${requestId};ts:${ts}`
    const expected = createHmac('sha256', secret).update(manifest).digest('hex')
    if (expected !== v1) {
      console.error('[webhook] Firma inválida')
      return res.status(400).json({ error: 'Firma inválida' })
    }
  }

  const body = req.body as { type?: string; action?: string; data?: { id?: string }; id?: string }

  // Solo procesamos pagos aprobados
  if (body.type !== 'payment' || !body.data?.id) {
    return res.json({ received: true })
  }

  try {
    const payment = await paymentClient.get({ id: Number(body.data.id) })

    if (!['approved', 'pending'].includes(payment.status ?? '')) {
      return res.json({ received: true })
    }

    const [userId, plan] = (payment.external_reference ?? '').split('|')
    if (!userId || !plan) {
      console.error('[webhook] external_reference inválido:', payment.external_reference)
      return res.json({ received: true })
    }

    await upsertSubscription({
      userId,
      plan,
      mpPaymentId: String(payment.id),
      mpPayerId:   String(payment.payer?.id ?? ''),
      paidAt:      payment.date_approved ?? null,
    })

    await logEvent(String(body.data.id), body.action ?? body.type ?? '', userId, body)

    res.json({ received: true })
  } catch (err: any) {
    console.error('[webhook] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface UpsertParams {
  userId:      string
  plan:        string
  mpPaymentId: string
  mpPayerId:   string
  paidAt:      string | null
}

async function upsertSubscription(p: UpsertParams) {
  const { error: subErr } = await supabase
    .from('subscriptions')
    .upsert({
      user_id:              p.userId,
      mp_payer_id:          p.mpPayerId,
      mp_subscription_id:   p.mpPaymentId,
      mp_plan:              p.plan,
      plan:                 p.plan,
      status:               'active',
      current_period_start: p.paidAt,
      current_period_end:   null,
    }, { onConflict: 'mp_subscription_id' })

  if (subErr) throw subErr

  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert({ id: p.userId, plan: p.plan }, { onConflict: 'id' })

  if (profileErr) throw profileErr
}

async function logEvent(eventId: string, eventType: string, userId: string, payload: object) {
  await supabase.from('payment_events').upsert(
    { mp_event_id: eventId, event_type: eventType, user_id: userId, payload },
    { onConflict: 'mp_event_id' },
  )
}

export default router
