# 安卓个人版：下载后直接安装

Actions 在 `feat/android-personal-app` 上验证、构建并签名，只上传一个产物：`role-studio-personal-apk-<commit>`。解压后把 `role-studio-personal-<versionCode>.apk` 传到手机安装即可。无需在 Windows 安装 Android SDK、运行签名脚本或重新编译。

第一次安装这份固定签名的 APK 作为升级基线。旧的调试签名不兼容；如果手机保留旧调试版，先备份需要的数据，再自行移除旧版。后续保持同一包名 `com.dafanshu.rolestudio`、同一个证书及递增版本号，就可以覆盖安装。每次新运行的版本号为 `1000 + GITHUB_RUN_NUMBER`；重跑同一运行不会增加版本号。不要为升级换签名密钥。

## 一次性设置（仓库所有者）

若已有用此应用签名的 `.p12`，沿用它，不要换钥；若没有，使用 JDK 附带的 `keytool` 生成一次，别把密码写到命令行：

```powershell
$signDir = Join-Path $env:USERPROFILE 'RoleStudioSigning'
New-Item -ItemType Directory -Path $signDir -Force | Out-Null
$keyPath = Join-Path $signDir 'role-studio-release.p12'
if (-not (Test-Path -LiteralPath $keyPath)) {
    keytool -genkeypair -keystore $keyPath -storetype PKCS12 -alias role-studio -keyalg RSA -keysize 3072 -validity 10000
}
keytool -list -v -keystore $keyPath -alias role-studio
```

在仓库 **Settings → Environments** 下建立或打开 `android-personal-signing`，在 **Deployment branches and tags** 中只允许 `feat/android-personal-app`。只允许可信人员修改此分支上的工作流及其运行的代码。在该环境（不是仓库级）添加：

- **Environment secret** `ROLE_STUDIO_KEYSTORE_BASE64`：把以下命令复制到剪贴板的值粘贴到 GitHub Secret。不要把它发到聊天或提交到仓库。
- **Environment secret** `ROLE_STUDIO_KEYSTORE_PASSWORD`：这份 PKCS12 的密码。
- **Environment variable** `ROLE_STUDIO_CERT_SHA256`：上面 `keytool` 显示的证书 SHA-256，可以保留每两位之间的冒号，也可以只填 64 位十六进制；不要带 `SHA256:` 标签或空格。它是指纹，不是密码。

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keyPath)) | Set-Clipboard
# 粘贴到 GitHub Secret 保存后，清空剪贴板；如启用了剪贴板历史，也清除其中的记录。
Set-Clipboard -Value ''
```

设置完成后重新运行首次因缺配置而失败的 Android 构建，或推送新的安卓变更。工作流不接收 PR 事件，只在指定安卓分支运行；缺配置、签名失败、证书不符或者找不到正确的发行包时，不上传 APK。不把密钥作为产物上传。保留一份加密的本地密钥备份及单独保存密码；GitHub Secrets 不应作为唯一备份。

如果仓库公开，Actions 产物仍遵循 GitHub 的下载权限；签名不会把公开构建产物变为私人下载，也不会把私钥附在 APK 中。无须创建公开 Release。

## 数据恢复验收

对测试数据验一次：在 App 中导出备份到「下载」，再复制到电脑或另一处受保护的位置。核对备份导出成功后，卸载测试 App，再装回签名版，断网导入并重启。确认生成记录里的图还可打开并保存，提示词、草稿、参考图及非敏感设置可复原。图库素材包单独备份；API Key 不进备份，重新安装后从密码管理器粘贴。未导出之后新增的内容不在旧备份里。
