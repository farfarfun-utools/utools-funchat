<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useChatStore } from '../../stores/chat.js';
import { agentFormValues } from './agent-form.js';
import type { Agent, AgentFormValues } from '../../types.ts';
import type { ParamKey } from './agent-params.ts';
import AgentAvatar from './AgentAvatar.vue';
import ParameterSliders from './ParameterSliders.vue';
import ModelPickerDialog from '../chat/ModelPickerDialog.vue';

const store = useChatStore();
const dialog = ref();
const editing = ref<Agent | null>(null);
const tab = ref('basic');
const question = ref('');
// 先用「新建」的那套默认值把字段铺满：open() 里的 Object.assign 只覆盖不删除，
// 空对象起步的话模板在第一次 open 之前读到的全是 undefined。
const form = reactive<AgentFormValues>(agentFormValues(null));

const previewAgent = computed(() => ({
  nickname: form.nickname || 'AI',
  avatar: editing.value?.avatar || { type: 'icon', icon: 'icon-a1', color: '#0ca47f' },
}));
const modelOptions = computed(() => store.routeModels.value);
const picker = ref();

async function chooseModel() {
  const picked = await picker.value?.open(modelOptions.value, form.model ? [form.model] : [], {
    mode: 'single',
    hint: `共 ${modelOptions.value.length} 个可选模型，也可以直接在输入框里手填`,
  });
  if (picked?.length) form.model = picked[0];
}
const viaUtools = computed(() => store.state.settings.provider === 'utools');

function open(agent: Agent | null = null) {
  editing.value = agent;
  Object.assign(form, agentFormValues(agent));
  question.value = '';
  tab.value = 'basic';
  dialog.value.showModal();
  dialog.value.focus();
}

function submit() {
  if (!form.nickname.trim()) return;
  let paramsFunctions;
  try {
    paramsFunctions = form.type === 'function' && form.functions.trim() ? JSON.parse(form.functions) : undefined;
  } catch {
    tab.value = 'basic';
    return;
  }
  const values: AgentFormValues = { ...form, paramsFunctions };
  if (editing.value) store.updateAgent(editing.value, values);
  else store.addAgent(values);
  dialog.value.close();
}

// 表单只是暂存，改完等点「保存」才落盘——和临时调参浮层改完立刻写覆盖层不一样
function setParam(key: ParamKey, value: number) {
  form[key] = value;
}

function addQuestion() {
  const value = question.value.trim();
  if (!value) return;
  form.quick_questions.push(value);
  question.value = '';
}

defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="agent-dialog" :class="{ 'function-dialog': tab === 'basic' && form.type === 'function' }" tabindex="-1">
    <form method="dialog" @submit.prevent="submit">
      <div class="avatar-editor">
        <AgentAvatar :agent="previewAgent" :size="78" />
        <span class="avatar-edit" aria-hidden="true"><i class="iconfont icon-edit"></i></span>
      </div>

      <nav class="dialog-tabs" aria-label="好友设置分类">
        <button type="button" :class="{ active: tab === 'basic' }" @click="tab = 'basic'">基本设置</button>
        <button type="button" :class="{ active: tab === 'params' }" @click="tab = 'params'">参数调节</button>
        <button type="button" :class="{ active: tab === 'advanced' }" @click="tab = 'advanced'">高级设置</button>
      </nav>

      <section v-if="tab === 'basic'" class="dialog-pane basic-pane" :class="{ 'function-pane': form.type === 'function' }">
        <label class="form-row model-row">
          <span>模型选择</span>
          <span class="control model-field">
            <span class="model-input">
              <input v-model="form.model" placeholder="点右侧从列表选择，或直接手填">
              <button type="button" class="model-browse" @click="chooseModel"><i class="iconfont icon-params" aria-hidden="true"></i>浏览</button>
            </span>
            <small>手填也可以，注意区分大小写。</small>
          </span>
        </label>
        <div class="form-row type-row"><span>类型</span><div class="radios"><label><input v-model="form.type" type="radio" value="prompt">指令型好友</label><label><input v-model="form.type" type="radio" value="function">函数型好友（<b>开发手册</b>）</label></div></div>
        <label class="form-row required"><span>昵称</span><input v-model="form.nickname" required maxlength="30" placeholder="Ai昵称"></label>
        <label class="form-row"><span>备注</span><input v-model="form.info" maxlength="60" placeholder="Ai信息备注"></label>
        <label class="form-row"><span>招呼</span><input v-model="form.content" placeholder="Ai招呼语或功能描述"></label>
        <template v-if="form.type === 'prompt'">
          <label class="form-row textarea-row"><span>角色指令</span><span class="control"><textarea v-model="form.prompt" rows="2" placeholder="指定Ai性格、角色、功能、指令等"></textarea><small>角色或指令需清晰易懂，明确且有逻辑。参考 <b>角色调教指南</b></small></span></label>
          <label class="form-row prefix-row"><span>提问前缀</span><span class="control"><input v-model="form.autoPrefix" placeholder="副指令，如：请翻译：xxx"><small>当指令无法满足需求时,可通过提问前缀(副指令)强制Ai执行。</small></span></label>
        </template>
        <template v-else>
          <label class="form-row function-row"><span>函数对象</span><span class="control"><textarea v-model="form.functions" rows="2" placeholder="传入函数Json对象。留空将跳过函数调用，直接将输入当作参数。"></textarea></span></label>
        </template>
      </section>

      <section v-else-if="tab === 'params'" class="dialog-pane params-pane">
        <ParameterSliders :values="form" @update="setParam" />
        <!-- 当前线路根本收不下这些参数时，先说这件事；提示会写进哪里是次要的 -->
        <p v-if="viaUtools">uTools AI 不接受采样参数，仅「上下文数」有效。</p>
        <p v-else>参数留空则跟随全局设置，不会写入该好友。</p>
      </section>

      <section v-else class="dialog-pane advanced-pane">
        <label class="form-row"><span>超级面板</span><span class="advanced-control"><span class="panel-toggle"><span class="switch"><input v-model="form.superPanel" type="checkbox" role="switch" aria-label="显示在超级面板"><i></i></span><span>显示在超级面板</span></span><small>选中文字后点击此角色，将开启新话题并自动发送给当前配置的 AI 服务。</small></span></label>
        <label class="form-row question-row"><span>提问示例</span><span class="control tag-input"><span v-for="(item, index) in form.quick_questions" :key="`${item}-${index}`" class="question-tag">{{ item }}<button type="button" aria-label="删除提问示例" @click="form.quick_questions.splice(index, 1)">×</button></span><input v-model="question" placeholder="请输入问题示例，按回车添加" @keydown.enter.prevent="addQuestion"></span></label>
        <div class="form-row stream-row"><span>非流输出</span><div class="advanced-control"><div><span class="switch"><input v-model="form.un_stream" type="checkbox" role="switch"><i></i></span><small>启用后该Ai将会一次性输出结果。(等待时间较长-不建议)</small></div><small>某些对话模型如果不支持流式输出，可开启该功能。</small></div></div>
      </section>

      <footer><button type="button" @click="dialog.close()">取消</button><button class="primary" type="submit">保存</button></footer>
    </form>
  </dialog>

  <ModelPickerDialog ref="picker" />
</template>

