<!--
  RoleBar — demo mode only: whose side of the contract you're looking at, always in view above the page.
  One person plays both parties in the demo, so the hirer (client) and the freelancer each get their own colour
  (--vk-role-*), name and one line on what that side does, plus the switch to the other side.
-->
<script setup>
import { computed } from 'vue'
import { ArrowLeftRight } from 'lucide-vue-next'
import VAvatar from '@/components/ui/VAvatar.vue'
import { ROLE_COPY, otherRole } from '@/domain/roles'

const props = defineProps({
  role: { type: String, required: true },          // 'client' | 'freelancer'
  personas: { type: Object, required: true },      // { client: { name }, freelancer: { name } }
})
defineEmits(['switch'])

const other = computed(() => otherRole(props.role))
const me = computed(() => props.personas[props.role])
const them = computed(() => props.personas[other.value])
const first = (p) => p?.name?.split(' ')[0] || ''
</script>

<template>
  <div class="role" :class="`role--${role}`" role="status" aria-live="polite">
    <!-- keyed, so each switch plays the entrance again; the text itself changes at once, animation or not -->
    <div :key="role" class="role__who">
      <VAvatar :name="me.name" size="sm" class="role__avatar" />
      <p class="role__text">
        <span class="role__name">Viewing as {{ me.name }}, {{ ROLE_COPY[role].side }}</span>
        <span class="role__does">{{ ROLE_COPY[role].does }}</span>
      </p>
    </div>
    <button type="button" class="role__switch" @click="$emit('switch', other)">
      <ArrowLeftRight :size="14" :stroke-width="1.9" aria-hidden="true" />
      <span class="role__switch-long">View as {{ first(them) }}, {{ ROLE_COPY[other].side }}</span>
      <span class="role__switch-short">{{ first(them) }}</span>
    </button>
  </div>
</template>

<style scoped>
.role {
  --role: var(--vk-role-client); --role-ink: var(--vk-role-client-ink); --role-soft: var(--vk-role-client-soft); --role-line: var(--vk-role-client-line);
  display: flex; align-items: center; gap: 12px; min-height: 44px; box-sizing: border-box;
  margin: 2px clamp(16px, 2.4vw, 32px) 6px; padding: 5px 6px 5px 6px;
  border: 1px solid var(--role-line); border-radius: var(--vk-r-md);
  background: var(--role-soft);
  transition: background-color var(--vk-dur-4) var(--vk-ease-out), border-color var(--vk-dur-4) var(--vk-ease-out);
}
.role--freelancer {
  --role: var(--vk-role-freelancer); --role-ink: var(--vk-role-freelancer-ink); --role-soft: var(--vk-role-freelancer-soft); --role-line: var(--vk-role-freelancer-line);
}
.role__who { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 auto; }
.role__avatar { box-shadow: 0 0 0 2px var(--role); flex: none; }
.role__text { margin: 0; display: flex; align-items: baseline; gap: 10px; min-width: 0; flex-wrap: wrap; row-gap: 0; }
.role__name { font: 400 14px/20px var(--vk-font); color: var(--role-ink); white-space: nowrap; }
.role__does { font: var(--vk-type-dense); color: var(--vk-muted); }
.role__switch {
  display: inline-flex; align-items: center; gap: 7px; flex: none; height: 32px; padding: 0 12px;
  border: 1px solid var(--role-line); border-radius: var(--vk-r-full); background: var(--vk-surface);
  font: 400 13px/1 var(--vk-font); color: var(--vk-ink); cursor: pointer;
}
.role__switch:hover { border-color: var(--role); }
.role__switch:focus-visible { outline: 2px solid var(--role); outline-offset: 2px; }
.role__switch-short { display: none; }

.role__who { animation: role-in var(--vk-dur-4) var(--vk-ease-out); }
@keyframes role-in { from { opacity: 0; transform: translateY(6px); } }

@media (max-width: 720px) {
  .role { margin: 2px 16px 6px; }
  .role__does { display: none; }
  .role__name { white-space: normal; }
  .role__switch-long { display: none; }
  .role__switch-short { display: inline; }
}
@media (prefers-reduced-motion: reduce) {
  .role__who { animation: none; }
}
</style>
