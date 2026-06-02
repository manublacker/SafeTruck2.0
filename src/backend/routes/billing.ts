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
  starter:    { amount: 1,  title: 'Plan Starter - SafeTruck' },
  pro:        { amount: 118500, title: 'Plan Pro - SafeTruck' },
  enterprise: { amount: 298500, title: 'Plan Enterprise - SafeTruck' },
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://safetruck20.vercel.app'

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

    const baseUrl = (returnUrl || FRONTEND_URL).replace(/\/$/, '')

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
      .from('st_subscriptions')
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
// POST /api/billing/webhook
// Recibe notificaciones de MercadoPago. Usa express.json() normal.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-signature'] as string | undefined
  const requestId = req.headers['x-request-id'] as string | undefined
  const secret    = process.env.MP_WEBHOOK_SECRET

  if (secret && signature) {
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
    .from('st_subscriptions')
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
    .from('st_profiles')
    .upsert({ id: p.userId, plan: p.plan }, { onConflict: 'id' })

  if (profileErr) throw profileErr
}

async function logEvent(eventId: string, eventType: string, userId: string, payload: object) {
  await supabase.from('st_payment_events').upsert(
    { mp_event_id: eventId, event_type: eventType, user_id: userId, payload },
    { onConflict: 'mp_event_id' },
  )
}

export default router
