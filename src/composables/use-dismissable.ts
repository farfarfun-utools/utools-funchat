import { onBeforeUnmount, onMounted, type Ref } from 'vue';

type Anchor = Ref<{ contains?: (node: Node) => boolean } | null | undefined>;

/**
 * 给非原生 `<dialog>` 的浮层接上「点外面关掉」和「按 Esc 关掉」。
 *
 * 这套逻辑原先在 ChatComposer / ChatExportMenu / AgentList / SideMenu 里各写了一遍，
 * 四份实现慢慢长歪：SideMenu 压根没接 Esc，AgentList 少了「有模态弹窗开着就别抢 Esc」
 * 这一条。合到一处之后四个浮层的行为一致，补一条也只用补一次。
 *
 * @param anchor 浮层自身或包住浮层的容器；点在它里面不算点外面。
 * @param isOpen 当前是否展开，关着的时候不做任何事。
 * @param close 关闭浮层。
 * @returns 无返回值；监听随组件挂载与卸载自动增删。
 */
export function useDismissable(anchor: Anchor, isOpen: () => boolean, close: () => void): void {
  function closeFromOutside(event: Event): void {
    if (!isOpen()) return;
    if (!anchor.value?.contains?.(event.target as Node)) close();
  }

  function closeOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !isOpen()) return;
    // 有模态弹窗开着时让它自己处理 Esc，别越过它去关底下的浮层
    if (document.querySelector('dialog[open]')) return;
    // 真的关掉了才 preventDefault：Esc 在 App 那层是「退出插件」，一次按键只该剥掉一层
    event.preventDefault();
    close();
  }

  onMounted(() => {
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeOnEscape);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', closeFromOutside);
    document.removeEventListener('keydown', closeOnEscape);
  });
}
