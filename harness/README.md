# 角色合成工作台 · DeepSeek Harness 迁移版

状态：**0.2.0-dev.1 本地开发版；源码测试、生产构建和模拟宿主浏览器检查已完成，真实 Desktop 尚未验收，未发布。**

当前全局角色、跨会话手动协作、密钥内存生命周期和完整限制见 [全局工作台说明](./GLOBAL-WORKBENCH.md)。以下说明同时保留原合成台的安装与安全边界。

## 迁移范围

把 ai-pose-gallery-zh 的完整 React 应用构建到本插件 `app/`，由 Harness 左侧全局入口对应的 `main` 面板承载：

- 概览、姿势、服装、人像、合成台、配置、指南七个页面及原有中文界面。
- 图库检索、角度/深度图、多来源服装、上传参考图、三合一配方、额外参考、随机配方、拼图、对比、放大和下载。
- 原有 OpenAI Images/Responses/Chat、Gemini、Qwen、Doubao 配置与请求逻辑。
- ComfyUI 预设/自定义工作流、参数、图片上传、提交、排队、WebSocket 实时进度、HTTP 兜底、任务恢复与历史。
- 原有浏览器历史和配方持久化，并新增手动备份迁移。

这不是远程旧站 iframe：整个应用的构建产物由本地 Harness 插件提供。内部 iframe 只是隔离 React 19、Tailwind/CSS 和路由，宿主小外壳使用 Harness 提供的 React。原网站的默认构建、Cloudflare Worker 与 ComfyUI Python 插件不被替换。

本版保留完整图形合成台，并新增独立角色及用户手动选择的会话文字收录与发送。**不新增聊天模型生图工具，不自动发送配方或图片**。跨设备同步、持久加密凭据保管和聊天图片附件桥接尚未实现。

## 明确版本

- 图库基线：`dafanshu/ai-pose-gallery-zh@9fa687715efbda532f8de0c7f75d05298d97652f`。
- 本插件依据官方 tag `dsh-v0.2.2-rc.1`、提交 `deepseek-ai/deepseek-harness@66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` 的 **0.2.2-rc.1** 接口设计，要求 Node **>=24.9.0** 和 `web` profile。
- 参考 `shanliuling/dsh-image-gen@12c5e365e4015d3eeaa8b6fac51ee43eb5293cc4` 为 **0.11.2**，它的 DSH 开发 API 仍固定在 **0.1.7-rc.2**。不能把两者视为相同版本。
- 没有 `connection.admit()` / owner 身份的老宿主会返回 503/403，**不降低鉴权来兼容**。桌面 `file://` / IPC profile、headless、ACP 没有完成适配。

`package.json` 已声明 `engines.dsh: "0.2.2-rc.1"`，由宿主在加载前执行版本检查。其他版本需重新核对，不建议添加豁免。启动时还检查实际服务能力；没有 owner admission 直接失败，不注册免鉴权路由。详细依据见 `docs/HARNESS-0.2.2-RC1.md`。

接口出处：
- https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/contract/slots.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/host/webserver/src/index.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/connection/src/rpc-host.ts
- https://github.com/shanliuling/dsh-image-gen/blob/12c5e365e4015d3eeaa8b6fac51ee43eb5293cc4/tsdown.config.ts

## 构建与加载

先在已有、依赖已获准的完整图库工作副本中应用补丁。不要覆盖带未提交修改的文件。附带补丁可以先 `git apply --check`，检查失败先人工解决版本差异。

本轮使用云端已有依赖完成检查，未安装依赖或修改锁文件。在其他环境按原锁文件和当地依赖策略准备环境，不要绕过供应链限制。

```sh
# 从完整图库仓库根目录运行，使用已批准的依赖环境。
node --import ./scripts/register-test-modules.mjs --test tests/*.test.mjs harness/tests/*.test.mjs
pnpm run build:harness
pnpm run lint
pnpm run check:harness-package
```

`build:harness` 先执行现有 TypeScript 检查，再独立构建到 `harness/app`，最后复制所用依赖的许可证和通知文件。不要在未构建时打包或安装。普通 `pnpm build` 仍输出原网站 `dist/`。

确认构建通过、Host 版本匹配后，在 **Harness 自己的工作目录** 按该版本支持的本地插件安装流程加载：

```sh
pnpm dsh plugin --profile web add /ABSOLUTE/PATH/ai-pose-gallery-zh/harness
pnpm dsh --profile web --dump-config
```

第二条仅用于本机检查。不要公开完整配置输出，其中其他插件可能含敏感信息。本次没有执行以上安装、修改现有 Harness 配置或启动/部署服务。

