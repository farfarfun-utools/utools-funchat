<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { saveAgent } from '../../services/storage.js';
import { useChatStore } from '../../stores/chat.js';
import ModelPickerDialog from '../chat/ModelPickerDialog.vue';

const store = useChatStore();
const preferences = reactive({
  windowHeight: Number(store.state.settings.windowHeight) || 660,
});
const selectedAgents = ref<string[]>([]);
const modelFilter = ref('');
const targetModel = ref('');
const sourceAgents = computed(() => store.state.agents.filter((agent) => {
  if (selectedAgents.value.includes(agent._id)) return false;
  return !modelFilter.value || (agent.params?.model || '').toLocaleLowerCase().includes(modelFilter.value.toLocaleLowerCase());
}));
const targetAgents = computed(() => store.state.agents.filter((agent) => selectedAgents.value.includes(agent._id)));
const modelOptions = computed(() => store.routeModels.value);
const picker = ref();

async function chooseTargetModel() {
  const picked = await picker.value?.open(modelOptions.value, targetModel.value ? [targetModel.value] : [], {
    mode: 'single',
    title: '选择目标模型',
    hint: `共 ${modelOptions.value.length} 个可选模型，批量替换会写入右侧全部好友`,
  });
  if (picked?.length) targetModel.value = picked[0];
}

function savePreferences() {
  store.updateSettings({ ...preferences });
}

function replaceModels() {
  const model = targetModel.value.trim();
  if (!model || !selectedAgents.value.length) return;
  for (const agent of targetAgents.value) {
    agent.params = { ...agent.params, model };
    saveAgent(agent);
  }
  selectedAgents.value = [];
  targetModel.value = '';
}
</script>

<template>
  <main class="reference-settings">
    <section class="reference-card preference-card">
      <div class="setting-row height-row">
        <div class="reference-label">插件高度</div>
        <div class="reference-body">
          <div class="height-control">
            <input v-model.number="preferences.windowHeight" type="range" min="450" max="1000" @change="savePreferences">
            <input v-model.number="preferences.windowHeight" class="height-number" type="number" min="450" max="1000" @change="savePreferences">
          </div>
          <small>仅在“插件未分离”和“自动分离后宽度最小”的时候生效（为了兼容分离插件后拖动窗口的记忆功能）</small>
        </div>
      </div>
    </section>

    <section class="reference-card model-card">
      <div class="reference-label">模型更新</div>
      <div class="reference-body model-body">
        <div class="model-transfer">
          <div class="transfer-view source-view">
            <header><b>待选好友</b><span>{{ sourceAgents.length }}</span></header>
            <label class="model-search"><i class="iconfont icon-search" aria-hidden="true"></i><input v-model="modelFilter" placeholder="按模型筛选好友"></label>
            <div class="transfer-list">
              <button v-for="agent in sourceAgents" :key="agent._id" type="button" @click="selectedAgents.push(agent._id)">{{ agent.nickname }}</button>
            </div>
          </div>
          <div class="transfer-view target-view">
            <header><b>目标好友</b><span>{{ targetAgents.length }}</span><button type="button" title="清空" aria-label="清空" @click="selectedAgents = []"><i class="iconfont icon-delete"></i></button></header>
            <label class="target-model"><input v-model="targetModel" placeholder="选择或手填目标模型"><button type="button" class="target-browse" title="从模型列表选择" aria-label="从模型列表选择" @click="chooseTargetModel"><i class="iconfont icon-down" aria-hidden="true"></i></button></label>
            <div v-if="targetAgents.length" class="transfer-list">
              <button v-for="agent in targetAgents" :key="agent._id" type="button" @click="selectedAgents = selectedAgents.filter((id) => id !== agent._id)">{{ agent.nickname }}</button>
            </div>
            <div v-else class="transfer-empty">
              <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 25h30l5 10v8H4v-8zM15 35l3 4h12l3-4M24 4v10M8 10l7 7M40 10l-7 7" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
              <span>暂无数据</span>
            </div>
          </div>
        </div>
        <button class="replace-button" type="button" @click="replaceModels"><i class="iconfont icon-refresh" aria-hidden="true"></i>一键批量替换模型</button>
        <div class="instructions"><p>使用说明：</p><p>1、在左侧点击需要替换的好友到右侧。</p><p>2、在右侧选择目标模型。</p><p>3、点击“一键替换”按钮进行批量替换模型。</p></div>
      </div>
    </section>

  </main>

  <ModelPickerDialog ref="picker" />
</template>

<style scoped>
.target-model > .target-browse { position: absolute; top: 0; right: 10px; width: 34px; height: 36px; display: grid; place-items: center; color: var(--color-icon); }
.target-model > .target-browse:hover { color: var(--color-primary); }

