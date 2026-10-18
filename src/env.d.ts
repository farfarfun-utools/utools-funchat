export {};

declare global {
  // preload.js 往 window 上挂的桥接接口，官方声明里当然没有，要自己写。
  interface Window {
    // 返回值是 preload 真正给的那个：写成功 true，用户在对话框里取消 false。
    // 原来声明成 Promise<void>，于是「取消了没有」这件事在类型上根本看不见。
    saveFile?: (options: unknown, data: unknown, encoding: string) => Promise<boolean>;
    /** 读用户选的文本文件；用户取消时给 null。只有 uTools 里有，浏览器里退回 <input type="file">。 */
    openTextFile?: (options?: unknown) => Promise<string | null>;
  }
}

// 这里原本有一句 `var utools: any`，它会盖掉 utools-api-types 的全局命名空间，
// 让 `typeof utools` 退化成 any——于是接口名字写错也没人管（setExpandHeight 曾经就是
// 写成 setExpendHeight 一直没被发现）。全局 utools 的类型交给官方声明，不要在这里重复声明。
