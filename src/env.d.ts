export {};

declare global {
  // preload.js 往 window 上挂的桥接接口，官方声明里当然没有，要自己写。
  interface Window {
    saveFile?: (options: unknown, data: unknown, encoding: string) => Promise<void>;
  }
}

// 这里原本有一句 `var utools: any`，它会盖掉 utools-api-types 的全局命名空间，
// 让 `typeof utools` 退化成 any——于是接口名字写错也没人管（setExpandHeight 曾经就是
// 写成 setExpendHeight 一直没被发现）。全局 utools 的类型交给官方声明，不要在这里重复声明。
