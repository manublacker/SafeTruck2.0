import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native'
import { useRouter } from 'expo-router'
import {
  LANDING_FEATURES,
  LANDING_STATS,
  LANDING_STEPS,
} from '../src/constants/landing'
import { PLAN_OPTIONS } from '../src/constants/register'

export default function LandingScreen() {
  const router = useRouter()

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <HeroSection
        onLogin={() => router.push('/auth/login')}
        onRegister={() => router.push('/auth/register')}
      />
      <FeaturesSection />
      <PlansSection onChoose={() => router.push('/auth/register')} />
      <HowItWorksSection />
      <AboutSection />
      <FooterSection />
    </ScrollView>
  )
}

function HeroSection({
  onLogin,
  onRegister,
}: {
  onLogin: () => void
  onRegister: () => void
}) {
  return (
    <View style={s.hero}>
      <Image
        source={require('../camion_padding.png')}
        style={s.heroLogo}
        resizeMode="contain"
      />
      <Text style={s.heroTitle}>SafeTruck</Text>
      <Text style={s.heroTagline}>
        Seguro. Confiable. Trackeá cada camión en tiempo real y dale a tus choferes
        un GPS con rutas habilitadas para camiones.
      </Text>
      <TouchableOpacity style={s.primaryBtn} onPress={onRegister}>
        <Text style={s.primaryBtnText}>Registrar empresa</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.secondaryBtn} onPress={onLogin}>
        <Text style={s.secondaryBtnText}>Iniciar sesión</Text>
      </TouchableOpacity>
    </View>
  )
}

function FeaturesSection() {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Todo lo que necesitás</Text>
      <View style={s.featuresGrid}>
        {LANDING_FEATURES.map(feature => (
          <View key={feature.title} style={s.featureCard}>
            <Text style={s.featureTitle}>{feature.title}</Text>
            <Text style={s.featureDesc}>{feature.description}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function PlansSection({ onChoose }: { onChoose: () => void }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Planes para cada flota</Text>
      <Text style={s.sectionSubtitle}>Sin contratos anuales. Cancelás cuando quieras.</Text>
      {PLAN_OPTIONS.map(plan => (
        <View
          key={plan.slug}
          style={[s.planCard, plan.highlighted && s.planCardHighlighted]}
        >
          {plan.highlighted && (
            <View style={s.planBadge}>
              <Text style={s.planBadgeText}>Más elegido</Text>
            </View>
          )}
          <Text style={s.planName}>{plan.name}</Text>
          <View style={s.planPriceRow}>
            <Text style={s.planPrice}>{plan.price}</Text>
            <Text style={s.planPeriod}>/mes</Text>
          </View>
          {plan.features.map(feature => (
            <Text key={feature} style={s.planFeature}>
              ✓ {feature}
            </Text>
          ))}
          <TouchableOpacity style={s.planBtn} onPress={onChoose}>
            <Text style={s.primaryBtnText}>Elegir {plan.name}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )
}

function HowItWorksSection() {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Tres pasos para empezar</Text>
      {LANDING_STEPS.map(step => (
        <View key={step.number} style={s.stepRow}>
          <View style={s.stepCircle}>
            <Text style={s.stepNumber}>{step.number}</Text>
          </View>
          <View style={s.stepBody}>
            <Text style={s.stepTitle}>{step.title}</Text>
            <Text style={s.stepDesc}>{step.description}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

function AboutSection() {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Construido para el transporte</Text>
      <Text style={s.sectionSubtitle}>
        SafeTruck nació de la necesidad real de las empresas de logística:
        saber dónde está cada camión, en todo momento.
      </Text>
      <View style={s.statsRow}>
        {LANDING_STATS.map(stat => (
          <View key={stat.label} style={s.statCard}>
            <Text style={s.statValue}>{stat.value}</Text>
            <Text style={s.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function FooterSection() {
  return (
    <View style={s.footer}>
      <Text style={s.footerBrand}>SafeTruck</Text>
      <Text style={s.footerText}>Gestión de flotas simple y poderosa.</Text>
      <Text style={s.footerCopy}>© 2026 SafeTruck. Todos los derechos reservados.</Text>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  content: { paddingBottom: 40 },

  hero: { paddingHorizontal: 32, paddingTop: 80, paddingBottom: 48, alignItems: 'center' },
  heroLogo: { width: 200, height: 160 },
  heroTitle: { fontSize: 38, fontWeight: '700', color: '#fff', marginTop: 8 },
  heroTagline: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 28,
    lineHeight: 22,
  },

  section: { paddingHorizontal: 32, paddingVertical: 32 },
  sectionTitle: { fontSize: 24, fontWeight: '700', color: '#fff', textAlign: 'center' },
  sectionSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
  },

  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  featureCard: {
    width: '48%',
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    padding: 16,
    marginBottom: 12,
  },
  featureTitle: { color: '#FF6B35', fontSize: 15, fontWeight: '600', marginBottom: 6 },
  featureDesc: { color: '#8E8E93', fontSize: 13, lineHeight: 18 },

  planCard: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    padding: 20,
    marginBottom: 16,
  },
  planCardHighlighted: { borderColor: '#FF6B35' },
  planBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  planBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  planName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 8 },
  planPrice: { color: '#fff', fontSize: 28, fontWeight: '700' },
  planPeriod: { color: '#8E8E93', fontSize: 13, marginLeft: 6, marginBottom: 4 },
  planFeature: { color: '#fff', fontSize: 13, marginBottom: 4 },
  planBtn: {
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },

  stepRow: { flexDirection: 'row', marginTop: 20 },
  stepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  stepNumber: { color: '#fff', fontSize: 18, fontWeight: '700' },
  stepBody: { flex: 1 },
  stepTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  stepDesc: { color: '#8E8E93', fontSize: 13, lineHeight: 19 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statCard: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statValue: { color: '#FF6B35', fontSize: 22, fontWeight: '700' },
  statLabel: { color: '#8E8E93', fontSize: 11, textAlign: 'center', marginTop: 4 },

  primaryBtn: {
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  secondaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  footer: { paddingHorizontal: 32, paddingTop: 24, alignItems: 'center' },
  footerBrand: { color: '#fff', fontSize: 18, fontWeight: '700' },
  footerText: { color: '#8E8E93', fontSize: 13, marginTop: 4 },
  footerCopy: { color: '#8E8E93', fontSize: 11, marginTop: 12 },
})
