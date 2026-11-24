# 安卓独立预览：角色合成台（个人自用）

这是仓库中的独立构建目标，不依赖 Harness、不改变网站部署。0.2.0 支持 OpenAI、Gemini、阿里云百炼和火山方舟的官方接口。至少选 1 张本地参考图，按厂商限制 3 或 6 张，一次生成一张图并整理为 PNG。没有服务器、在线图库下载、模型中转地址或密钥随包发布。

## 构建

需要 Node 24、pnpm（项目锁文件）、JDK 21、Android Studio / Android SDK Platform 36 与对应 Build Tools。最低运行 Android 10（API 29），目标 SDK 36。依赖来源需能访问 npm、Gradle 官方分发、Google Maven、Maven Central；不用申请或设置 OpenAI Key 来构建和运行单元测试。

从仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm run build:android                     # 输出 mobile/android/www
npm --prefix mobile/android ci             # Capacitor 8.6.2，按 npm lock 安装
npm --prefix mobile/android run android:prepare
cd mobile/android/android
./gradlew --no-daemon testDebugUnitTest assembleDebug
```

Windows PowerShell 在最后一步使用 `.\gradlew.bat --no-daemon testDebugUnitTest assembleDebug`，配置 JDK 21 和 Android SDK 后执行同样的前置命令。生成文件为 `mobile/android/android/app/build/outputs/apk/debug/app-debug.apk`。也可在 Android Studio 打开准备好的 `mobile/android/android/`。这是调试签名预览包，不作为正式发行；重装签名不一致的 APK 可能需要先卸载，卸载会失去此 App 的本地草稿和密钥。

`native/` 是受版本控制的原生源码。`android:prepare` 使用 `package-lock.json` 固定的 Capacitor CLI 创建 Android 模板，验证官方 Gradle Wrapper JAR 哈希，再覆盖 `native/` 并同步前端；手改生成目录不作为源码。Gradle 8.14.3 二进制分发亦固定 SHA-256，AGP 固定 8.13.0。生成目录、前端产物、签名材料与 APK 不入 Git。发布签名不属于本预览。

## 数据、费用与验收

- 原生端从系统图片选择器读取用户选择的文件，重新编码为最长边约 1024 px 的 PNG；没有全盘存储或相册读取权限。生成结果经 MediaStore 写入 `Pictures/RoleStudio`；系统照片应用若另开了云同步，可能自行同步相册里的图片。
- 输入的 Key 由原生端用 Android Keystore 非导出 AES-GCM 密钥加密，密文保存在 App 的 `noBackupFilesDir`。每个厂商隔离密钥。WebView 无法读取已保存的 Key，仅查询配置状态与百炼 Workspace ID，或请求设置/清除。安装包和源代码不含个人 Key；不导出、不进入备份，不降级为明文。**这不是公共客户端的密钥分发方案**。仅在自己的可信手机上使用独立项目 Key，注意权限、额度和撤销；不要给他人发带有可用密钥的应用。OpenAI 的[密钥安全建议](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)仍推荐让公开移动端使用受控后端。本预览没有绕过地区、权限或额度限制。
- 原生端只使用 HTTPS 请求固定的官方厂商接口（百炼只接受工作空间 ID，不接受任意 URL）且只读取内联图片；不跟随重定向，不并发重复发送，不自重试，不回显上游响应正文。当连接超时或结果丢失时，服务端可能已接收请求，先核对对应厂商用量再决定是否重新点击。**调用会把选中的图片、提示词发送给当前厂商，且可能计费。**
- 首机验收顺序：离线打开和选择图片 → 关闭重开后检查草稿 → 保存及清除测试 Key（不触发生成） → 用您自己的已授权 Key 和非敏感素材手动发起一张 → 验证保存相册、历史和失败无自动重发。不要用生产密钥做工具日志或截图。

参考：[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[Gradle 官方校验值](https://gradle.org/release-checksums/)、[Android Keystore](https://developer.android.com/privacy-and-security/keystore)、[Android 共享媒体存储](https://developer.android.com/training/data-storage/shared/media)。
