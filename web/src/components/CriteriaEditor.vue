<!--
  CriteriaEditor — a milestone's acceptance criteria: the exact checks the agent will run.
  Read mode shows each check and how it is tested; edit mode lets either party reword, add or remove
  (saving resets both signatures, so nobody signs terms they didn't see).
-->
<script setup>
import { ref, computed, watch } from 'vue'
import { Pencil, Plus, Trash2, ChevronDown, Monitor, MousePointerClick, Code2, Gauge, FileText } from 'lucide-vue-next'
import VButton from './ui/VButton.vue'
import VIconButton from './ui/VIconButton.vue'
import VPill from './ui/VPill.vue'
import { KIND } from '@/domain/milestone'

const props = defineProps({
  criteria: { type: Array, required: true },
  editable: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['save'])

const ICON = { visual: Monitor, functional: MousePointerClick, code: Code2, performance: Gauge, content: FileText }
const editing = ref(false)
const draft = ref([])
const open = ref(new Set())

watch(() => props.criteria, () => { if (!editing.value) draft.value = props.criteria.map((c) => ({ ...c })) }, { immediate: true })

function toggle(id) {
  const s = new Set(open.value)
  s.has(id) ? s.delete(id) : s.add(id)
  open.value = s
}
function startEdit() {
  draft.value = props.criteria.map((c) => ({ ...c }))
  editing.value = true
}
function add() {
  draft.value.push({ id: null, kind: 'functional', statement: '', method: '' })
}
const valid = computed(() => draft.value.length > 0 && draft.value.every((c) => c.statement.trim().length >= 8))
function save() {
  emit('save', draft.value)
  editing.value = false
}
</script>

<template>
  <div class="crit">
    <!-- read -->
    <ol v-if="!editing" class="crit__list">
      <li v-for="(c, i) in criteria" :key="c.id" class="crit__row">
        <span class="crit__n vk-num">{{ String(i + 1).padStart(2, '0') }}</span>
        <div class="crit__body">
          <p class="crit__statement">{{ c.statement }}</p>
          <div class="crit__meta">
            <VPill size="sm" :dot="false" outline>
              <component :is="ICON[c.kind]" :size="12" :stroke-width="1.9" /> {{ KIND[c.kind]?.label || c.kind }}
            </VPill>
            <button v-if="c.method" type="button" class="crit__how" :aria-expanded="open.has(c.id)" @click="toggle(c.id)">
              How it's checked <ChevronDown :size="13" :stroke-width="1.9" :class="{ flip: open.has(c.id) }" />
            </button>
          </div>
          <Transition name="vk-fade">
            <p v-if="open.has(c.id)" class="crit__method">{{ c.method }}</p>
          </Transition>
        </div>
      </li>
    </ol>

    <!-- edit -->
    <div v-else class="crit__edit">
      <div v-for="(c, i) in draft" :key="i" class="crit__edit-row">
        <span class="crit__n vk-num">{{ String(i + 1).padStart(2, '0') }}</span>
        <select v-model="c.kind" class="vk-input crit__kind" :aria-label="`Type of check ${i + 1}`">
          <option v-for="(k, key) in KIND" :key="key" :value="key">{{ k.label }}</option>
        </select>
        <textarea v-model="c.statement" class="vk-textarea" rows="2" :aria-label="`Check ${i + 1}`" placeholder="Something the agent can test, e.g. “The contact form shows a confirmation after submit”" />
        <VIconButton :icon="Trash2" label="Remove this check" size="sm" bare @click="draft.splice(i, 1)" />
      </div>
      <div class="crit__edit-foot">
        <VButton variant="ghost" size="sm" :icon="Plus" @click="add">Add a check</VButton>
        <span class="vk-faint crit__note">Saving asks both of you to sign again.</span>
        <VButton variant="secondary" size="sm" @click="editing = false">Cancel</VButton>
        <VButton size="sm" :disabled="!valid" :loading="saving" @click="save">Save checks</VButton>
      </div>
    </div>

    <div v-if="editable && !editing" class="crit__tools">
      <VButton variant="ghost" size="sm" :icon="Pencil" @click="startEdit">Edit checks</VButton>
    </div>
  </div>
</template>

<style scoped>
.crit__list { margin: 0; padding: 0; list-style: none; }
.crit__row { display: flex; gap: 14px; padding: 14px 0; border-top: 1px solid var(--vk-line-subtle); }
.crit__row:first-child { border-top: 0; padding-top: 0; }
.crit__n { flex: none; width: 22px; padding-top: 2px; font-size: 12px; color: var(--vk-faint); }
.crit__body { flex: 1; min-width: 0; }
.crit__statement { margin: 0; font: var(--vk-type-body); color: var(--vk-ink); }
.crit__meta { display: flex; align-items: center; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
.crit__how { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font: var(--vk-type-small); color: var(--vk-muted); cursor: pointer; }
.crit__how:hover { color: var(--vk-ink); }
.crit__how svg { transition: transform var(--vk-dur-2); }
.crit__how svg.flip { transform: rotate(180deg); }
.crit__method { margin: 8px 0 0; padding: 10px 12px; border-radius: var(--vk-r-sm); background: var(--vk-surface-2); border: 1px solid var(--vk-line-subtle); font: var(--vk-type-dense); color: var(--vk-ink-2); }

.crit__edit { display: flex; flex-direction: column; gap: 10px; }
.crit__edit-row { display: grid; grid-template-columns: 22px 140px minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.crit__edit-row .crit__n { padding-top: 10px; }
.crit__kind { padding-right: 8px; }
.crit__edit-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 6px; }
.crit__note { flex: 1; font: var(--vk-type-small); text-align: right; }
.crit__tools { display: flex; justify-content: flex-end; margin-top: 6px; }
@media (max-width: 640px) {
  .crit__edit-row { grid-template-columns: 22px minmax(0, 1fr) auto; }
  .crit__kind { grid-column: 2; }
  .crit__edit-row textarea { grid-column: 2; }
}
</style>
