// @vitest-environment jsdom
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount } from '@vue/test-utils';
import AgentAvatar from '../src/features/agents/AgentAvatar.vue';
import AvatarPickerDialog from '../src/features/agents/AvatarPickerDialog.vue';
import {
  AVATAR_BUILTIN_IMAGES,
  AVATAR_EMOJI_GROUPS,
  AVATAR_GRADIENTS,
  AVATAR_ICONS,
  compressAvatarFile,
  isSafeAvatarDataUrl,
  randomPresetAvatar,
  resolveAvatarImageUrl,
} from '../src/features/agents/avatar-presets.ts';
import { agentFormValues } from '../src/features/agents/agent-form.ts';
import { loadAgents } from '../src/services/storage.ts';
import { host } from '../src/services/utools.ts';
import { useChatStore } from '../src/stores/chat.ts';
import type { Agent, AgentAvatar as AgentAvatarType } from '../src/types.ts';

const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('isSafeAvatarDataUrl 仅接受合法位图 base64 DataURL 并拒绝 SVG / 越界数据', () => {
  assert.equal(isSafeAvatarDataUrl(TINY_PNG_DATA_URL), true);
  assert.equal(isSafeAvatarDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isSafeAvatarDataUrl('data:image/webp;base64,UklGRh4AAABXRUJQ'), true);
  assert.equal(isSafeAvatarDataUrl('data:image/gif;base64,R0lGODlhAQABAAAAACw='), true);

  assert.equal(isSafeAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), false);
  assert.equal(isSafeAvatarDataUrl('https://example.com/a.png'), false);
  assert.equal(isSafeAvatarDataUrl('javascript:alert(1)'), false);
  assert.equal(isSafeAvatarDataUrl('data:image/png;base64,' + 'A'.repeat(270_000)), false);
  assert.equal(isSafeAvatarDataUrl(''), false);
  assert.equal(isSafeAvatarDataUrl(null), false);
});

test('resolveAvatarImageUrl 区分内置头像编号、安全 DataURL 与非法路径', () => {
  assert.equal(resolveAvatarImageUrl('14'), './avatars/14.jpg');
  assert.equal(resolveAvatarImageUrl(TINY_PNG_DATA_URL), TINY_PNG_DATA_URL);
  assert.equal(resolveAvatarImageUrl('../secret'), '');
  assert.equal(resolveAvatarImageUrl('http://evil.example/x.jpg'), '');
  assert.equal(resolveAvatarImageUrl(''), '');
});

test('randomPresetAvatar 返回预设池内的有效 Emoji 渐变头像', () => {
  const allEmojis = new Set(AVATAR_EMOJI_GROUPS.flatMap((g) => g.items));
  const avatar = randomPresetAvatar();
  assert.equal(avatar.type, 'emoji');
  assert.equal(allEmojis.has(avatar.emoji || ''), true);
  assert.equal(Array.isArray(avatar.gradient), true);
  assert.equal(avatar.gradient?.length, 2);
});

test('compressAvatarFile 拦截非图片、SVG、空文件与超大文件', async () => {
  await assert.rejects(
    compressAvatarFile(new File(['hello'], 'a.txt', { type: 'text/plain' })),
    /仅支持上传图片/,
  );
  await assert.rejects(
    compressAvatarFile(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })),
    /暂不支持 SVG/,
  );
  await assert.rejects(
    compressAvatarFile(new File([], 'empty.png', { type: 'image/png' })),
    /图片文件为空/,
  );
  const fakeHuge = { type: 'image/png', size: 11 * 1024 * 1024 } as File;
  await assert.rejects(compressAvatarFile(fakeHuge), /超过 10 MB/);
});

test('AgentAvatar 支持渲染内置头像与上传 DataURL，并在更换图片后清除失败态', async () => {
  const wrapper = mount(AgentAvatar, {
    props: {
      agent: { nickname: '测试', avatar: { type: 'image', image: '14' } },
      size: 48,
    },
  });
  assert.equal(wrapper.find('img').attributes('src'), './avatars/14.jpg');

  // 模拟图片加载失败后回退到默认图标
  await wrapper.find('img').trigger('error');
  assert.equal(wrapper.find('img').exists(), false);

  // 切换为上传的 DataURL 后应恢复图片渲染
  await wrapper.setProps({
    agent: { nickname: '测试', avatar: { type: 'image', image: TINY_PNG_DATA_URL } },
  });
  assert.equal(wrapper.find('img').attributes('src'), TINY_PNG_DATA_URL);
});