.reference-settings { min-width: 0; height: 100%; padding: 20px; flex: 1; overflow-y: auto; background: transparent; line-height: 1.8; }
.reference-settings { scrollbar-width: none; }
.reference-settings::-webkit-scrollbar { width: 0; height: 0; }
.reference-card { width: 100%; margin-bottom: 12px; padding: 32px; display: flex; border-radius: 12px; background: var(--color-bg-3); }
.reference-label { width: 120px; flex: 0 0 120px; color: var(--color-text-2); }
.reference-body { min-width: 0; flex: 1; }
.preference-card { height: 159px; flex-direction: column; }
.setting-row { display: flex; }
.height-row { height: 58px; margin-bottom: 12px; }
.height-control { height: 32px; display: flex; align-items: center; gap: 20px; }
.height-control input[type="range"] { height: 18px; min-width: 200px; flex: 1; appearance: none; background: transparent; }
.height-control input[type="range"]::-webkit-slider-runnable-track { height: 2px; border-radius: 1px; background: linear-gradient(to right, var(--color-primary) 0 38%, var(--color-border-2) 38% 100%); }
.height-control input[type="range"]::-webkit-slider-thumb { width: 12px; height: 12px; margin-top: -5px; appearance: none; border: 2px solid var(--color-primary); border-radius: 50%; background: var(--color-bg-2); }
.height-number { width: 80px; height: 32px; padding: 0 12px; border: 0; border-radius: 3px; outline: 0; color: var(--color-text-2); background: var(--color-fill-2); font-weight: 400; text-align: center; }
.height-number::-webkit-inner-spin-button, .height-number::-webkit-outer-spin-button { appearance: none; margin: 0; }
.reference-body small { color: var(--color-text-3); font-size: 12px; }
.inline-body { display: flex; align-items: center; }
.inline-body small { margin-left: 8px; }
.model-card { height: 571px; }
.model-body { height: 507px; }
.model-transfer { width: 520px; height: 350px; display: flex; }
.reference-settings .transfer-view { width: 260px; height: 350px; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--color-border-2); border-radius: 4px 0 0 4px; }
.reference-settings .transfer-view + .transfer-view { border-left: 0; border-radius: 0 4px 4px 0; }
.reference-settings .transfer-view header { height: 42px; padding: 0 10px; display: flex; flex: 0 0 42px; align-items: center; background: var(--color-fill-1); }
.reference-settings .transfer-view header b { flex: 1; font-size: 14px; font-weight: 500; }
.reference-settings .transfer-view header span { margin-right: 8px; color: var(--color-text-3); font-size: 12px; }
.reference-settings .transfer-view header button { width: 20px; height: 28px; color: var(--color-icon); }
.reference-settings .source-view header span { margin-right: 2px; }
.reference-settings .target-view header b { flex: 0 0 136px; }
.reference-settings .target-view header button { margin-left: auto; }
.model-search, .target-model { position: relative; height: 50px; padding: 0 10px 14px; display: flex; flex: 0 0 50px; align-items: flex-start; background: var(--color-fill-1); }
.model-search { position: relative; }
.model-search i { position: absolute; left: 24px; color: var(--color-icon); font-size: 14px; }
.model-search input, .target-model input { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--color-border-2); border-radius: 12px; outline: 0; background: var(--color-bg-3); }
.model-search input { padding-left: 38px; }
.target-model input { padding-right: 38px; }
.model-search input:focus, .target-model input:focus { border-color: var(--color-primary); }
.reference-settings .transfer-list { flex: 1; overflow-y: auto; }
.reference-settings .transfer-list { scrollbar-width: none; }
.reference-settings .transfer-list::-webkit-scrollbar { width: 0; height: 0; }
.reference-settings .transfer-list button { width: 100%; height: 36px; padding: 0 10px; color: var(--color-text-2); line-height: 36px; text-align: left; }
.reference-settings .transfer-list button:hover { color: var(--color-text-1); background: var(--color-fill-2); }
.transfer-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--color-text-3); }
.transfer-empty svg { width: 48px; height: 48px; color: #a9aeb8; }
.transfer-empty span { margin-top: 4px; }
.replace-button { width: 530px; height: 32px; margin-top: 12px; border-radius: 12px; color: #fff; background: var(--color-primary); }
.replace-button i { margin-right: 8px; color: #fff; }
.reference-settings .instructions { height: 101px; margin-top: 12px; color: var(--color-text-3); }
.reference-settings .instructions p { height: 25px; margin: 0; }
@media (max-width: 720px) {
  .reference-settings { padding: 12px; }
  .reference-card { min-width: 650px; padding: 24px; }
}
</style>
