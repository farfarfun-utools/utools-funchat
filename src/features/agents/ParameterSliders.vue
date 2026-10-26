<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { useChatStore } from '../../stores/chat.js';
import { INERT_HINT, PARAMETER_ROWS, isInert, rangeStyle, type ParamKey, type ParamRow, type ParamValues } from './agent-params.js';

// 「参数调节」分页和「临时调参」浮层画的是同一组滑块，连 .parameter-row 那几条 CSS 都是
// 逐字复制的两份。组件化之后两边各自只剩「值存在哪、改完要不要落盘」的差别。
const props = defineProps({
  // 值存在调用方那边（AgentDialog 的 form、ChatPopover 的 params），这里只读不写，
  // 改动一律按 (key, value) 回传——要不要顺手落盘是调用方的事。
  values: { type: Object as PropType<ParamValues>, required: true },
});
const emit = defineEmits<{ update: [key: ParamKey, value: number] }>();

const store = useChatStore();
const viaUtools = computed(() => store.state.settings.provider === 'utools');
const rows = PARAMETER_ROWS;

function inert(row: ParamRow): boolean {
  return isInert(row.key, viaUtools.value);
}

function style(row: ParamRow): Record<string, string> {
  return rangeStyle(row, props.values[row.key]);
}

// 数字框清空时 value 是空串，Number('') 是 0——那会在用户还没输完的时候把值打成 0，
// 所以空串不回传，等敲出合法数字再说。
function update(row: ParamRow, event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  if (!raw.trim()) return;
  const next = Number(raw);
  if (Number.isFinite(next)) emit('update', row.key, next);
}
</script>

<template>
  <label
    v-for="row in rows"
    :key="row.key"
    class="parameter-row"
    :class="{ inert: inert(row) }"
    :title="inert(row) ? INERT_HINT : ''"
  >
    <span>{{ row.label }} <small>?</small></span>
    <input
      :value="values[row.key]"
      type="range"
      :min="row.min"
      :max="row.max"
      :step="row.step"
      :style="style(row)"
      :disabled="inert(row)"
      @input="update(row, $event)"
    >
    <input
      :value="values[row.key]"
      class="parameter-number"
      type="number"
      :min="row.min"
      :max="row.max"
      :step="row.step"
      :disabled="inert(row)"
      @change="update(row, $event)"
    >
  </label>
</template>

<style scoped>
.parameter-row { height: 44px; display: flex; align-items: center; }
/* 当前线路发不出去的参数：淡掉并禁用，让「调了没反应」变成「看得出调不了」 */
.parameter-row.inert { opacity: .45; cursor: not-allowed; }
.parameter-row > span { width: 90px; flex: 0 0 90px; color: var(--color-text-1); }
.parameter-row > span small { width: 12px; height: 12px; display: inline-grid; place-items: center; border: 1px solid var(--color-border-2); border-radius: 50%; color: var(--color-text-3); font-size: 9px; line-height: 10px; }
.parameter-row input[type="range"] { min-width: 0; height: 18px; margin: 0 20px 0 0; flex: 1; appearance: none; background: transparent; }
.parameter-row input[type="range"]::-webkit-slider-runnable-track { height: 2px; background: linear-gradient(to right, var(--color-primary) 0 var(--range-progress), var(--color-border-2) var(--range-progress) 100%); }
.parameter-row input[type="range"]::-webkit-slider-thumb { width: 12px; height: 12px; margin-top: -5px; appearance: none; border: 2px solid var(--color-primary); border-radius: 50%; background: var(--color-bg-2); }
.parameter-number { width: 80px; height: 32px; padding: 0 12px; border: 0; border-radius: 3px; outline: 0; background: var(--color-fill-2); text-align: center; }
.parameter-number::-webkit-inner-spin-button, .parameter-number::-webkit-outer-spin-button { appearance: none; margin: 0; }
@media (max-width: 480px) {
  .parameter-row > span { width: 76px; flex-basis: 76px; }
  .parameter-row input[type="range"] { margin-right: 12px; }
  .parameter-number { width: 64px; padding: 0 8px; }
}
</style>
