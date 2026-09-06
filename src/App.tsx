import { defineComponent } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { provideReveal } from '@/composables/useReveal'
import { useHashRoute } from '@/composables/useHashRoute'
import SiteHeader from '@/components/SiteHeader'
import HeroSection from '@/components/HeroSection'
import CompatStrip from '@/components/CompatStrip'
import FlowSection from '@/components/FlowSection'
import CompareSection from '@/components/CompareSection'
import ConfigSection from '@/components/ConfigSection'
import TemplatesSection from '@/components/TemplatesSection'
import DocsSection from '@/components/DocsSection'
import ConsoleBridge from '@/components/ConsoleBridge'
import DoctorSection from '@/components/DoctorSection'
import DoctorPage from '@/components/DoctorPage'
import RecipesPage from '@/components/RecipesPage'
import SecuritySection from '@/components/SecuritySection'
import StartSection from '@/components/StartSection'
import ProofSection from '@/components/ProofSection'
import FaqSection from '@/components/FaqSection'
import CtaSection from '@/components/CtaSection'
import SiteFooter from '@/components/SiteFooter'

export default defineComponent({
  name: 'App',
  setup() {
    const { theme, toggle } = useTheme()
    const { route } = useHashRoute(['docs', 'doctor', 'recipes'])
    /** Наблюдатель за скроллом на всю страницу: секции подключаются к нему сами. */
    provideReveal()

    return () => (
      <div style="min-height:100vh;background:var(--bg);color:var(--ink)">
        <SiteHeader route={route.value} theme={theme.value} onToggleTheme={toggle} />
        {route.value === 'doctor' ? (
          <DoctorPage />
        ) : route.value === 'recipes' ? (
          <RecipesPage />
        ) : route.value === 'docs' ? (
          <>
            <TemplatesSection />
            <DocsSection />
          </>
        ) : (
          <>
            <HeroSection />
            <CompatStrip />
            <DoctorSection />
            <FlowSection />
            <CompareSection />
            <ConfigSection />
            <ConsoleBridge />
            <SecuritySection />
            <StartSection />
            <ProofSection />
            <FaqSection />
            <CtaSection />
          </>
        )}
        <SiteFooter />
      </div>
    )
  },
})