<style scoped>
.agent-dialog { width: 560px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 20px); margin: auto; padding: 24px 32px 32px; overflow: visible; border: 0; border-radius: 12px; color: var(--color-text-2); background: var(--color-bg-3); line-height: 22px; transform: translateY(15px); }
.agent-dialog::backdrop { background: rgba(29, 33, 41, .6); }
.agent-dialog.function-dialog { transform: translateY(16.5px); }
.agent-dialog:focus { outline: 0; }
.agent-dialog form { position: relative; padding-top: 25px; }
.avatar-editor { position: absolute; z-index: 1; top: -60px; left: 50%; width: 78px; height: 78px; transform: translateX(-50%); }
.avatar-edit { position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; display: grid; place-items: center; border: 2px solid var(--color-bg-3); border-radius: 50%; color: var(--color-text-3); background: var(--color-fill-1); }
.avatar-edit i { font-size: 11px; }
.dialog-tabs { height: 50px; padding: 0 16px; display: flex; align-items: flex-end; gap: 32px; border-bottom: 1px solid var(--color-border-2); }
.dialog-tabs button { position: relative; height: 40px; padding: 8px 0; color: var(--color-text-1); line-height: 22px; }
.dialog-tabs button:focus-visible { outline-offset: -2px; }
.dialog-tabs button.active { color: var(--color-primary); font-weight: 500; }
.dialog-tabs button.active::after { content: ""; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--color-primary); }
.dialog-pane { width: 100%; padding-top: 16px; }
.form-row { min-height: 32px; margin-bottom: 20px; display: flex; align-items: flex-start; }
.form-row > span:first-child { width: 90px; flex: 0 0 90px; padding-top: 5px; }
.form-row.required > span:first-child::after { content: " *"; color: #f53f3f; }
.control, .form-row > input { position: relative; min-width: 0; flex: 1; }
.form-row > input, .control > input, .control > textarea, .control > select { width: 100%; border: 1px solid transparent; outline: 0; color: var(--color-text-2); background: var(--color-fill-2); }
.form-row > input, .control > input, .control > select { height: 32px; padding: 0 12px; border-radius: 12px; font: inherit; }
.control > textarea { height: 54px; min-height: 54px; padding: 4px 12px; border-radius: 12px; resize: none; line-height: 22px; }
.form-row > input:focus, .control > input:focus, .control > textarea:focus, .control > select:focus { border-color: var(--color-primary); background: var(--color-bg-2); }
.control small { display: block; color: var(--color-text-3); font-size: 12px; line-height: 19px; }
.control small b, .radios b { color: var(--color-primary); font-weight: 400; }
.model-row { margin-bottom: 20px; }
.model-row .control { min-height: 55px; }
.model-field { display: flex; flex-direction: column; gap: 6px; }
.model-input { display: flex; align-items: center; gap: 8px; }
.model-input > input { min-width: 0; flex: 1; }
.model-browse { height: 32px; padding: 0 14px; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; border: 1px solid var(--color-border-2); border-radius: 12px; color: var(--color-text-2); font-size: 13px; white-space: nowrap; }
.model-browse:hover { color: var(--color-primary); border-color: var(--color-primary); }
.model-browse .iconfont { font-size: 14px; }
.type-row { margin-bottom: 20px; align-items: center; }
.type-row > span:first-child { padding-top: 0; }
.radios { display: flex; align-items: center; gap: 24px; }
.radios label { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.radios input { width: 14px; height: 14px; margin: 0; accent-color: var(--color-primary); }
.textarea-row { margin-bottom: 20px; }
.prefix-row { margin-bottom: 20px; }
.prefix-row .control small { line-height: 23px; }
.function-row { height: 54px; margin-bottom: 20px; }
.switch { position: relative; width: 28px; height: 16px; display: inline-block; flex: 0 0 28px; vertical-align: middle; }
.switch input { position: absolute; opacity: 0; }
.switch i { position: absolute; inset: 0; border-radius: 8px; background: #c9cdd4; }
.switch i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .2s ease; }
.switch input:checked + i { background: var(--color-primary); }
.switch input:checked + i::after { transform: translateX(12px); }
.switch input:focus-visible + i { outline: 2px solid var(--color-primary); outline-offset: 3px; }
.panel-toggle { min-height: 24px; display: flex; align-items: center; gap: 10px; }
/* 各分页的高度基准按行数配平，切换分页时弹窗不会跳动。删减表单行时记得一起下调。 */
.basic-pane { min-height: 484px; transform: translateY(-.765625px); }
.basic-pane.function-pane { min-height: 384px; }
.params-pane { min-height: 302px; padding: 16px 12px 0; }
.params-pane p { margin-left: 90px; color: var(--color-text-3); font-size: 12px; }
.advanced-pane { min-height: 135px; padding: 16px 12px 0; }
.advanced-pane .form-row { margin-bottom: 12px; }
.advanced-pane .form-row > span:first-child { width: 90px; flex-basis: 90px; }
.tag-input { min-height: 32px; padding: 0 12px; display: flex; align-items: center; gap: 4px; overflow: hidden; border-radius: 12px; background: var(--color-fill-2); }
.tag-input input { min-width: 100px; padding: 0; flex: 1; background: transparent; }
.question-tag { padding: 0 6px; border-radius: 3px; background: var(--color-primary-light-1); white-space: nowrap; }
.question-tag button { margin-left: 4px; }
.advanced-control { min-width: 0; flex: 1; }
.advanced-control > div { height: 24px; display: flex; align-items: center; gap: 10px; }
.advanced-control > small { display: block; color: var(--color-text-3); font-size: 12px; line-height: 19px; }
.advanced-control div > small { color: var(--color-text-3); font-size: 12px; }
.stream-row { margin-bottom: 0 !important; }
.agent-dialog footer { height: 32px; margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 12px; }
.agent-dialog footer button { height: 32px; padding: 0 15px; border: 1px solid transparent; border-radius: 12px; background: var(--color-fill-2); }
.agent-dialog footer .primary { color: #fff; background: var(--color-primary); }
@media (max-height: 860px) {
  .agent-dialog { overflow-y: auto; }
  .avatar-editor { top: -50px; }
}
</style>
