# 安卓个人版：固定签名和数据恢复验收

从新版本开始固定包名 `com.dafanshu.rolestudio`，并由使用者自己持有签名。旧 Actions 测试包不纳入版本迁移。仓库的普通 Actions 只出临时签名的 **debug 预览包**，不是可连续覆盖升级的个人版；不要在同一台手机上混装这两种签名。

## Windows：只生成一次个人签名

安装 JDK 21 后，在 PowerShell 运行。以下命令通过交互输入密码，不要把密码写到命令或文档里。

```powershell
$signDir = Join-Path $env:USERPROFILE 'RoleStudioSigning'
New-Item -ItemType Directory -Path $signDir -Force | Out-Null
$keyPath = Join-Path $signDir 'role-studio-release.p12'
if (Test-Path $keyPath) { throw '签名已存在，请复用，不要覆盖或重新生成。' }
keytool -genkeypair -keystore $keyPath -storetype PKCS12 -alias role-studio -keyalg RSA -keysize 3072 -validity 10000
keytool -list -v -keystore $keyPath -alias role-studio
```

保存证书 SHA-256 指纹用于核验。keystore 另留至少一份加密备份，密码用自己的密码管理器保存。不要发到聊天、上传到仓库或放进构建产物。签名密钥不是生图 API Key；它也不会随应用数据备份导出。丢失它会影响之后的覆盖升级。

## 每次打包复用同一个签名

按[安卓构建步骤](../mobile/android/README.md)准备前端和原生项目，进入 `mobile/android/android`，然后执行：

```powershell
$env:ROLE_STUDIO_KEYSTORE = Join-Path $env:USERPROFILE 'RoleStudioSigning\role-studio-release.p12'
$env:ROLE_STUDIO_KEY_ALIAS = 'role-studio'
$pass = Read-Host '输入 keystore 密码' -AsSecureString
try {
    $env:ROLE_STUDIO_KEYSTORE_PASSWORD = [System.Net.NetworkCredential]::new('', $pass).Password
    $env:ROLE_STUDIO_KEY_PASSWORD = $env:ROLE_STUDIO_KEYSTORE_PASSWORD
    .\gradlew.bat --no-daemon --no-build-cache --no-configuration-cache testDebugUnitTest assembleRelease
} finally {
    Remove-Item Env:ROLE_STUDIO_KEYSTORE_PASSWORD, Env:ROLE_STUDIO_KEY_PASSWORD -ErrorAction SilentlyContinue
    $pass.Dispose()
}
```

APK 默认输出到 `app/build/outputs/apk/release/app-release.apk`。用 Android SDK 的 `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk` 确认签名及指纹与首次一致，再安装。后续保持同一包名和签名，提升 `versionCode`；不要改用 Actions 调试包。未提供 keystore 时，release 构建会报错，不会自动退回临时签名。

## 数据恢复验收

对测试数据验一次：在 App 中导出备份到「下载」，再复制到电脑或另一处受保护的位置。核对备份导出成功后，卸载测试 App，再装回签名版，断网导入并重启。确认生成记录里的图还可打开并保存，提示词、草稿、参考图及非敏感设置可复原。图库素材包单独备份；API Key 不进备份，重新安装后从密码管理器粘贴。未导出之后新增的内容不在旧备份里。

## 推荐升级路径：Actions 构建、Windows 本地签名

1. 在仓库的 Android personal app build 运行记录中，下载 `role-studio-personal-unsigned-<提交>` ZIP。只使用你自己仓库中可信的运行记录，不要下载名为 `role-studio-android-preview` 的调试包。未签名的文件不能直接安装。
2. 解压整个 ZIP。Windows 只需 JDK 和 Android SDK Build-Tools 35+，无需安装项目的 Node、Gradle 依赖。第一次按上面的命令生成密钥，后续始终复用。同目录的 `SHA256SUMS.txt` 用于检测复制损坏；它不替代从可信仓库下载。
3. 在解压目录打开 PowerShell，运行 `.\Sign-RoleStudio.ps1`。如 PowerShell 阻止脚本，先核对来源后仅对此文件运行 `Unblock-File -LiteralPath .\Sign-RoleStudio.ps1`。脚本会检查包名、APK 校验值，并由签名工具交互询问密码，不写入日志或环境变量。若 SDK 不在标准路径，可传 `-BuildToolsDir`。首次保存本机证书指纹，之后只会输出与该指纹相同的签名包。
4. 只把输出的 `role-studio-personal-<versionCode>.apk` 传到手机。首次安装作为新基线，后续直接覆盖，同一条 Actions 工作流的新运行自动递增版本码，重跑同一运行不会换版本码。不要混装调试包。若从这条路径切回本地完整构建，须加 `-ProleStudioVersionCode=<大于已安装的版本码>`。若改建新工作流，不要重置版本编号。
5. 连同指纹备份同一份 `.p12`。换电脑时恢复两者，不要重新生成密钥。测试签名不能用于正式包。尚未验证真机时，不承诺其他应用商店或其他签名渠道可覆盖。
