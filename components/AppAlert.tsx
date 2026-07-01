import { useEffect, useState } from 'react'
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native'
import { useStore } from '../src/store/useStore'
import { getTheme } from '../src/theme'

// Reemplazo lindo del Alert nativo (el diálogo gris de Android/iOS). Tiene la
// MISMA API que Alert.alert de react-native, así que en cada pantalla alcanza con
// cambiar el import (`import { Alert } from '.../components/AppAlert'`) y todos los
// diálogos pasan a verse con el estilo de la app (tema oscuro/claro).

type AlertButton = { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }
type DialogState = { title: string; message?: string; buttons: AlertButton[] } | null

let emit: ((d: DialogState) => void) | null = null

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    const b = buttons && buttons.length ? buttons : [{ text: 'OK' }]
    // Si el host todavía no montó, caemos a no-op (no debería pasar: va en el layout raíz).
    emit?.({ title, message, buttons: b })
  },
}

export function AppAlertHost() {
  const isDark = useStore((s) => s.isDark)
  const t = getTheme(isDark)
  const [dialog, setDialog] = useState<DialogState>(null)
  useEffect(() => { emit = setDialog; return () => { emit = null } }, [])

  const close = (b?: AlertButton) => { setDialog(null); b?.onPress?.() }
  const cancelBtn = dialog?.buttons.find((b) => b.style === 'cancel')

  return (
    <Modal transparent visible={!!dialog} animationType="fade" onRequestClose={() => close(cancelBtn)}>
      <Pressable style={styles.backdrop} onPress={() => cancelBtn && close(cancelBtn)}>
        <Pressable
          style={[styles.card, { backgroundColor: t.card, borderColor: t.border, shadowOpacity: isDark ? 0.55 : 0.18 }]}
          onPress={() => {}}
        >
          {dialog && (
            <>
              <Text style={[styles.title, { color: t.text }]}>{dialog.title}</Text>
              {dialog.message ? <Text style={[styles.message, { color: t.textMuted }]}>{dialog.message}</Text> : null}
              <View style={styles.row}>
                {dialog.buttons.map((b, i) => {
                  const color = b.style === 'cancel' ? t.textMuted : b.style === 'destructive' ? t.danger : t.accent
                  return (
                    <Pressable key={i} onPress={() => close(b)} style={styles.btn} hitSlop={6}>
                      <Text style={[styles.btnText, { color, fontWeight: b.style === 'cancel' ? '600' : '800' }]}>{b.text}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: {
    width: '100%', maxWidth: 380, borderRadius: 18, borderWidth: 1, padding: 22,
    shadowColor: '#000', shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 14,
  },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, marginBottom: 8 },
  message: { fontSize: 15, lineHeight: 21, marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10 },
  btnText: { fontSize: 15 },
})
