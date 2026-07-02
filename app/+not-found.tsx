import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from '../src/store/useStore';
import { getTheme } from '../src/theme';

export default function NotFoundScreen() {
  const isDark = useStore(s => s.isDark);
  const t = getTheme(isDark);
  return (
    <>
      <Stack.Screen options={{ title: 'No encontrado' }} />
      <View style={[styles.container, { backgroundColor: t.bg }]}>
        <Text style={styles.emoji}>🤷</Text>
        <Text style={[styles.title, { color: t.text }]}>Esta pantalla no existe.</Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: t.accent }]}>Volver al inicio</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  link: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
