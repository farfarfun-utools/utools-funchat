<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { saveAgent } from '../../services/storage.js';
import { applyBackup, backupFilename, buildBackup, parseBackup, serializeBackup } from '../../services/backup.js';
import { downloadInBrowser } from '../chat/message-tools.js';
import { useChatStore } from '../../stores/chat.js';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
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

const confirmDialog = ref<InstanceType<typeof ConfirmDialog>>();
const restoreInput = ref<HTMLInputElement>();
const backupStatus = ref('');
const backupBusy = ref(false);

async function exportBackup() {
  const agreed = await confirmDialog.value?.open({
    title: '导出备份',
    // 这里不能只说「内容为明文」：用户要掂量的是「这个文件丢了会怎样」，而答案是
    // 别人可以拿你的密钥调用你的账号。
    message: '备份包含好友、全部会话，以及 API 路线里的明文密钥——拿到文件的人可以用你的账号调用服务。请妥善保管。',
    confirmText: '导出',
  });
  if (!agreed) return;

  backupBusy.value = true;
  try {
    // 正在看的这段对话可能还没落盘（平时是退出插件时才写），不先存一下，导出的备份里
    // 就缺了用户刚说完的那几句——而这恰恰是他最可能想保住的部分。
    store.persistCurrentConversation();
    const backup = buildBackup();
    const filename = backupFilename();
    const content = serializeBackup(backup);

    // 不走 message-tools 的 saveToDisk：它把「用户在对话框里点了取消」和「这个环境压根
    // 没有原生保存能力」都返回成 false，图片导出那边据此退回浏览器下载——放在这里就成了
    // 「点了取消反而下载下来一份」。所以自己判断有没有桥接，取消就安静收场。
    if (typeof window.saveFile === 'function') {
      const saved = await window.saveFile({
        title: '导出 FunChat 备份',
        defaultPath: filename,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }, content, 'utf-8');
      backupStatus.value = saved ? `已导出 ${backup.documents.length} 条数据` : '';
      return;
    }

    const href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    downloadInBrowser(filename, href);
    URL.revokeObjectURL(href);
    backupStatus.value = `已导出 ${backup.documents.length} 条数据`;
  } finally {
    backupBusy.value = false;
  }
}

/** 走原生对话框；没有 preload（浏览器里调试）时退回 <input type="file">。 */
async function chooseBackup() {
  if (typeof window.openTextFile !== 'function') return restoreInput.value?.click();
  const content = await window.openTextFile({ filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (typeof content === 'string') await restoreBackup(content);
}

async function readPickedFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 清空 value：同一个文件连选两次也要能触发 change
  input.value = '';
  if (file) await restoreBackup(await file.text());
}

async function restoreBackup(content: string) {
  const parsed = parseBackup(content);
  if (!parsed) {
    backupStatus.value = '这份文件不是 FunChat 备份，或者格式比当前版本更新';
    return;
  }

  const agreed = await confirmDialog.value?.open({
    title: '恢复备份',
    // 「整库替换」必须说在前面：当前这台机器上的密钥配置也会被备份里的那套顶掉，
    // 默不作声地换掉用户正在用的线路，比恢复失败更糟。
    message: `将用备份里的 ${parsed.backup.documents.length} 条数据替换当前全部好友、会话与设置（含 API 密钥），现有内容不再保留。`,
    confirmText: '替换',
  });
  if (!agreed) return;

  backupBusy.value = true;
  try {
    const { documents } = applyBackup(parsed.backup);
    await store.reload();
    const skipped = parsed.dropped;
    backupStatus.value = skipped
      ? `已恢复 ${documents} 条数据，跳过 ${skipped} 条无法识别的`
      : `已恢复 ${documents} 条数据`;
  } catch (error) {
    backupStatus.value = error instanceof Error ? error.message : '恢复备份失败';
  } finally {
    backupBusy.value = false;
  }
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

    <section class="reference-card backup-card">
      <div class="reference-label">数据备份</div>
      <div class="reference-body backup-body">
        <div class="backup-actions">
          <button type="button" :disabled="backupBusy" @click="exportBackup"><i class="iconfont icon-download" aria-hidden="true"></i>导出备份</button>
          <button type="button" :disabled="backupBusy" @click="chooseBackup"><i class="iconfont icon-file" aria-hidden="true"></i>恢复备份</button>
          <span v-if="backupStatus" class="backup-status">{{ backupStatus }}</span>
        </div>
        <div class="instructions">
          <p>备份内容：全部好友、全部会话（含消息里的图片）、以及设置和 API 路线。</p>
          <p><b>备份文件内含明文 API 密钥</b>，等同于凭据，请妥善保管、不要分享。</p>
          <p>恢复是整库替换：会用备份里的内容顶掉当前的好友、会话和设置，现有内容不再保留。</p>
        </div>
        <input ref="restoreInput" type="file" accept="application/json,.json" hidden @change="readPickedFile">
      </div>
    </section>

  </main>

  <ConfirmDialog ref="confirmDialog" />
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
.backup-card { flex-direction: row; }
.backup-actions { height: 32px; display: flex; align-items: center; gap: 12px; }
.backup-actions button { height: 32px; padding: 0 15px; border-radius: 12px; color: #fff; background: var(--color-primary); }
.backup-actions button:disabled { opacity: .6; }
.backup-actions button i { margin-right: 8px; color: #fff; }
.backup-status { color: var(--color-text-3); font-size: 12px; }
.backup-body .instructions { height: auto; }
@media (max-width: 720px) {
  .reference-settings { padding: 12px; }
  .reference-card { min-width: 650px; padding: 24px; }
}
</style>
