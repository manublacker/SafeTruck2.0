// Stub de @supabase/supabase-js. Devuelve un cliente falso con la superficie
// mínima que usan los servicios: auth.getSession(). Ningún test que dependa de
// red usa este cliente; sólo permite que los módulos se importen.
export function createClient(_url: string, _key: string, _opts?: unknown) {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { session: null, user: null }, error: null }),
      signUp: async () => ({ data: { session: null, user: null }, error: null }),
      signOut: async () => ({ error: null }),
      verifyOtp: async () => ({ data: { session: null, user: null }, error: null }),
      resend: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
      signInWithOAuth: async () => ({ data: { url: null }, error: null }),
    },
    from() {
      return this
    },
  }
}
export default { createClient }
