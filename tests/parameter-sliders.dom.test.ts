// @vitest-environment jsdom
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mount } from '@vue/test-utils';
import ParameterSliders from '../src/features/agents/ParameterSliders.vue';
import { PARAMETER_ROWS } from '../src/features/agents/agent-params.ts';

function mountSliders(values: Record<string, number>) {
  return mount(ParameterSliders, { props: { values } });
}

const defaults = { contextLength: 16, max_tokens: 0, temperature: 0.6, top_p: 1, presence_penalty: 0, frequency_penalty: 0 };
const temperatureAt = PARAMETER_ROWS.findIndex((row) => row.key === 'temperature');

test('每个参数都有一条滑杆和一个数字框', () => {
  const wrapper = mountSliders({ ...defaults });
  assert.equal(wrapper.findAll('input[type="range"]').length, PARAMETER_ROWS.length);
  assert.equal(wrapper.findAll('input[type="number"]').length, PARAMETER_ROWS.length);
});

test('拖动滑杆只往外发改动，不直接改调用方的对象', async () => {
  // 值的归属在调用方那边：AgentDialog 要的是「改了存表单」，ChatPopover 要的是
  // 「改了立刻落盘」，组件自己写 props 的话这两件事都没法区分，还会踩 vue/no-mutating-props。
  const values = { ...defaults };
  const wrapper = mountSliders(values);
  const range = wrapper.findAll('input[type="range"]')[temperatureAt];

  await range.setValue('0.9');

  assert.deepEqual(wrapper.emitted('update')?.at(-1), ['temperature', 0.9]);
  assert.deepEqual(values, defaults, '组件不该动调用方传进来的对象');
});

test('数字框清空时不回传 0，等敲出合法数字再说', async () => {
  // Number('') 是 0：直接回传的话，用户刚删掉旧值准备重输，温度就已经被打成 0 存下去了
  const wrapper = mountSliders({ ...defaults });
  const number = wrapper.findAll('input[type="number"]')[temperatureAt];

  await number.setValue('');
  assert.equal(wrapper.emitted('update'), undefined, '空值不该回传');

  await number.setValue('0.8');
  assert.deepEqual(wrapper.emitted('update')?.at(-1), ['temperature', 0.8]);
});

test('显示的是传进来的值，不是组件自己的一份副本', async () => {
  const wrapper = mountSliders({ ...defaults, temperature: 0.2 });
  const number = () => wrapper.findAll('input[type="number"]')[temperatureAt].element as HTMLInputElement;
  assert.equal(number().value, '0.2');

  await wrapper.setProps({ values: { ...defaults, temperature: 1.4 } });

  assert.equal(number().value, '1.4', '调用方改了值，界面要跟着走');
});
