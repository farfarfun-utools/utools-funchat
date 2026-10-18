// 备份的往返与防脏。
//
// 这一层最该钉住的不是「导出能不能跑通」，而是两种静默事故：备份里少带了东西（恢复完
// 才发现正文没了、密钥要重填），以及脏文件把好数据顶掉（恢复「成功」但库被清空）。
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  BACKUP_VERSION,
  applyBackup,
  backupFilename,
  buildBackup,
  parseBackup,
  serializeBackup,
} from '../src/services/backup.ts';
import { saveAgent, saveHistory, saveSettings, loadSettings } from '../src/services/storage.ts';
import { host } from '../src/services/utools.ts';

function resetDatabase() {
  for (const document of host.db.allDocs('')) host.db.remove(document._id);
  // 键名要和 storage.ts 里的一致（dbStorage 这一层的键自带 funchat. 前缀）
  host.dbStorage.removeItem('funchat.settings');
  // loadAgents 的一次性搬迁在这组用例里不该掺和进来
  host.dbStorage.setItem('funchat.documents.migrated', true);
}

/** 一份有好友、有话题、有正文、有明文密钥的库。 */
function seed() {
  resetDatabase();
  saveAgent({ _id: 'ai@1', nickname: '小助手', params: { model: 'gpt-4.1-mini' } } as never);
  saveHistory({ id: 'chat@ai@1#1700000000000', title: '第一条话题', messages: [{ role: 'user', content: '你好' }] } as never);
  saveSettings({
    apiRoutes: [{ id: 'r1', name: '私有线路', provider: 'openai', baseUrl: 'https://api.example.com', apiKey: 'sk-secret-123' }],
    activeRouteId: 'r1',
    model: 'gpt-4.1-mini',
  } as never);
}

test('backup carries agents, topic index, message bodies and settings', () => {
  seed();
  const backup = buildBackup(1700000000000);

  assert.equal(backup.funchat, BACKUP_VERSION);
  assert.equal(backup.exportedAt, 1700000000000);
  const ids = backup.documents.map((document) => document._id);
  assert.ok(ids.includes('ai@1'), '好友没进备份');
  assert.ok(ids.includes('chat@ai@1#1700000000000'), '话题索引没进备份');
  // chatbody@ 不以 chat@ 开头，漏了它备份里就只剩标题
  assert.ok(ids.some((id) => id.startsWith('chatbody@')), '话题正文没进备份');
});

test('backup includes the plaintext API key on purpose', () => {
  seed();
  // 这条用例是这个决定的看门人：哪天有人「顺手」把密钥摘出去，恢复出来的插件就不能用了，
  // 而用户要等到下一次提问失败才发现。要改这个行为，先改 docs/roadmap.md 里记的理由。
  assert.equal(buildBackup().settings.apiRoutes?.[0]?.apiKey, 'sk-secret-123');
});

test('strips _rev: revision numbers are meaningless on another machine', () => {
  seed();
  assert.ok(host.db.get('ai@1')?._rev, '前提不成立：库里的文档本应带 _rev');
  assert.ok(buildBackup().documents.every((document) => document._rev === undefined));
});

test('round-trips the whole库 through serialize → parse → apply', async () => {
  seed();
  const text = serializeBackup(buildBackup());

  resetDatabase();
  const parsed = parseBackup(text);
  assert.ok(parsed, '自己导出的备份应当认得');
  assert.equal(parsed.dropped, 0);
  const { documents, failed } = applyBackup(parsed.backup);
  assert.equal(failed, 0);
  assert.equal(documents, parsed.backup.documents.length);

  assert.equal(host.db.get('ai@1')?.nickname, '小助手');
  assert.equal(host.db.get('chat@ai@1#1700000000000')?.title, '第一条话题');
  assert.equal(loadSettings().apiRoutes?.[0]?.apiKey, 'sk-secret-123');
});

test('restore replaces instead of merging: nothing survives from the previous data', () => {
  seed();
  const parsed = parseBackup(serializeBackup(buildBackup()));
  assert.ok(parsed);

  // 恢复前库里多出一个好友和一条话题，它们不在备份里 —— 恢复是「回到那一刻」，不该留下
  saveAgent({ _id: 'ai@2', nickname: '恢复前才加的' } as never);
  saveHistory({ id: 'chat@ai@2#1700000000001', title: '恢复前才聊的', messages: [{ role: 'user', content: '在吗' }] } as never);

  applyBackup(parsed.backup);
  assert.equal(host.db.get('ai@2'), null);
  assert.equal(host.db.get('chat@ai@2#1700000000001'), null);
  assert.equal(host.db.get('chatbody@ai@2#1700000000001'), null);
  assert.equal(host.db.get('ai@1')?.nickname, '小助手');
});

test('rejects files that are not a FunChat backup, and newer formats', () => {
  assert.equal(parseBackup('不是 JSON'), null);
  assert.equal(parseBackup('[]'), null);
  assert.equal(parseBackup('{"hello":1}'), null, '没有 funchat 字段的 JSON 不该被当成备份');
  // 比我们认识的格式新：宁可报错，也不要按旧字段猜新结构后「恢复成功但东西不对」
  assert.equal(parseBackup(JSON.stringify({ funchat: BACKUP_VERSION + 1, settings: {}, documents: [] })), null);
  assert.equal(parseBackup(JSON.stringify({ funchat: 1, documents: [] })), null, '缺 settings 不该通过');
  assert.equal(parseBackup(JSON.stringify({ funchat: 1, settings: {} })), null, '缺 documents 不该通过');
});

test('drops unrecognised entries one by one instead of failing the whole file', () => {
  const parsed = parseBackup(JSON.stringify({
    funchat: 1,
    exportedAt: 1,
    settings: { model: 'gpt-4.1-mini' },
    documents: [
      { _id: 'ai@1', nickname: '留下' },
      { _id: 'draft@1', text: '不在备份范围里的前缀' },
      { nickname: '没有 _id' },
      null,
      'string',
    ],
  }));

  assert.ok(parsed, '有几条脏数据不该把整份备份判死 —— 用户手上可能只有这一份');
  assert.deepEqual(parsed.backup.documents.map((document) => document._id), ['ai@1']);
  assert.equal(parsed.dropped, 4);
});

test('survives duplicate _id in a hand-edited backup', () => {
  resetDatabase();
  const parsed = parseBackup(JSON.stringify({
    funchat: 1,
    settings: {},
    documents: [{ _id: 'ai@1', nickname: '第一次' }, { _id: 'ai@1', nickname: '第二次' }],
  }));
  assert.ok(parsed);

  // 第二条会撞 _rev 冲突。重试一次写进去，而不是静默丢掉或整个恢复失败。
  const { documents, failed } = applyBackup(parsed.backup);
  assert.equal(failed, 0);
  assert.equal(documents, 2);
  assert.equal(host.db.get('ai@1')?.nickname, '第二次');
});

test('names the file by local date, not UTC', () => {
  // 东八区的深夜：UTC 还停在前一天，按 toISOString 取名就会写成昨天
  assert.equal(backupFilename(new Date(2026, 9, 18, 23, 30)), 'funchat-2026-10-18.json');
  assert.equal(backupFilename(new Date(2026, 0, 5)), 'funchat-2026-01-05.json');
});
