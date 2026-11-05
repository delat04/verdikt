<!--
  EscrowCard — the money, held. The one place the accent becomes a surface (from the thumbnail):
  ink card, cobalt light rising from the bottom. Green appears only for what was released.
-->
<script setup>
import { computed } from 'vue'
import { Lock } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import { money } from '@/domain/format'

const props = defineProps({
  heldCents: { type: Number, default: 0 },
  releasedCents: { type: Number, default: 0 },
  totalCents: { type: Number, default: null },
  currency: { type: String, default: 'USD' },
  label: { type: String, default: 'Held in escrow' },
  tag: { type: String, default: '' },
})
const releasedPct = computed(() => (props.totalCents ? Math.round((props.releasedCents / props.totalCents) * 100) : 0))
const heldPct = computed(() => (props.totalCents ? Math.round((props.heldCents / props.totalCents) * 100) : 0))
</script>

<template>
  <div class="escrow">
    <div class="escrow__glow" aria-hidden="true" />
    <div class="escrow__top">
      <p class="vk-eyebrow escrow__label">{{ label }}</p>
      <BrandMark :size="26" class="escrow__mark" />
    </div>
    <div class="escrow__row">
      <span class="escrow__chip" aria-hidden="true" />
      <span v-if="tag" class="escrow__tag"><Lock :size="11" :stroke-width="2" /> {{ tag }}</span>
    </div>
    <p class="escrow__figure vk-num">{{ money(heldCents, currency) }}</p>
    <div v-if="totalCents" class="escrow__bar" role="img" :aria-label="`${releasedPct}% released, ${heldPct}% held`">
      <span class="escrow__bar-ok" :style="{ width: `${releasedPct}%` }" />
      <span class="escrow__bar-held" :style="{ width: `${heldPct}%` }" />
    </div>
    <p class="escrow__sub">
      Released <span class="vk-num escrow__ok">{{ money(releasedCents, currency) }}</span>
      <template v-if="totalCents"> of <span class="vk-num">{{ money(totalCents, currency) }}</span></template>
    </p>
  </div>
</template>

<style scoped>
.escrow {
  position: relative; overflow: hidden;
  padding: 20px 22px 22px; border-radius: var(--vk-r-lg);
  border: 1px solid rgba(255, 255, 255, .22); border-bottom-color: transparent;
  background: linear-gradient(180deg, #0A0D18 0%, #0B1434 48%, #1B3FD0 100%);
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .3), 0 18px 40px -18px rgba(49, 94, 251, .5);
}
.escrow__glow {
  position: absolute; left: 8%; right: 8%; bottom: -70%; height: 110%;
  background: radial-gradient(ellipse at 50% 50%, rgba(225, 233, 255, .6), rgba(49, 94, 251, 0) 64%);
  filter: blur(14px); pointer-events: none;
}
.escrow > :not(.escrow__glow) { position: relative; }
.escrow__top { display: flex; align-items: center; justify-content: space-between; }
.escrow__label { color: rgba(215, 225, 255, .9); }
.escrow__mark { color: rgba(225, 233, 255, .92); }
.escrow__row { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
.escrow__chip {
  width: 42px; height: 32px; border-radius: 8px; border: 1.5px solid rgba(170, 195, 255, .6);
  background:
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 0 10px/13px 1.5px no-repeat,
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 0 20px/13px 1.5px no-repeat,
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 27px 10px/13px 1.5px no-repeat,
    linear-gradient(rgba(170,195,255,.55), rgba(170,195,255,.55)) 27px 20px/13px 1.5px no-repeat,
    linear-gradient(160deg, rgba(60, 85, 170, .7), rgba(10, 20, 60, .6));
}
.escrow__tag {
  display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px;
  border-radius: var(--vk-r-full); border: 1px solid rgba(170, 195, 255, .35); background: rgba(40, 70, 170, .3);
  font: var(--vk-num-11); letter-spacing: .08em; text-transform: uppercase; color: rgba(215, 225, 255, .92);
}
.escrow__figure { margin: 18px 0 0; font-size: 34px; font-weight: 400; line-height: 1; letter-spacing: -.02em; }
.escrow__bar { display: flex; height: 4px; margin-top: 16px; border-radius: 4px; background: rgba(255, 255, 255, .14); overflow: hidden; }
.escrow__bar-ok { background: #3BE37A; transition: width .6s var(--vk-ease-out); }
.escrow__bar-held { background: rgba(225, 233, 255, .85); transition: width .6s var(--vk-ease-out); }
.escrow__sub { margin: 10px 0 0; font: var(--vk-type-small); color: rgba(230, 236, 255, .9); }
.escrow__sub .vk-num { color: #fff; }
.escrow__sub .escrow__ok { color: #6BEE9C; }
</style>
