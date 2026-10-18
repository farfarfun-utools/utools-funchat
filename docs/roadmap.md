# 开发计划

## 数据导入导出

### 现状

| 能力 | 现状 |
| --- | --- |
| 单会话导出 Markdown / HTML / Word / PDF | 有（`features/chat/ChatExportMenu.vue`） |
| 单条消息导出 PNG | 有（`features/chat/message-tools.ts`） |
| 全量备份导出 / 恢复 | **已完成**（`services/backup.ts`，设置页「数据备份」） |
| 导入旧版 `browser.db` 大对象 | 没有，见下面第 2 条 |
| 单会话的可往返导出 | 没有，见下面第 3 条 |
| WebDav 备份 | 没有，见下面第 4 条 |

导出的 md/html/pdf 是给人看的，丢掉了角色、模型参数、话题结构，导不回来 —— 所以不能当备份用，
全量备份是另一条路径（JSON，含明文密钥）。

同族另外三个插件的对照：funlink 和 funotp 都有「本地 JSON 备份还原 + WebDav 备份 + 外部格式导入」整套；
fundoc 有「拖 .md 导入 + zip 导出」，正在补清单让它往返闭合（见那边的 docs/roadmap.md）。

### 为什么要做

插件数据全在 uTools 自己的数据库里，卸载插件会一并删除。目前用户想换设备或重装，除了开 uTools 会员的
数据同步之外没有任何别的手段 —— 而要带走的东西并不少：

- `funchat.settings`（dbStorage）：界面设置 + API 路线表 `ApiRoute[]`，**包含第三方 API 密钥**；
- 好友（agents，dbStorage，`services/storage.ts` 的 `saveAgent` / `removeAgent`）：自定义提示词、模型参数、头像；
- 会话历史：存在 uTools 文档库里（0.1.x 的 `browser.db` 单键大对象已由 `storage.ts:47` 的迁移代码搬过来）；
- 消息里的图片附件（内联，受 `stripImagesToFit` 的预算裁剪）。

### 计划

按优先级，前两条是一件事的两半：

1. ~~**全量备份：导出 / 恢复 JSON。**~~ **已完成。** 实现见 `src/services/backup.ts`，界面在设置页
   「数据备份」一节，往返与防脏由 `tests/backup.test.ts`、按钮到数据库那段线由
   `tests/settings-backup.dom.test.ts` 盯着。下面这些是当初定的做法，留档备查：
   - 覆盖 settings + agents + 会话历史 + 内联附件；带 `version` 字段，恢复时按版本拒绝"更新的格式"。
   - 导出前确认框明示内容为明文；恢复时校验脏数据并报告跳过条数（funlink 的 `prepareState` 返回 `dropped`，照这个来）。
   - 形状直接参照 `utools-funlink/src/composables/useDataTransfer.ts`：优先走 preload 的 `saveBackup`，
     没有则退回浏览器下载；文件名 `funchat-YYYY-MM-DD.json`。
   - preload 侧要补 `saveBackup` / 读备份文件两个方法 —— funlink 和 funotp 的 `utools/preload.js` 里已经各有一份可抄。
   - **备份含明文 API 密钥**（已定）。理由是备份得真能当备份用：换台机器恢复完还要手动把几个
     服务的密钥重新填一遍，那这份备份就只恢复了一半，而"少了什么"恰恰是最不容易当场发现的。
     funotp 也是这么做的。随之而来的三件事必须一起做，否则这个决定就成了埋雷：

     1. 导出前的确认框要明说"文件内含明文 API 密钥，拿到的人可以用你的账号调用"，而不是
        笼统的"内容为明文"；
     2. README 要加「数据与隐私」一节，照 funotp 的写法列清楚：备份文件是明文密钥；
        `dbStorage` 属于 uTools 的同步数据库，开了同步密钥就已经在云上了；日后要是接
        WebDav，明文备份会上传到你配置的服务器；
     3. 恢复时要提示"会覆盖本机现有的密钥配置"—— 恢复是整库替换，默不作声地把人正在用的
        那套密钥换掉，比恢复失败更糟。

     **不做**"导出时去掉密钥"的开关：一个备份路径只有一种行为，想要能分享的脱敏导出就另开
     一条命令（比如"导出好友配置"），而不是在同一个按钮上藏两种语义 —— 后者的失败方式是
     用户选了脱敏、半年后恢复时才发现密钥没了。

2. **把 0.1.x 的 `browser.db` 大对象也认成可导入格式。** 迁移逻辑已经在 `storage.ts` 里了，复用即可，
   让从老版本手动抠出来的数据有路可回。

3. **单会话的可往返导出（`.funchat.json`）。** 现在的 md 导出是给人看的，这一条是给机器读的：
   带上角色、模型参数、完整消息结构，可以单独导入到另一台设备或分享给别人。优先级低于全量备份。

4. **WebDav 备份（可选）。** funlink / funotp 的 `utools/webdav.js` 是同一套东西，可以整体复用。
   做不做取决于第 1 条落地后用户还缺不缺 —— 本地备份 + uTools 同步可能已经够了。

### 验收（第 1 条的，已完成）

- ✅ 往返测试：导出 → 清库 → 恢复，好友、话题索引、消息正文、设置、明文密钥都对得上
  （`tests/backup.test.ts`）；
- ✅ 恢复是替换不是合并：恢复前多出来的好友和话题在恢复后不复存在（同上）；
- ✅ 脏文件不把好数据顶掉：不是本插件的备份、或版本比当前新，整份拒绝并说明，库一个字节不动；
  单条坏记录只跳过并报数（`tests/backup.test.ts`、`tests/settings-backup.dom.test.ts`）；
- ✅ 按钮到数据库那段线：没点确认不写盘、在保存对话框里取消不谎报「已导出」、恢复后界面跟着
  换掉（`tests/settings-backup.dom.test.ts`）；
- ✅ README 的功能表和「数据与隐私」一节已同步：备份文件内含明文 Key，请当作凭据保管。
- 跨设备这条不用单独做：funchat 的头像是对内置图片的引用、消息图片是内联 data URL，都跟着
  文档一起走，不存在 funlink 那种「备份里只存附件 ID、换设备变空图标」的问题。