test('AvatarPickerDialog 支持切换 Emoji、内置头像、矢量图标、文字头像并回传选择结果', async () => {
  const wrapper = mount(AvatarPickerDialog);
  const vm = wrapper.vm as unknown as {
    open: (current: AgentAvatarType | undefined, nickname?: string) => Promise<AgentAvatarType | null>;
  };

  // 1. 选择 Emoji + 配色
  const p1 = vm.open({ type: 'icon', icon: 'icon-a1', color: '#0ca47f' }, '译者');
  await wrapper.vm.$nextTick();
  await wrapper.findAll('.picker-tabs button')[0].trigger('click');
  await wrapper.findAll('.emoji-cell')[1].trigger('click');
  await wrapper.findAll('.swatch-dot')[2].trigger('click');
  await wrapper.find('.picker-footer .primary').trigger('click');
  const res1 = await p1;
  assert.equal(res1?.type, 'emoji');
  assert.equal(res1?.emoji, AVATAR_EMOJI_GROUPS[0].items[1]);
  assert.deepEqual(res1?.gradient, [...AVATAR_GRADIENTS[2]]);

  // 2. 选择内置头像
  const p2 = vm.open(res1 || undefined, '译者');
  await wrapper.vm.$nextTick();
  await wrapper.findAll('.picker-tabs button')[1].trigger('click');
  await wrapper.findAll('.image-cell')[3].trigger('click');
  await wrapper.find('.picker-footer .primary').trigger('click');
  const res2 = await p2;
  assert.deepEqual(res2, { type: 'image', image: AVATAR_BUILTIN_IMAGES[3] });

  // 3. 选择矢量图标
  const p3 = vm.open(res2 || undefined, '译者');
  await wrapper.vm.$nextTick();
  await wrapper.findAll('.picker-tabs button')[2].trigger('click');
  await wrapper.findAll('.icon-cell')[5].trigger('click');
  await wrapper.find('.picker-footer .primary').trigger('click');
  const res3 = await p3;
  assert.equal(res3?.type, 'icon');
  assert.equal(res3?.icon, AVATAR_ICONS[5]);

  // 4. 文字头像
  const p4 = vm.open(res3 || undefined, '译者');
  await wrapper.vm.$nextTick();
  await wrapper.findAll('.picker-tabs button')[3].trigger('click');
  await wrapper.find('.text-label input').setValue('翻');
  await wrapper.find('.picker-footer .primary').trigger('click');
  const res4 = await p4;
  assert.equal(res4?.type, 'text');
  assert.equal(res4?.text, '翻');

  // 5. 上传图片后切换到内置头像再切回上传页签，应保留原上传 DataURL
  const p5 = vm.open({ type: 'image', image: TINY_PNG_DATA_URL }, '译者');
  await wrapper.vm.$nextTick();
  await wrapper.findAll('.picker-tabs button')[1].trigger('click');
  await wrapper.findAll('.picker-tabs button')[4].trigger('click');
  await wrapper.find('.picker-footer .primary').trigger('click');
  const res5 = await p5;
  assert.deepEqual(res5, { type: 'image', image: TINY_PNG_DATA_URL });

  // 6. 取消返回 null
  const p6 = vm.open(res5 || undefined, '译者');
  await wrapper.vm.$nextTick();
  await wrapper.find('.picker-footer button:first-child').trigger('click');
  assert.equal(await p6, null);
});

test('updateAgent 和 addAgent 会将新头像持久化到 uTools 数据库', async () => {
  for (const doc of host.db.allDocs('')) host.db.remove(doc._id);
  const store = useChatStore();

  const initial: Agent = {
    _id: 'ai@1700000000001',
    nickname: '小助',
    info: '测试好友',
    content: '你好',
    avatar: { type: 'icon', icon: 'icon-a1', color: '#0ca47f' },
    contextLength: 16,
    params: { messages: [{ role: 'system', content: '你是测试助手' }] },
  };
  host.db.put(JSON.parse(JSON.stringify(initial)));
  store.state.agents = await loadAgents();

  const uploadedAvatar: AgentAvatarType = { type: 'image', image: TINY_PNG_DATA_URL };
  store.updateAgent(store.state.agents[0], {
    ...agentFormValues(store.state.agents[0]),
    avatar: uploadedAvatar,
  });

  const saved = (await loadAgents()).find((item) => item._id === initial._id);
  assert.deepEqual(saved?.avatar, uploadedAvatar);

  const emojiAvatar: AgentAvatarType = {
    type: 'emoji',
    emoji: '🦊',
    gradient: ['#fb923c', '#ea580c'],
    color: '#fb923c',
  };
  store.addAgent({
    ...agentFormValues(null),
    nickname: '小狐狸',
    avatar: emojiAvatar,
  });
  const created = (await loadAgents()).find((item) => item.nickname === '小狐狸');
  assert.deepEqual(created?.avatar, emojiAvatar);
});
