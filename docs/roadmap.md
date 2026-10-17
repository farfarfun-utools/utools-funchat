# 开发计划

## 数据导入导出（待开发，优先级最高）

### 现状

funchat 目前**只有单条/单会话的"导出成文档"**，没有任何导入，也没有可还原的全量备份：

| 能力 | 现状 |
| --- | --- |
| 单会话导出 Markdown / HTML / Word / PDF | 有（`features/chat/ChatExportMenu.vue`） |
| 单条消息导出 PNG | 有（`features/chat/message-tools.ts`） |
| 全量备份导出 / 恢复 | **没有** |
| 导入（任何格式） | **没有** |
| WebDav 备份 | **没有** |

导出的 md/html/pdf 是给人看的，丢掉了角色、模型参数、话题结构，导不回来 —— 所以不能当备份用。

同族另外三个插件的对照：funlink 和 funotp 都有「本地 JSON 备份还原 + WebDav 备份 + 外部格式导入」整套；
fundoc 有「拖 .md 导入 + zip 导出」，正在补清单让它往返闭合（见那边的 docs/roadmap.md）。
funchat 是四个里唯一一个**数据只能进不能出**的。

### 为什么要做

插件数据全在 uTools 自己的数据库里，卸载插件会一并删除。目前用户想换设备或重装，除了开 uTools 会员的
数据同步之外没有任何别的手段 —— 而要带走的东西并不少：

- `funchat.settings`（dbStorage）：界面设置 + API 路线表 `ApiRoute[]`，**包含第三方 API 密钥**；
- 好友（agents，dbStorage，`services/storage.ts` 的 `saveAgent` / `removeAgent`）：自定义提示词、模型参数、头像；
- 会话历史：存在 uTools 文档库里（0.1.x 的 `browser.db` 单键大对象已由 `storage.ts:47` 的迁移代码搬过来）；
- 消息里的图片附件（内联，受 `stripImagesToFit` 的预算裁剪）。

### 计划

按优先级，前两条是一件事的两半：

1. **全量备份：导出 / 恢复 JSON。**
   - 覆盖 settings + agents + 会话历史 + 内联附件；带 `version` 字段，恢复时按版本拒绝"更新的格式"。
   - 导出前确认框明示内容为明文；恢复时校验脏数据并报告跳过条数（funlink 的 `prepareState` 返回 `dropped`，照这个来）。
   - 形状直接参照 `utools-funlink/src/composables/useDataTransfer.ts`：优先走 preload 的 `saveBackup`，
     没有则退回浏览器下载；文件名 `funchat-YYYY-MM-DD.json`。
   - preload 侧要补 `saveBackup` / 读备份文件两个方法 —— funlink 和 funotp 的 `utools/preload.js` 里已经各有一份可抄。
   - **待定决策**：备份里要不要含 API 密钥。funotp 的做法是含 + README 明确警告（它的全部价值就是密钥）；
     funchat 的密钥是第三方服务的，建议默认含、确认框里讲清楚，另给一个「不含密钥」的选项。

2. **把 0.1.x 的 `browser.db` 大对象也认成可导入格式。** 迁移逻辑已经在 `storage.ts` 里了，复用即可，
   让从老版本手动抠出来的数据有路可回。

3. **单会话的可往返导出（`.funchat.json`）。** 现在的 md 导出是给人看的，这一条是给机器读的：
   带上角色、模型参数、完整消息结构，可以单独导入到另一台设备或分享给别人。优先级低于全量备份。

4. **WebDav 备份（可选）。** funlink / funotp 的 `utools/webdav.js` 是同一套东西，可以整体复用。
   做不做取决于第 1 条落地后用户还缺不缺 —— 本地备份 + uTools 同步可能已经够了。

### 验收

- 往返测试：导出 → 清空数据库 → 恢复，好友、会话、设置、头像、消息里的图片都要对得上；
- 跨设备：备份文件拿到另一台机器恢复后，附件图片不能变成空白（funlink 踩过这个坑 —— 备份里只存附件 ID
  换设备就是一堆空图标，所以它导出时把图标还原成内联 data URL，见 `withInlineIcons`）；
- README 的功能表和"数据与隐私"一节要同步更新，密钥会不会进备份必须写清楚。
