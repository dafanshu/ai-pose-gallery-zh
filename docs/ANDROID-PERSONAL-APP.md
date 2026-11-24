# 角色合成台 · 安卓个人版

从 Harness 插件 dev.7 独立开发，不要求手机安装 Harness，也不替换桌面插件。安卓版支持 OpenAI GPT Image、Google Gemini、阿里云百炼 Qwen 和火山方舟 Doubao 官方接口。ComfyUI、自定义代理、跨会话功能和整套图库不在本版范围内。

## 第一次验收

1. 构建并在自己的 Android 设备安装测试 APK。项目根目录先执行 `pnpm run build:android`，原生工具链和命令见 [Android 壳工程](../mobile/android/README.md)。GitHub Actions 的 [安卓工作流](../.github/workflows/android-preview.yml) 只在安卓分支运行；构建成功后在运行详情的 Artifacts 提供调试 APK 和 SHA-256 校验文件，保留 7 天，不创建 Release。公开仓库的 Actions 产物并非私有下载。不要把个人密钥或签名文件放进工作区、仓库或 CI。
2. 在「厂商设置」中保存自己单独用于测试的对应 API Key。百炼需要华北 2（北京）Workspace ID 与同区域的 Key。保存后设置顶部、该厂商详情以及合成页当前厂商显示绿色「已配置 · 未验证」；重启验证标记仍在。换厂商时使用各自保存的 Key；不自动调用验证或检查余额。单独清除后绿色标记消失，不影响其他厂商。怀疑泄露时从对应厂商平台吊销 Key。
3. 在电脑上从已有图库打包并传给手机，见[手机素材包导出与导入](ANDROID-GALLERY-PACK.md)。合成台点人像、服饰或姿势的「从图库选择」，首次导入素材包，以后可按名称或标签离线浏览。只有「附加参考图」使用系统相册选择器；也可以用内置示例先测试。
4. 选择厂商和模型并主动生成一张。OpenAI 可选尺寸与画质，Seedream 固定 2K，Gemini 和 Qwen 使用厂商默认尺寸。不要用含个人隐私的图片做首次验证。保存结果到系统相册。修改表单后点历史里的「还原表单」，核对图片、画风、可用模型、尺寸、画质和提示词已复原，且不会重新生图。重启 App 再核对生成记录。
5. 有电脑版备份时可导入 JSON。四家已接入厂商且带快照的历史可还原；ComfyUI 记录仅可查看本机图片；原图库相对路径和外链不随备份附带，缺失的人像、服饰或姿势需从手机图库重选，附加参考图可从相册重新添加。不在手机上偷偷下载远程参考图。

## 数据与费用

- App 内置 UI 和少量原创示例，不需要部署网站；只有生成需要网络。请求、所选参考和提示词仅直达本次选中的官方厂商，没有项目自建中转；使用 Base64 结果，不访问远端结果 URL。生成由供应商计费，失败不自动重试。
- Key 加密留在私人设备，由 Android Keystore 保护；不进入历史、备份或移动端 Web 存储。这不等于客户端无泄露风险。OpenAI [建议将 API Key 放在自有服务端](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)，因此不要把此自用直连方案当成给他人分发的生产鉴权设计。
- 历史和参考图片存于 App 本地，点保存才会另写到系统相册；清除 App 数据或卸载将丢失 App 内数据。测试 APK 只供自用；正式升级应保留相同应用 ID 和自持签名密钥。

## 厂商测试范围

- OpenAI：保持原 API、本地密钥记录和最多 6 张参考图。
- Gemini：Gemini 3.1 Flash Image，最多 3 张；用 [Interactions API](https://ai.google.dev/gemini-api/docs/interactions) 的 `store=false`，这不改变厂商的其他数据政策。
- 阿里云百炼：Qwen Image 3.0 / 3.0 Pro，最多 3 张，使用[华北 2（北京）工作空间专属接入点](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)。
- 火山方舟：Seedream 5.5 / 4.5，最多 6 张。[版本接口说明](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)；保留厂商水印，不绕过账户限制。
- 上面均为固定已接入模型，不是实时可用模型目录。地区、权限、账户余额及厂商限额由各自平台决定。实际调用可能计费。
- 这是递增版本号的测试构建，不保证与上一份 Actions 调试 APK 签名一致。如果手机提示签名冲突，先保留旧版本，不要卸载清数据；正式覆盖升级需保持相同应用 ID 和签名。
