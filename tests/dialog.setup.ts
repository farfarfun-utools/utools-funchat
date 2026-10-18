// jsdom 到 30 还没实现 <dialog> 的 show / showModal / close，而 ConfirmDialog、
// ModelPickerDialog 这些都挂在这几个方法上，不补的话组件测试一调用就抛 TypeError。
// 这里只补到「open 属性和 close 事件是对的」为止 —— 组件的逻辑只认这两样。
// 真实环境是 uTools 的 Chromium，原生就有，补丁只存在于测试里。
//
// 同一份补丁 funotp 的 tests/dialog.setup.ts 里也有一份：十几行测试脚手架，眼下没有共享
// 包可放，各留一份比为它造一个依赖划算。
//
// 环境是 node 的那些测试没有 DOM，这里直接跳过。
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  function open(this: HTMLDialogElement) {
    this.open = true;
  }

  HTMLDialogElement.prototype.show = open;
  HTMLDialogElement.prototype.showModal = open;
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    // 原生 close 对已经关着的弹窗什么都不做，不会再发一次 close 事件。
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}
