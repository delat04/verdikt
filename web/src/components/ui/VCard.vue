<!--
  VCard — the container.
  variant: default | well | pill (status pill on the left edge + 4% tint; set `tone`) | ink (one per page)
  `to` makes the whole card one link (the title carries it; nested buttons stay clickable).
  Slots: default (body) · tools (head right) · foot · head (replace the whole head)
-->
<script setup>
import { computed, useSlots } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowUpRight } from 'lucide-vue-next'

const props = defineProps({
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  variant: { type: String, default: 'default' },
  tone: { type: String, default: 'accent' },   // pill variant: accent | ok | warn | danger | neutral
  size: { type: String, default: 'md' },       // md | lg
  to: { type: [String, Object], default: null },
  as: { type: String, default: 'section' },
  flush: { type: Boolean, default: false },    // body without padding (lists, tables)
})
const slots = useSlots()
const hasHead = computed(() => !!(props.title || props.sub || slots.tools || slots.head || props.to))
</script>

<template>
  <component
    :is="as"
    class="vk-card"
    :class="[
      variant !== 'default' && `vk-card--${variant}`,
      variant === 'pill' && `vk-card--tone-${tone}`,
      size === 'lg' && 'vk-card--lg',
      { 'vk-card--link': !!to },
    ]"
  >
    <header v-if="hasHead" class="vk-card__head">
      <slot name="head">
        <div class="vk-card__titles">
          <h3 v-if="title" class="vk-card__title">
            <RouterLink v-if="to" :to="to" class="vk-card__link">{{ title }}</RouterLink>
            <template v-else>{{ title }}</template>
          </h3>
          <p v-if="sub" class="vk-card__sub">{{ sub }}</p>
        </div>
        <div v-if="slots.tools || to" class="vk-card__tools">
          <slot name="tools" />
          <span v-if="to" class="vk-card__go" aria-hidden="true"><ArrowUpRight :size="15" :stroke-width="1.9" /></span>
        </div>
      </slot>
    </header>
    <div v-if="slots.default" class="vk-card__body" :style="flush ? { padding: 0 } : undefined">
      <slot />
    </div>
    <footer v-if="slots.foot" class="vk-card__foot"><slot name="foot" /></footer>
  </component>
</template>
