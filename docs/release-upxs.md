言来语往 UPXS 正式版，官方插件项目 ID：`zc8khhsw`。

本版支持在聊天框粘贴、拖入或选取 PDF，并由用户选择提取文字或按页面图片识别。文字模式最多提取前 30000 字；页面图片模式需识图模型，最多 4 页。单个 PDF 最大 20 MB。

下载 `utools-funchat-1.0.2.upxs` 后导入 uTools。此包通过 GitHub Actions 构建，使用统一的 `utools-devtools` 生成，并完成认证解密、清单资源、插件 ID 和 ASAR 完整性校验；提供 `SHA256SUMS` 核对下载文件。

三个敏感字段由组织 Secrets 注入，仓库只保存公开的项目配置。相同打包链路已由用户在 FunCalc 上实机安装验证；本插件自身的安装和功能仍待实机确认。
