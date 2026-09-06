import { defineComponent } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { provideReveal } from '@/composables/useReveal'
import { useHashRoute } from '@/composables/useHashRoute'
import { routes } from '@/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import HeroSection from '@/components/HeroSection'
import FeaturesSection from '@/components/FeaturesSection'
import PricingSection from '@/components/PricingSection'
import DocsSection from '@/components/DocsSection'

export default defineComponent({
  name: 'App',
  setup() {
    const { theme, toggle } = useTheme()
    const { route } = useHashRoute(routes)
    /** Наблюдатель за скроллом на всю страницу: секции подключаются к нему сами. */
    provideReveal()

    return () => (
      <div style="min-height:100vh;background:var(--bg);color:var(--ink)">
        <SiteHeader route={route.value} theme={theme.value} onToggleTheme={toggle} />
        {route.value === 'docs' ? (
          <DocsSection />
        ) : (
          <>
            <HeroSection />
            <FeaturesSection />
            <PricingSection />
          </>
        )}
        <SiteFooter />
      </div>
    )
  },
})
