/**
 * billing.ts — Mobile billing service (Stripe via WebBrowser)
 *
 * Flow:
 *   1. startMobileCheckout(plan) → calls backend /api/billing/checkout
 *      → opens Stripe hosted checkout in the system browser
 *      → resolves when the user dismisses the browser (Done / back button)
 *   2. fetchMobileSubscription() → GET /api/billing/subscription
 *      → returns the active subscription row or null
 *
 * After startMobileCheckout resolves, call fetchMobileSubscription() to get
 * the updated plan (the Stripe webhook will have fired by then in most cases).
 */

import * as WebBrowser from 'expo-web-browser'
import { supabase } from './supabase'

const BACKEND = 'https://safetruck20-production.up.railway.app'

// ─── helpers ────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('No hay sesión activa. Iniciá sesión e intentá de nuevo.')
  return token
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${BACKEND}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
  }
  return data as T
}

// ─── public API ─────────────────────────────────────────────────────────────

export interface MobileSubscription {
  plan: string
  status: string
  current_period_end: string | null
  stripe_customer_id?: string | null
}

/**
 * Opens Stripe Checkout in the system browser for the given plan.
 * Awaits until the user dismisses the browser (presses Done / back).
 * After this resolves, call fetchMobileSubscription() to read the updated plan.
 */
export async function startMobileCheckout(plan: string): Promise<void> {
  const { url } = await apiFetch<{ url: string }>('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({
      plan,
      // returnUrl tells the backend to redirect Stripe back to the web dashboard,
      // which shows a clear success/cancel message inside the browser.
      returnUrl: 'https://safetruck20.vercel.app',
    }),
  })

  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
  })
  // Resolves when the user closes the browser (presses Done / back).
}

/**
 * Fetches the most recent subscription row for the logged-in user.
 * Returns null if no subscription exists or the request fails.
 */
export async function fetchMobileSubscription(): Promise<MobileSubscription | null> {
  try {
    const { subscription } = await apiFetch<{ subscription: MobileSubscription | null }>(
      '/api/billing/subscription',
    )
    return subscription
  } catch {
    return null
  }
}
