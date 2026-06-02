import { Router, Request, Response } from 'express'
import { MercadoPagoConfig, PreApproval } from 'mercadopago'
import { createHmac } from 'crypto'
import { supabase } from '../supabaseClient'
import { authMiddleware } from '../middleware/authMiddleware'

const router = Router()

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN!,
})

const preapprovalClient = new PreApproval(mp)

const PLAN_CONFIG: Record<string, { amount: number; reason: string }> = {
  starter:    { amount: 43500,  reason: 'Plan Starter - SafeTruck' },
  pro:        { amount: 118500, reason: 'Plan Pro - SafeTruck' },
  enterprise: { amount: 298500, reason: 'Plan Enterprise - SafeTruck' },
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://safetruck20.vercel.app'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout
// Crea una suscripción pendiente en MercadoPago y devuelve la URL de pago.
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

    const result = await preapprovalClient.create({
      body: {
        reason:        config.reason,
        payer_email:   email,
        auto_recurring: {
          frequency:          1,
          frequency_type:     'months',
          transaction_amount: config.amount,
          currency_id:        'ARS',
        },
        back_url:           `${baseUrl}/dashboard?billing=success&plan=${plan}`,
        status:             'pending',
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
// Devuelve la suscripción activa del usuario.
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

  // Verificar firma solo si el secret está configurado
  if (secret && signature) {
    const parts    = Object.fromEntries(signature.split(',').map(p => p.split('=')))
    const ts       = parts['ts']
    const v1       = parts['v1']
    const manifest = `id:${(req.body as any).id};request-id:${requestId};ts:${ts}`
    const expected = createHmac('sha256', secret).update(manifest).digest('hex')

    if (expected !== v1) {
      console.error('[webhook] Firma inválida')
      return res.status(400).json({ error: 'Firma inválida' })
    }
  }

  const body = req.body as { type?: string; action?: string; data?: { id?: string }; id?: string }

  // Solo procesamos eventos de preapproval (suscripciones)
  if (body.type !== 'preapproval' || !body.data?.id) {
    return res.json({ received: true })
  }

  try {
    const sub = await preapprovalClient.get({ id: body.data.id })

    const [userId, plan] = (sub.external_reference ?? '').split('|')
    if (!userId || !plan) {
      console.error('[webhook] external_reference inválido:', sub.external_reference)
      return res.json({ received: true })
    }

    const status = mapMPStatus(sub.status ?? '')

    await upsertSubscription({
      userId,
      plan,
      status,
      mpSubscriptionId: sub.id!,
      mpPayerId:        String(sub.payer_id ?? ''),
      periodStart:      sub.date_created ?? null,
      periodEnd:        sub.next_payment_date ?? null,
    })

    if (status === 'cancelled') {
      await supabase
        .from('st_profiles')
        .update({ plan: null })
        .eq('id', userId)
    }

    await logEvent(body.data.id, body.action ?? body.type ?? '', userId, body)

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
  userId:           string
  plan:             string
  status:           string
  mpSubscriptionId: string
  mpPayerId:        string
  periodStart:      string | null
  periodEnd:        string | null
}

async function upsertSubscription(p: UpsertParams) {
  const { error: subErr } = await supabase
    .from('st_subscriptions')
    .upsert({
      user_id:             p.userId,
      mp_payer_id:         p.mpPayerId,
      mp_subscription_id:  p.mpSubscriptionId,
      mp_plan:             p.plan,
      plan:                p.plan,
      status:              p.status,
      current_period_start: p.periodStart,
      current_period_end:   p.periodEnd,
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

function mapMPStatus(status: string): string {
  const map: Record<string, string> = {
    authorized: 'active',
    pending:    'incomplete',
    paused:     'past_due',
    cancelled:  'cancelled',
  }
  return map[status] ?? 'incomplete'
}

export default router
