# 角色工作台：安卓私有更新（仅个人签名版本）

应用没有后台检查和静默安装。版本 1020 及以前没有更新入口，因此需要手动覆盖安装一次带更新功能的签名包。版本号递增且继续使用现有应用 ID 和签名，不要卸载旧版。

## 一次性配置 Cloudflare（账号所有者执行）

1. 创建 R2 桶 `role-studio-private-updates`（不指定数据管辖区；脚本使用默认 S3 端点），不启用 r2.dev 或公开自定义域名，不加自动删除规则。为 GitHub Actions 创建 *只限此桶* 的 R2 Object Read & Write S3 凭据。不要在聊天或源代码输入凭据。
2. 进入 `mobile/android/private-updates`，在已登录 Wrangler 的终端运行 `npx wrangler deploy`，记下 Worker 返回的 `https://…workers.dev` 地址。未设置访问口令时，所有请求都是 401，且不会访问桶。保留 `preview_urls = false`。
3. 在可信机器生成一份只用于安卓更新下载的 64 位小写十六进制口令及其 SHA-256：
   ```sh
   node -e "const c=require('node:crypto'), t=c.randomBytes(32).toString('hex'); console.log('手机更新口令:',t); console.log('Worker 校验摘要:',c.createHash('sha256').update(t).digest('hex'))"
   ```
   运行 `npx wrangler secret put UPDATE_READER_SHA256`，把第二行的摘要填进交互提示。第一行的原始口令只保留在你自己的密码管理器和手机配置中。若需撤销，重新生成后覆盖 Worker secret，手机改用新口令。没有 Bearer 口令的浏览器或爬虫既不能读版本信息也不能下载。
4. 在 GitHub 仓库 Settings → Environments → `android-personal-signing` 加下面的变量和密钥。保持原有签名配置和安卓分支限定不变。

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | `ROLE_STUDIO_R2_ACCOUNT_ID` | Cloudflare 32 位账号 ID |
| Variable | `ROLE_STUDIO_R2_BUCKET` | `role-studio-private-updates` |
| Secret | `ROLE_STUDIO_R2_ACCESS_KEY_ID` | 该桶专用 S3 Access Key ID |
| Secret | `ROLE_STUDIO_R2_SECRET_ACCESS_KEY` | 该桶专用 S3 Secret Access Key |
| Variable | `ROLE_STUDIO_PRIVATE_UPDATES` | 最后设为 `true`；未开启时只生成原有的 Actions 下载包 |

上面的发布凭据只给 Actions，手机只填写 Worker 地址和只读更新口令。不要将原有图片 API Key、GitHub Token 或 APK 签名私钥用作更新口令。

## 验证

- 用无痕浏览器打开 `https://<worker>/v1/latest.json`，应返回 401，而不是显示版本清单。配置后在安卓分支重新运行签名构建；检查 Actions 的私有发布步骤成功。
- 手动覆盖安装首个支持更新的签名 APK，在「厂商连接设置 → 检查更新」保存地址与口令并检查；已安装的版本应提示没有更高版本。
- 真实覆盖安装验证需要另一次成功构建以生成更高版本。保持旧版停在手机上，发布下一版后，在旧版中检查、下载并安装；首次按系统提示允许角色工作台安装未知应用，返回后再点一次「下载并安装」，在系统页面确认。重开后检查版本、历史记录和设置。
- 发布脚本先上传已验签 APK，最后上传版本记录。Worker 按版本选最高的记录，旧构建重跑不会把最新版降级。App 检查下载大小、SHA-256、包名、递增版本及当前安装的签名证书，最终由系统安装器确认并再次验证。
