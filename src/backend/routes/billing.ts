import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { supabase } from '../supabaseClient'
import { authMiddleware } from '../middleware/authMiddleware'

const router = Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
})

// Mapeo plan → price_id de Stripe (cargados desde .env)
const PRICE_IDS: Record<string, string> = {
  starter:    process.env.STRIPE_PRICE_STARTER!,
  pro:        process.env.STRIPE_PRICE_PRO!,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE!,
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://safe-truck-76h3.vercel.app'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout
// Crea una Stripe Checkout Session y devuelve la URL de pago.
// Requiere autenticación.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/checkout', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { plan } = req.body as { plan: string }
    const userId   = req.user!.id
    const email    = req.user!.email

    if (!plan || !PRICE_IDS[plan]) {
      return res.status(400).json({ error: 'Plan inválido. Debe ser starter, pro o enterprise.' })
    }

    // Buscar o crear customer en Stripe
    let stripeCustomerId: string | undefined

    const { data: existingSub } = await supabase
      .from('st_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (existingSub?.stripe_customer_id) {
      stripeCustomerId = existingSub.stripe_customer_id
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: userId },
      })
      stripeCustomerId = customer.id
    }

    // Crear Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer:   stripeCustomerId,
      mode:       'subscription',
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: `${FRONTEND_URL}/dashboard?billing=success&plan=${plan}`,
      cancel_url:  `${FRONTEND_URL}/?billing=cancelled`,
      metadata: {
        supabase_user_id: userId,
        plan,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: userId,
          plan,
        },
      },
    })

    res.json({ url: session.url })
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
// Recibe eventos de Stripe. Usa express.raw() — NO express.json().
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  const sig     = req.headers['stripe-signature'] as string
  const secret  = process.env.STRIPE_WEBHOOK_SECRET!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret)
  } catch (err: any) {
    console.error('[webhook] Firma inválida:', err.message)
    return res.status(400).json({ error: `Webhook error: ${err.message}` })
  }

  console.log(`[webhook] Evento recibido: ${event.type}`)

  try {
    switch (event.type) {

      // Pago exitoso — suscripción creada
      case 'checkout.session.completed': {
        const session  = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const userId   = session.metadata?.supabase_user_id
        const plan     = session.metadata?.plan
        const subId    = session.subscription as string
        const custId   = session.customer as string

        if (!userId || !plan) break

        // Obtener detalles de la suscripción para las fechas
        const stripeSub = await stripe.subscriptions.retrieve(subId)
        const item = stripeSub.items.data[0]

        await upsertSubscription({
          userId,
          plan,
          status:              'active',
          stripeCustomerId:    custId,
          stripeSubscriptionId: subId,
          stripePriceId:       item?.price.id,
          periodStart:         item ? new Date(item.current_period_start * 1000).toISOString() : null,
          periodEnd:           item ? new Date(item.current_period_end   * 1000).toISOString() : null,
        })

        await logEvent(event.id, event.type, userId, event.data.object)
        break
      }

      // Suscripción actualizada (cambio de plan, renovación, etc.)
      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription
        const userId    = stripeSub.metadata?.supabase_user_id
        const plan      = stripeSub.metadata?.plan

        if (!userId || !plan) break

        const item = stripeSub.items.data[0]

        await upsertSubscription({
          userId,
          plan,
          status:              mapStripeStatus(stripeSub.status),
          stripeCustomerId:    stripeSub.customer as string,
          stripeSubscriptionId: stripeSub.id,
          stripePriceId:       item?.price.id,
          periodStart:         item ? new Date(item.current_period_start * 1000).toISOString() : null,
          periodEnd:           item ? new Date(item.current_period_end   * 1000).toISOString() : null,
        })

        await logEvent(event.id, event.type, userId, event.data.object)
        break
      }

      // Suscripción cancelada
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription
        const userId    = stripeSub.metadata?.supabase_user_id

        if (!userId) break

        await supabase
          .from('st_subscriptions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', stripeSub.id)

        // Quitar el plan del perfil
        await supabase
          .from('st_profiles')
          .update({ plan: null })
          .eq('id', userId)

        await logEvent(event.id, event.type, userId, event.data.object)
        break
      }

      // Pago fallido
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId   = (invoice.parent?.subscription_details?.subscription as string) ?? null

        if (subId) {
          await supabase
            .from('st_subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId)
        }

        await logEvent(event.id, event.type, null, event.data.object)
        break
      }

      default:
        console.log(`[webhook] Evento no manejado: ${event.type}`)
    }

    res.json({ received: true })
  } catch (err: any) {
    console.error('[webhook] Error procesando evento:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface UpsertSubscriptionParams {
  userId:               string
  plan:                 string
  status:               string
  stripeCustomerId:     string
  stripeSubscriptionId: string
  stripePriceId:        string | undefined
  periodStart:          string | null
  periodEnd:            string | null
}

async function upsertSubscription(p: UpsertSubscriptionParams) {
  // Upsert en st_subscriptions
  const { error: subErr } = await supabase
    .from('st_subscriptions')
    .upsert({
      user_id:                p.userId,
      stripe_customer_id:     p.stripeCustomerId,
      stripe_subscription_id: p.stripeSubscriptionId,
      stripe_price_id:        p.stripePriceId,
      plan:                   p.plan,
      status:                 p.status,
      current_period_start:   p.periodStart,
      current_period_end:     p.periodEnd,
    }, { onConflict: 'stripe_subscription_id' })

  if (subErr) throw subErr

  // Actualizar el plan en st_profiles
  const { error: profileErr } = await supabase
    .from('st_profiles')
    .update({ plan: p.plan })
    .eq('id', p.userId)

  if (profileErr) throw profileErr
}

async function logEvent(
  stripeEventId: string,
  eventType:     string,
  userId:        string | null,
  payload:       object,
) {
  await supabase.from('st_payment_events').upsert(
    { stripe_event_id: stripeEventId, event_type: eventType, user_id: userId, payload },
    { onConflict: 'stripe_event_id' },
  )
}

function mapStripeStatus(status: Stripe.Subscription.Status): string {
  const map: Record<string, string> = {
    active:             'active',
    past_due:           'past_due',
    canceled:           'cancelled',
    trialing:           'trialing',
    incomplete:         'incomplete',
    incomplete_expired: 'cancelled',
    unpaid:             'past_due',
    paused:             'past_due',
  }
  return map[status] ?? 'incomplete'
}

export default router
