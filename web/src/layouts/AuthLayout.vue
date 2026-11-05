<script setup>
import BrandMark from '@/components/BrandMark.vue'
</script>

<template>
  <div class="auth">
    <div class="auth__glow" />
    <svg class="auth__lines" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 1000 A900 900 0 0 1 900 100" />
      <line x1="0" y1="80" x2="1000" y2="80" />
      <line x1="80" y1="0" x2="80" y2="1000" />
    </svg>

    <div class="auth__panel">
      <div class="auth__brand">
        <BrandMark :size="34" />
        <span>Verdikt</span>
      </div>
      <slot />
    </div>

    <p class="auth__foot eyebrow">Escrow · Verify · Release</p>
  </div>
</template>

<style scoped>
.auth {
  position: relative; min-height: 100dvh; overflow: hidden;
  display: grid; place-items: center; padding: 1.5rem 1rem;
  background: var(--bg-2);
}
.auth__glow {
  position: absolute; left: 50%; bottom: -45%; width: 1100px; height: 800px; transform: translateX(-50%);
  background: radial-gradient(ellipse 45% 35% at 50% 55%, rgba(200, 215, 255, 0.35), rgba(47, 91, 255, 0.25) 45%, transparent 75%);
  filter: blur(20px); pointer-events: none;
}
.auth__lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.auth__lines * { fill: none; stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }

.auth__panel {
  position: relative; width: 100%; max-width: 400px;
  padding: 2rem; border-radius: 20px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
  backdrop-filter: blur(12px);
}
.auth__brand { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 1.75rem; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; }
.auth__foot { position: absolute; bottom: 1.5rem; left: 0; right: 0; text-align: center; letter-spacing: 0.4em; }
</style>
