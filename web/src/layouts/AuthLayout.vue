<!-- AuthLayout — sign-in, onboarding, invites: one focused panel over the thumbnail's line art. -->
<script setup>
import BrandMark from '@/components/BrandMark.vue'

defineProps({ wide: { type: Boolean, default: false } })
</script>

<template>
  <div class="auth">
    <div class="auth__glow" aria-hidden="true" />
    <svg class="auth__lines" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 1000 A900 900 0 0 1 900 100" />
      <line x1="0" y1="64" x2="1000" y2="64" />
      <line x1="64" y1="0" x2="64" y2="1000" />
      <line x1="936" y1="0" x2="936" y2="1000" />
    </svg>

    <header class="auth__top">
      <RouterLink to="/" class="auth__brand"><BrandMark :size="28" /> Verdikt</RouterLink>
      <slot name="top" />
    </header>

    <main class="auth__panel" :class="{ 'is-wide': wide }">
      <slot />
    </main>

    <p class="auth__foot vk-eyebrow">Escrow · Verify · Release</p>
  </div>
</template>

<style scoped>
.auth { position: relative; min-height: 100dvh; overflow: hidden; display: flex; flex-direction: column; align-items: center; padding: 0 16px 64px; background: var(--vk-canvas); }
.auth__glow {
  position: absolute; left: 50%; bottom: -55%; width: 1200px; height: 820px; transform: translateX(-50%);
  background: radial-gradient(ellipse 45% 35% at 50% 55%, color-mix(in srgb, var(--vk-accent) 22%, transparent), transparent 72%);
  filter: blur(24px); pointer-events: none;
}
.auth__lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.auth__lines * { fill: none; stroke: var(--vk-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.auth__top { position: relative; width: 100%; max-width: 1080px; display: flex; align-items: center; justify-content: space-between; height: 72px; }
.auth__brand { display: inline-flex; align-items: center; gap: 10px; color: var(--vk-ink); font: 400 18px/1 var(--vk-font); letter-spacing: -.03em; text-decoration: none !important; }
.auth__panel {
  position: relative; width: 100%; max-width: 440px; margin-top: clamp(16px, 8vh, 72px);
  padding: 32px; border-radius: var(--vk-r-lg);
  background: var(--vk-surface); border: 1px solid var(--vk-line); box-shadow: var(--vk-elev-pop);
}
.auth__panel.is-wide { max-width: 600px; }
.auth__foot { position: absolute; bottom: 24px; left: 0; right: 0; text-align: center; letter-spacing: .4em; }
@media (max-width: 520px) { .auth__panel { padding: 24px 20px; } }
</style>
