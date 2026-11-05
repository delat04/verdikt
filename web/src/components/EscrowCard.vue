<script setup>
import { computed } from 'vue'
import { Lock } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import { formatCents } from '@/utils/format'

/* The "purse" from run-arrands, restyled as the escrow card from the thumbnail */
const props = defineProps({
  heldCents: { type: Number, default: 0 },
  releasedCents: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  milestonesHeld: { type: Number, default: 0 },
})

const held = computed(() => formatCents(props.heldCents, props.currency))
const released = computed(() => formatCents(props.releasedCents, props.currency))
</script>

<template>
  <div class="escrow">
    <div class="escrow__glow" />
    <div class="escrow__top">
      <span class="eyebrow escrow__label">Held in escrow</span>
      <BrandMark :size="30" class="escrow__mark" />
    </div>
    <div class="escrow__row">
      <span class="escrow__chip" />
      <span class="escrow__pill"><Lock :size="11" /> {{ milestonesHeld }} milestone{{ milestonesHeld === 1 ? '' : 's' }}</span>
    </div>
    <p class="escrow__figure num">{{ held }}</p>
    <p class="escrow__sub">Released to date <span class="num">{{ released }}</span></p>
  </div>
</template>

<style scoped>
.escrow {
  position: relative; overflow: hidden;
  padding: 1.25rem 1.375rem 1.375rem;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-bottom-color: transparent;
  background: linear-gradient(180deg, #0A0F1F 0%, #0A1333 45%, #183ABE 100%);
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 20px 50px rgba(47, 91, 255, 0.18);
}
.escrow__glow {
  position: absolute; left: 10%; right: 10%; bottom: -60%; height: 100%;
  background: radial-gradient(ellipse at 50% 50%, rgba(220, 230, 255, 0.55), rgba(47, 91, 255, 0) 65%);
  filter: blur(14px); pointer-events: none;
}
.escrow > *:not(.escrow__glow) { position: relative; }
.escrow__top { display: flex; align-items: center; justify-content: space-between; }
.escrow__label { color: rgba(200, 215, 255, 0.75); }
.escrow__mark { color: rgba(220, 230, 255, 0.9); }
.escrow__row { display: flex; align-items: center; gap: 0.75rem; margin-top: 1rem; }
.escrow__chip {
  width: 44px; height: 34px; border-radius: 8px;
  border: 1.5px solid rgba(170, 195, 255, 0.6);
  background:
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 0 11px/14px 1.5px no-repeat,
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 0 22px/14px 1.5px no-repeat,
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 28px 11px/14px 1.5px no-repeat,
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 28px 22px/14px 1.5px no-repeat,
    linear-gradient(160deg, rgba(60,85,170,.7), rgba(10,20,60,.6));
}
.escrow__pill {
  display: inline-flex; align-items: center; gap: 0.3125rem;
  padding: 0.25rem 0.625rem; border-radius: 999px;
  border: 1px solid rgba(170, 195, 255, 0.35); background: rgba(40, 70, 170, 0.3);
  font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(210, 222, 255, 0.9);
}
.escrow__figure { margin: 1.25rem 0 0; font-size: 2rem; line-height: 1; letter-spacing: -0.02em; }
.escrow__sub { margin: 0.5rem 0 0; font-size: 0.75rem; color: rgba(220, 230, 255, 0.7); }
.escrow__sub .num { color: #fff; }
</style>
