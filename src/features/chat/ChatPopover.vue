<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { fetchModels } from '../../services/models.js';
import { useChatStore } from '../../stores/chat.js';
import ModelPickerDialog from './ModelPickerDialog.vue';

const props = defineProps({ kind: { type: String, required: true } });
const emit = defineEmits(['close']);
const store = useChatStore();

function paramValue(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* ---------- API 线路 ---------- */

const tab = ref('routes');
const routes = computed(() => store.state.settings.apiRoutes || []);
const editingId = ref<string>(store.state.settings.activeRouteId || routes.value[0]?.id || '');

const blankRoute = () => ({ id: '', name: '', provider: 'openai', baseUrl: '', apiKey: '', models: [] as string[], modelsFetchedAt: 0 });
const draft = reactive(blankRoute());
const pulling = ref(false);
const pullError = ref('');
const picker = ref();
// 只保留勾选结果会丢掉没勾的那些，所以本次拉取的全量清单先留在内存里，
// 这样「管理」可以反复增删，不必为了找回某个模型重新拉一次。
const pulledAll = ref<string[]>([]);

const pulledAt = computed(() => {
  if (!draft.modelsFetchedAt) return '';
  return new Date(draft.modelsFetchedAt).toLocaleString('zh-CN', { hour12: false });
});

// 拉取只认输入框里的当前值，所以不用先保存线路就能验证地址和密钥是否可用。
// 勾选结果落在 draft 上，由「保存线路」连同其他字段一起写进设置。
async function pullModels() {
  if (pulling.value) return;
  pullError.value = '';
  pulling.value = true;
  try {
    const models = await fetchModels({ provider: draft.provider, baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() });
    pulledAll.value = models;
    pulling.value = false;
    const kept = await picker.value?.open(models, draft.models, {
      hint: `拉取到 ${models.length} 个模型，只有勾选的会保存进这条线路`,
    });
    if (kept) {
      draft.models = kept;
      draft.modelsFetchedAt = Date.now();
    }
  } catch (error) {
    pullError.value = error instanceof Error ? error.message : String(error);
  } finally {
    pulling.value = false;
  }
}

async function manageModels() {
  const source = pulledAll.value.length ? pulledAll.value : draft.models;
  const kept = await picker.value?.open(source, draft.models, {
    hint: pulledAll.value.length ? '' : '这是已保存的清单；想找回未勾选的模型请重新拉取',
  });
  if (kept) draft.models = kept;
}

function loadDraft(routeId: string) {
  const route = routes.value.find((item) => item.id === routeId);
  Object.assign(draft, route ? { ...blankRoute(), ...route } : blankRoute());
  pullError.value = '';
  pulledAll.value = [];
}
loadDraft(editingId.value);
watch(editingId, loadDraft);

function editRoute(routeId: string) {
  editingId.value = routeId;
}

function addRoute() {
  editingId.value = '';
  Object.assign(draft, blankRoute());
}

function saveRoute() {
  if (draft.provider !== 'utools' && !draft.baseUrl.trim()) return;
  const saved = {
    id: draft.id,
    name: draft.name.trim() || (draft.provider === 'utools' ? 'uTools AI' : '未命名线路'),
    provider: draft.provider,
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    models: draft.models,
    modelsFetchedAt: draft.modelsFetchedAt,
  };
  store.saveApiRoute(saved);
  editingId.value = store.state.settings.activeRouteId || '';
  emit('close');
}

function deleteRoute(routeId: string) {
  store.removeApiRoute(routeId);
  editingId.value = store.state.settings.activeRouteId || '';
  loadDraft(editingId.value);
}

function useRoute(routeId: string) {
  store.selectApiRoute(routeId);
  editingId.value = routeId;
}

/* ---------- 临时调参 ---------- */

// 好友自己的设置打底，本话题已经临时改过的则显示改后的值
const overrides = store.paramOverrides;
const params = reactive({
  model: overrides.model ?? store.state.currentAgent?.params?.model ?? '',
  contextLength: Number(overrides.contextLength ?? store.state.currentAgent?.contextLength) || 16,
  max_tokens: paramValue(overrides.max_tokens ?? store.state.currentAgent?.params?.max_tokens, 900),
  temperature: paramValue(overrides.temperature ?? store.state.currentAgent?.params?.temperature, 0.6),
  top_p: paramValue(overrides.top_p ?? store.state.currentAgent?.params?.top_p, 1),
  frequency_penalty: paramValue(overrides.frequency_penalty ?? store.state.currentAgent?.params?.frequency_penalty, 0),
  presence_penalty: paramValue(overrides.presence_penalty ?? store.state.currentAgent?.params?.presence_penalty, 0),
});

const modelOptions = computed(() => store.routeModels.value);

async function chooseModel() {
  const picked = await picker.value?.open(modelOptions.value, params.model ? [params.model] : [], {
    mode: 'single',
    title: '选择模型',
    hint: `共 ${modelOptions.value.length} 个可选模型，也可以直接在输入框里手填`,
  });
  if (!picked?.length) return;
  params.model = picked[0];
  saveParams();
}

type ParamRow = { key: keyof typeof params; label: string; min: number; max: number; step: number };

// uTools AI 只接受 model / messages / tools，采样参数一概丢弃（见 services/chat.ts 的说明）。
// 「上下文数」是本地裁剪消息列表用的，两条线路都算数，所以不在这张名单里。
const INERT_ON_UTOOLS = new Set(['max_tokens', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty']);
const viaUtools = computed(() => store.state.settings.provider === 'utools');

/** 这一项在当前线路上是不是发不出去。禁用而不是让用户空拖一遍滑块。 */
function inert(row: ParamRow): boolean {
  return viaUtools.value && INERT_ON_UTOOLS.has(row.key);
}

const parameterRows: ParamRow[] = [
  { key: 'contextLength', label: '上下文数', min: 2, max: 36, step: 1 },
  { key: 'max_tokens', label: '最大回复', min: 0, max: 16384, step: 1 },
  { key: 'temperature', label: '随机性', min: 0, max: 2, step: 0.1 },
  { key: 'top_p', label: '核采样', min: 0, max: 1, step: 0.1 },
  { key: 'frequency_penalty', label: '频率惩罚', min: -2, max: 2, step: 0.1 },
  { key: 'presence_penalty', label: '存在惩罚', min: -2, max: 2, step: 0.1 },
];

// 只写进 store 的临时覆盖层，好友文档一个字节都不动，换话题即失效
function saveParams() {
  if (!store.state.currentAgent) return;
  store.setParamOverrides({
    model: params.model.trim(),
    contextLength: params.contextLength,
    max_tokens: params.max_tokens,
    temperature: params.temperature,
    top_p: params.top_p,
    frequency_penalty: params.frequency_penalty,
    presence_penalty: params.presence_penalty,
  });
}

function rangeStyle(row: ParamRow) {
  return { '--range-progress': `${((Number(params[row.key]) - row.min) / (row.max - row.min)) * 100}%` };
}
</script>

<template>
  <section v-if="props.kind === 'api'" class="chat-popover api-popover" role="dialog" aria-label="API路线管理">
    <nav class="api-tabs" aria-label="API设置分类">
      <button type="button" :class="{ active: tab === 'routes' }" @click="tab = 'routes'">API路线管理</button>
      <button type="button" :class="{ active: tab === 'notice' }" @click="tab = 'notice'">服务声明</button>
    </nav>

    <div v-if="tab === 'routes'" class="route-layout">
      <aside class="route-list" aria-label="已保存的线路">
        <button
          v-for="route in routes"
          :key="route.id"
          type="button"
          class="route-item"
          :class="{ editing: route.id === editingId, active: route.id === store.state.settings.activeRouteId }"
          @click="editRoute(route.id)"
        >
          <span class="route-dot" aria-hidden="true"></span>
          <span class="route-meta">
            <b>{{ route.name || '未命名线路' }}</b>
            <small>{{ route.provider === 'utools' ? 'uTools AI' : (route.baseUrl || '未填地址') }}</small>
          </span>
          <span v-if="route.id === store.state.settings.activeRouteId" class="route-badge">使用中</span>
        </button>
        <p v-if="!routes.length" class="route-empty">还没有线路，右侧填一条</p>
        <button type="button" class="route-add" @click="addRoute">＋ 新增线路</button>
      </aside>

      <form class="api-form" @submit.prevent="saveRoute">
        <div class="api-fields">
        <label class="form-row required">
          <span>API路线</span>
          <span class="select-control">
            <select v-model="draft.provider">
              <option value="openai">私有API路线</option>
              <option value="utools">uTools AI</option>
            </select>
            <i class="iconfont icon-down" aria-hidden="true"></i>
          </span>
        </label>
        <label class="form-row"><span>API别名</span><input v-model="draft.name" placeholder="随意起个别名，方便记忆"></label>
        <label v-if="draft.provider !== 'utools'" class="form-row required">
          <span>API地址</span>
          <span class="field-stack">
            <input v-model="draft.baseUrl" placeholder="示例: https://api.gpt.ge 或完整.../completions路径">
            <small>若不希望自动拼接 .../chat/completions 后缀，请在地址末尾加 #</small>
          </span>
        </label>
        <label v-if="draft.provider !== 'utools'" class="form-row">
          <span>KEY秘钥</span>
          <input v-model="draft.apiKey" type="password" autocomplete="off" placeholder="请复制或输入KEY秘钥（令牌）到这里">
        </label>
        <div class="form-row">
          <span>可用模型</span>
          <span class="field-stack">
            <span class="models-buttons">
              <button type="button" class="pull-models" :disabled="pulling || (draft.provider !== 'utools' && !draft.baseUrl.trim())" @click="pullModels">
                <i class="iconfont icon-refresh" :class="{ spinning: pulling }" aria-hidden="true"></i>{{ pulling ? '拉取中…' : '拉取模型' }}
              </button>
              <button v-if="draft.models.length" type="button" class="manage-models" @click="manageModels">已选 {{ draft.models.length }} 个 · 管理</button>
            </span>
            <small v-if="pullError" class="models-error" role="alert" :title="pullError">{{ pullError }}</small>
            <small v-else-if="draft.models.length">保存线路后生效<template v-if="pulledAt"> · 拉取于 {{ pulledAt }}</template></small>
            <small v-else>填好地址与密钥后点一下，再勾选要保留的模型</small>
          </span>
        </div>
        </div>
        <footer>
          <button v-if="draft.id && draft.id !== store.state.settings.activeRouteId" type="button" class="route-use" @click="useRoute(draft.id)">设为当前</button>
          <button v-if="draft.id" type="button" class="route-delete" @click="deleteRoute(draft.id)">删除</button>
          <button class="save-api" type="submit">{{ draft.id ? '保存线路' : '添加线路' }}</button>
        </footer>
      </form>
    </div>

    <div v-else class="service-notice">
      <p>本插件仅限个人学习及体验 AI 成果，请勿用于任何违法行为。因使用本插件产生的一切后果，均由使用者自行承担。</p>
      <h3>关于私有API路线</h3><p>适配 OpenAI 兼容接口，可保存多条地址与密钥并随时切换。</p>
      <h3>关于 uTools AI</h3><p>使用客户端内置 AI 能力，无需额外填写 API 地址。</p>
    </div>
  </section>

  <section v-else class="chat-popover params-popover" role="dialog" aria-label="临时调参">
    <header>
      <b>临时调参</b><small>发起新话题后失效</small>
      <!-- 当前线路发不出采样参数时，先把这件事讲清楚，比提示去哪儿永久保存更要紧 -->
      <span v-if="viaUtools" class="route-caveat">ⓘ uTools AI 不接受采样参数</span>
      <span v-else>ⓘ 永久保存模型方法</span>
    </header>
    <label class="model-row">
      <b>模型选择</b>
      <span class="model-control">
        <span class="model-input">
          <input v-model="params.model" placeholder="点右侧从列表选择，或直接手填" @change="saveParams">
          <button type="button" class="model-browse" @click="chooseModel">
            <i class="iconfont icon-params" aria-hidden="true"></i>浏览
          </button>
        </span>
        <small>手填也可以，注意区分大小写。</small>
      </span>
    </label>
    <label v-for="row in parameterRows" :key="row.key" class="parameter-row" :class="{ inert: inert(row) }" :title="inert(row) ? '这项发不到 uTools AI，换到私有API路线才生效' : ''"><span>{{ row.label }} <small>ⓘ</small></span><input v-model.number="params[row.key]" type="range" :min="row.min" :max="row.max" :step="row.step" :style="rangeStyle(row)" :disabled="inert(row)" @input="saveParams"><input v-model.number="params[row.key]" class="parameter-number" type="number" :min="row.min" :max="row.max" :step="row.step" :disabled="inert(row)" @change="saveParams"></label>

  </section>

  <!-- 两个面板共用一个弹窗实例：分别挂在两个 v-if 分支里的话，kind 切换时 ref 的
       解绑与绑定顺序没有保证，可能留下一个 null -->
  <ModelPickerDialog ref="picker" />
</template>

<style scoped>
.chat-popover { position: absolute; z-index: 80; right: 0; bottom: calc(var(--composer-height, 160px) - 1px); color: var(--color-text-2); background: var(--color-bg-2); border: 1px solid var(--color-border-2); border-radius: 8px 0 0 8px; box-shadow: 0 4px 10px #0000001a; line-height: 22px; }
.api-popover { width: 620px; height: 378px; padding-bottom: 12px; }
.api-tabs { height: 44px; padding: 0 8px; display: flex; align-items: stretch; border-bottom: 1px solid var(--color-border-2); }
.api-tabs button { position: relative; height: 40px; margin: 0 10px; color: var(--color-text-1); }
.api-tabs button.active { color: var(--color-primary); }
.api-tabs button.active::after { content: ""; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--color-primary); }

.route-layout { height: 322px; display: flex; }
.route-list { width: 176px; padding: 10px 8px; display: flex; flex-direction: column; gap: 4px; flex: 0 0 176px; overflow-y: auto; border-right: 1px solid var(--color-border-2); }
.route-item { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; text-align: left; }
.route-item:hover { background: var(--color-fill-1); }
.route-item.editing { background: var(--color-fill-2); }
.route-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--color-border-2); }
.route-item.active .route-dot { background: var(--color-primary); }
.route-meta { min-width: 0; display: flex; flex-direction: column; flex: 1; }
.route-meta b { overflow: hidden; color: var(--color-text-1); font-size: 13px; font-weight: 500; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.route-meta small { overflow: hidden; color: var(--color-text-3); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.route-badge { flex: 0 0 auto; padding: 0 5px; border-radius: 8px; color: var(--color-primary); background: var(--color-primary-light-1); font-size: 10px; line-height: 16px; }
.route-empty { padding: 12px 9px; color: var(--color-text-3); font-size: 12px; }
.route-add { margin-top: auto; padding: 7px; flex: 0 0 auto; border: 1px dashed var(--color-border-2); border-radius: 8px; color: var(--color-text-2); font-size: 12px; }
.route-add:hover { border-color: var(--color-primary); color: var(--color-primary); }

.api-form { min-width: 0; padding: 18px 20px 12px; display: flex; flex: 1; flex-direction: column; }
/* 字段区独立滚动：字段再多也只是这里出滚动条，保存按钮不会被顶出可视区 */
.api-fields { min-height: 0; margin: -4px -4px 10px; padding: 4px; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.api-fields::-webkit-scrollbar { width: 6px; }
.api-fields::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--color-fill-3); }
/* 输入 + 下方提示竖排，取代原来给提示做绝对定位、再给整行留 32px 的做法 */
.field-stack { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 4px; }
.field-stack > small { color: var(--color-text-3); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.models-buttons { display: flex; align-items: center; gap: 8px; }
.models-error { color: #f53f3f; }
.form-row { min-height: 32px; margin-bottom: 14px; display: flex; align-items: flex-start; gap: 10px; }
.form-row > span:first-child { padding-top: 6px; }
.pull-models, .manage-models { height: 32px; padding: 0 14px; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; border: 1px solid var(--color-border-2); border-radius: 12px; color: var(--color-text-2); font-size: 13px; white-space: nowrap; }
.manage-models:hover { color: var(--color-primary); border-color: var(--color-primary); }
.pull-models:hover:not(:disabled) { color: var(--color-primary); border-color: var(--color-primary); }
.pull-models:disabled { opacity: .5; }
.pull-models .iconfont { font-size: 14px; }
.pull-models .spinning { animation: pull-spin .9s linear infinite; }
@keyframes pull-spin { to { transform: rotate(360deg); } }
.form-row > span:first-child { width: 62px; flex: 0 0 62px; text-align: right; }
.form-row.required > span:first-child::before { content: "*"; margin-right: 3px; color: #f53f3f; }
.form-row > input, .field-stack > input, .select-control { min-width: 0; height: 32px; padding: 0 13px; flex: 1 0 auto; border: 1px solid transparent; border-radius: 12px; outline: 0; background: var(--color-fill-2); }
.form-row > input:focus, .field-stack > input:focus, .select-control:focus-within { border-color: var(--color-primary); background: var(--color-bg-2); }
.select-control { position: relative; padding: 0; }
.select-control select { width: 100%; height: 30px; padding: 0 34px 0 13px; appearance: none; border: 0; outline: 0; color: inherit; background: transparent; }
.select-control i { position: absolute; top: 6px; right: 13px; color: var(--color-icon); font-size: 12px; pointer-events: none; }
.api-form footer { height: 32px; margin-top: auto; display: flex; gap: 8px; }
.api-form footer button { height: 32px; padding: 0 12px; border-radius: 12px; }
.route-use { background: var(--color-fill-2); }
.route-use:hover { color: var(--color-primary); }
.route-delete { color: #f53f3f; background: var(--color-fill-2); }
.save-api { flex: 1; color: #fff; background: var(--color-primary); }
.service-notice { height: 310px; padding: 18px 20px; overflow-y: auto; font-size: 13px; }
.service-notice > p:first-child { padding: 12px; border-radius: 12px; background: var(--color-primary-light-1); }
.service-notice h3 { margin: 16px 0 4px; font-size: 14px; }

.params-popover { width: 552px; height: 394px; padding: 14px 16px 16px; }
.params-popover header { height: 34px; display: flex; align-items: flex-start; }
.params-popover header b { color: var(--color-text-1); font-weight: 500; }
.params-popover header small { margin-left: 8px; color: #f759ab; font-size: 12px; }
.params-popover header span { margin-left: auto; color: var(--color-text-3); font-size: 12px; }
.params-popover header .route-caveat { color: #f759ab; }
.model-row { margin-bottom: 10px; display: flex; align-items: flex-start; }
.model-row > b { width: 90px; padding-top: 7px; font-weight: 400; text-align: right; }
.model-control { position: relative; min-width: 0; margin-left: 18px; flex: 1; }
.model-input { display: flex; align-items: center; gap: 8px; }
.model-input > input { min-width: 0; height: 32px; padding: 0 13px; flex: 1; border: 1px solid transparent; border-radius: 12px; outline: 0; color: inherit; background: var(--color-fill-2); }
.model-input > input:focus { border-color: var(--color-primary); background: var(--color-bg-2); }
.model-browse { height: 32px; padding: 0 14px; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; border: 1px solid var(--color-border-2); border-radius: 12px; color: var(--color-text-2); font-size: 13px; white-space: nowrap; }
.model-browse:hover { color: var(--color-primary); border-color: var(--color-primary); }
.model-browse .iconfont { font-size: 14px; }
.model-control > small { display: block; margin-top: 6px; color: var(--color-text-3); font-size: 12px; }
.parameter-row { height: 44px; display: flex; align-items: center; }
/* 当前线路发不出去的参数：淡掉并禁用，让「调了没反应」变成「看得出调不了」 */
.parameter-row.inert { opacity: .45; cursor: not-allowed; }
.parameter-row > span { width: 90px; flex: 0 0 90px; color: var(--color-text-1); }
.parameter-row > span small { color: #b7bdc7; font-size: 11px; }
.parameter-row input[type="range"] { min-width: 0; height: 18px; margin: 0 20px 0 0; flex: 1; appearance: none; background: transparent; }
.parameter-row input[type="range"]::-webkit-slider-runnable-track { height: 2px; background: linear-gradient(to right, var(--color-primary) 0 var(--range-progress), var(--color-border-2) var(--range-progress) 100%); }
.parameter-row input[type="range"]::-webkit-slider-thumb { width: 12px; height: 12px; margin-top: -5px; appearance: none; border: 2px solid var(--color-primary); border-radius: 50%; background: var(--color-bg-2); }
.parameter-number { width: 80px; height: 32px; padding: 0 12px; border: 0; border-radius: 3px; outline: 0; background: var(--color-fill-2); text-align: center; }
.parameter-number::-webkit-inner-spin-button, .parameter-number::-webkit-outer-spin-button { appearance: none; margin: 0; }
</style>