在生成的 `ai-pose-studio` 插件配置项中填写：

```yaml
assetRoot: /ABSOLUTE/PATH/ai-pose-gallery-zh
comfyUrl: http://127.0.0.1:8000
allowedProviderOrigins: []
timeoutMs: 600000
maxConcurrent: 4
```

- `assetRoot` 指向含 `data/`、`img/`、`thumbs/` 的**完整现有图库**。不向插件重复复制约 1.19 GB 的素材。打包安装后一定使用绝对路径，不依赖插件父目录位置。
- `comfyUrl` 是 **Harness 所在机器能访问的 ComfyUI**。Harness 跑在云端时 `127.0.0.1` 不是你的电脑。远程地址由操作者显式配置，远程部署建议 HTTPS；不要把主机插件当成公用代理。
- 默认允许四个官方 HTTPS origin。自定义 OpenAI 兼容中转需在 `allowedProviderOrigins` 中添加准确 origin，例如 `https://api.example.com`；不支持 `*`、子域通配或 HTTP 公网供应商。
- 当前没有新增 Harness 设置表单；主机地址和目录在插件配置中管理。生图参数仍在原工作台界面。

## 数据与密钥

- 原站存储不被自动读取、删除或覆盖。Harness 使用独立 localStorage/IndexedDB 名称，数据归属于当前浏览器的 Harness origin，不等于云端账号同步。
- API Key 只保留在当前 Harness 窗口的插件根内存，面板重挂载可恢复，刷新整个宿主或停用插件后需要重新输入。持久化和备份会剔除凭据字段、敏感 URL 参数及嵌套工作流中识别到的凭据字段；不要把秘密写进提示词或任意文本字段。
- Host 登录 Cookie / Authorization 不转发到供应商。前端通过独立 `x-studio-*` 头传递供应商凭据，后端只把这些头映射成供应商认证头。
- 供应商请求统一经已鉴权的本机代理。生成时图片会发给所选供应商，包括 Base64 参考图。这仍属于对该供应商的数据传输，不会因为“本地插件”而变成本地模型。
- 图库中的 CharaDB/GIA 在线图片仍从原来源加载，需要联网和来源端 CORS；本插件不偷偷镜像或放宽其授权。
- 备份：在带本补丁的原站版本的「配置」页手动导出，再在 Harness 的同一页选择文件并确认替换。只迁移配方、参考图片和历史/快照，**不迁移供应商配置、API Key 或运行中任务**。50 MB 上限，必须先备份目标数据。
- 导入先完整校验 schema/图片 URL/版本，再在同一 IndexedDB 事务写入配方和历史；导入时阻止生成与历史改动。
- 原来的「停止跟踪」仍只是停止跟踪，**不会取消已提交的 ComfyUI 后台执行**。不要把它当作撤销费用或取消计算的按钮。
- 同一 Harness origin 的多个工作台窗口共享存储，避免同时修改；跨窗口冲突解决未新增。切换/关闭宿主视图的后台生命周期仍需真实宿主验收，云端请求不是持久后台任务队列。

## 安全边界

所有 HTTP/WS 路由先经 Host 的 owner admission；无服务或鉴权异常拒绝访问。同源检查、请求方法限制、固定 Comfy 地址、精确供应商 origin/接口路径、DNS 公网检查和禁止重定向分别阻止跨站调用及任意代理。

只提供配置目录中的数据/图片，检查真实路径阻止目录穿越和越界符号链接；不会提供 `.env`、Git 或仓库任意文件。请求体 32 MiB、响应 80 MiB、上传最多 30 秒，并发默认 4；长任务超时默认 600 秒。超过限制明确失败，不暗中重试生图。

内部 iframe 与宿主**不是安全沙箱**，同源可信插件本来就能访问宿主 origin。隔离用途是 UI/React/路由兼容；不要安装不可信代码或把未清理的 HTML 当成图库资产。

## 验证状态与验收

已执行：Node 原生回归与新增角色协作测试、TypeScript 检查、两种生产构建、lint、包检查和本地模拟宿主浏览器交互。详见全局工作台说明。没有向付费生图服务发请求。

未执行：真实 Harness Desktop 插件加载、真实宿主会话操作与权限撤销、真实凭据恢复及实际供应商/ComfyUI 生图。模拟宿主检查不能替代这些验收。

真实环境验收清单见仓库 `docs/HARNESS-MIGRATION.md`。在目标环境验收通过前，请把本版当作待联调开发版。
