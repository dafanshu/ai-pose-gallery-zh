# 全局角色工作台开发版

版本：`0.2.0-dev.3`。基线：`6e2eef8291f3d455fbd6db070ce163b97fd0de35`（旧版 `harness-v0.1.1`）。本地开发分支 `feat/harness-global-workbench`；不修改 main，不发布新版本。

## 可验收范围

左侧全局「角色工作台」通过 `sidebar.panellist` 选择 root scope 的 `main` 面板，不再占用 `conversation.view`。默认直接打开原 React 合成台并填满右侧剩余空间；顶部标题后的“跨会话协作”按钮切换到角色/会话页面，“返回合成台”返回。两页内部切换保留合成台 iframe，不中断其内存状态；切换宿主其他左侧入口仍可能卸载整个插件面板。密钥清除按钮收在“密钥与任务说明”中；图库、五供应商、ComfyUI、旧配方和历史不被替换或自动迁移。

新建角色可保存文字资料、自有 PNG/JPEG/WebP 参考图（单张最多 2 MiB）、素材链接和用户选择收录的会话文字。全局 IndexedDB `ai-pose-harness-global-v1` 保存这些记录、关联关系及发送记录；它是当前浏览器当前 origin 的存储，不是账号同步或宿主数据库。原合成台继续使用原命名空间，两者不会相互覆盖。浏览器清除站点数据会删除它们；原合成台的旧备份工具尚不包含新角色库。

一个角色可关联多个普通会话。关联不会读取全文或发送消息；解除关联只移除关系。每次点击读取最近消息，调用该会话的被授权 passive history 接口；只提供最近 50 条消息范围内的文字，暂不读附件、工具输出或子代理会话。点击收录时再次请求原会话，保存会话 ID、事件序号、消息 ID、消息种类和收录时间。已收录副本归角色所有，解除关联不删除副本。

发送需要勾选角色、选择一个所有所选角色均已关联的目标、选择资料类别、生成预览，再点击确认。发送带明确的工作台资料前缀，只调用一次 `mode: queue`。默认只分享文字资料；素材链接、已收录消息和归档生成提示词默认不选。自有图片即使选择引用类别也只分享名称，图片二进制不被自动附加。不会自动群发、steer、取消任务或删除会话。

原合成台历史可由用户点击读取，再逐条选择归档到当前角色。只复制结果 ID、时间、提示词、供应商名称、模型、配方摘要和图片地址；不复制配置、密钥或工作流。归档记录保存来源与归档时间。内嵌 PNG/JPEG/WebP 图片按解码后大小限制为 8 MiB；远程地址拒绝查询参数、片段或用户信息，不自动下载。分享归档仅发送提示词及来源 ID，不附加图片。

## 生命周期与失败

角色更新使用 IndexedDB 读写事务。保存文字时检测另一窗口的修改；发送以版本检查拒绝过期预览。发送意图先持久化，成功后才调用宿主；意图写入失败不会发送。

发送 promise 由插件 Client 根控制器拥有，面板卸载不取消它。回执 `accepted: true` 只表示发送被接受；任务完成由用户核对结果后手动标记，并明确显示“用户已确认完成”。`remote-access/denied` 显示拒绝；断线、异常或无法确定的失败显示未知，不自动重试。回执保存失败会提醒核对原会话；重新加载看到没有当前操作对应的 sending 记录，也显示未知，不重发。

对于未知发送，可手动点击“只读核对发送回执”：经目标会话权限检查，在最近 50 条消息中匹配原 requestId 对应的 user/message source.rpcId。找到只更新为“发送已接受”，不标记完成；未找到保持原状态，不自动重发。若消息已被压缩或超过窗口，需要到原会话人工核对。

这不是持久后台生图队列。原合成台的直接供应商请求、WebSocket 和渲染状态仍有 iframe 生命周期；跨左侧卸载后的云端生成恢复没有实现。原 ComfyUI 的任务恢复功能保留。关闭整个 Harness 窗口不保证继续等待发送回执，但已被宿主接受的会话任务由宿主执行。

## 密钥

未读取用户实际密钥。固定 rc.1 的 credentials 服务有 `resolve`、`describe` 和插件记录接口，但默认 credentials-local 是有文件权限约束的 YAML 明文存储，不是系统钥匙串；Windows 权限检查也不能等同 POSIX。根据本任务“不存明文”的要求，没有接入该存储或宣称加密能力。

本版把用户在合成台输入的供应商密钥暂存于同一 Harness 窗口的插件根内存，iframe 重挂载时恢复。刷新整个宿主页面、关闭窗口、宿主连接失效或停用插件后失效；原合成台上方提供清除按钮。密钥仍不写 localStorage、IndexedDB、备份或任务记录。

桥接只接受当前 iframe 的 `source` 和精确同源 `origin`，只传递固定五供应商的有限长度字符串；使用递增 epoch 拒绝清除或 iframe 更换前排队的旧消息，防止延迟写回恢复已清除密钥；没有通用 RPC、会话读取或发送桥接。该 iframe 本来就是可信同源代码，此验证不是对恶意同源脚本的安全隔离。不要把密钥写进资料、消息或其他自由文本字段；这些用户选择保存的文本不是秘密检测器。

## 固定版本接口证据

核对宿主 commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，未以默认分支新接口代替 rc.1。

- [全局 main 槽](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-layout/src/client/index.ts)：root keyed main。
- [全局侧栏注册示例](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-schedule/src/client/index.ts)：main + sidebar.panellist。
- [Client 会话列表](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/api/session-controller/src/client/contract/sessions.ts)：展示标题来自 Client 快照；列表本身直接检查 session.list 的 RemoteResult，避免 refresh 吞错后把旧列表当作成功。不以列表可见替代会话访问授权。
- [会话 API 与目标资源解析](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/api/session-controller/src/index.ts)：events 的 address 与 prompt 的 sessionId 均由 Gateway 识别为目标会话。
- [请求及回执类型](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/api/session-controller/src/types.ts)：SessionPageRequest、SessionPromptRequest、SessionPromptValue。
- [逐资源授权执行](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/api/gateway/src/index.ts)：访问拒绝为 remote-access/denied。
- [本机凭据实际存储限制](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/credentials/credentials-local/README.md)。

## 验证与未完成事项

0.2.0-dev.3 密钥握手修复（134 项测试、lint、Harness 构建及包检查通过）：用合成假密钥在 dev.2 代码上复现同一 epoch 的延迟握手响应覆盖后续编辑；修复后忽略同轮重复快照，并保留首次握手前用户显式编辑的供应商密钥。明确清除标记仍优先于这些编辑，新 epoch 的清除仍生效。预设切换只合并 stylePreset，没有发现它直接清空配置；此竞态尚不能确认为用户 Windows 现象的唯一原因，未执行 Windows 实机或真实供应商调用。

0.2.0-dev.2 布局更新：132 项测试、lint、Harness 构建及包检查通过；新增默认合成台与往返切换保留 Studio 子树的回归。浏览器工具初始化失败，未完成本次布局的画面验收；下述真实 Web 测试为 dev.1 的验证，不代表 dev.2 布局或 Windows Desktop 已实测。

环境：Linux，Node 24.22.1，pnpm 11.25.0。插件仓库使用原依赖与锁文件。已运行 131 项源码测试、lint、Harness 与原站生产构建、安装包检查。lint 仅保留基线 runtime.ts 已有无用转义警告；Harness 构建仍有大 chunk 提示。新增回归覆盖 rc.1 不同消息形状、压缩替换过滤、列表刷新拒绝、停用期间的发送意图、不可变预览、密钥 epoch、历史字段白名单、精确图片大小与只读回执核对。

审查修复：实际 user/message 的 data 直接是消息，assistant/message 使用 data.message；只收录 append 消息，避免将压缩内部上下文当作用户消息。预览超过 20000 字符显示截断提示。插件停用时若持久化意图尚未完成，后续不再调用宿主发送。真实宿主发现 Cordis 必须同时注入 remote 与 remote.session，已修正并补回归断言。

本地 Chromium + 模拟宿主人工验收：创建角色、保存资料、关联两会话、读取并收录指定消息、来源记录、单目标预览与手动发送、accepted 与完成区分、卸载面板后恢复角色/发送记录、刷新后保留资料、打开原合成台。模拟环境没有真实会话、真实供应商请求或真实密钥。浏览器测试发现并修复了消息卡片与来源详情使用相同 sibling key 的问题。

真实 Web 集成：通过官方 npm 的 @deepseek-ai/dsh@0.2.2-rc.1，在 /tmp 独立 DSH_HOME 和独立依赖目录安装（ignore-scripts），通过官方 dsh plugin --profile web add 加载本地插件，再用 dsh web --no-open --host 127.0.0.1 启动。未改用户 profile 或开放公网端口。未登录插件路由返回 401；使用此隔离宿主生成的测试登录入口后，在 Chromium 验证左侧注册、动态模块加载、角色创建/保存、刷新恢复、空会话列表 RPC 与原合成台加载。没有配置模型、读取实际密钥或发送真实模型请求。

真实 Desktop 0.2.2-rc.1 尚未加载此开发版：当前机器没有该 Desktop。Web 验证不代替 Desktop origin/IPC、真实会话读取/发送、权限撤销、断线重连和重启验收。不宣称市场安装、自动更新或其他 profile 已支持。真实生图与密钥恢复尚未做付费服务或真实凭据验收。

后续范围：后台供应商任务持久化、完整配方编辑桥接、会话图片附件选择导入/发送、新角色库导出/恢复，以及真实 Desktop 验收。当前已实现生成结果的手动归档，原历史库保留独立。后台供应商请求目前仍由 iframe 发起；持久服务端任务需要单独设计凭据注入与恢复协议，不能把明文密钥写进任务记录。附件桥接未接入：宿主 attachment 方法的会话授权不等于任意附件引用的来源校验，后续需从已授权消息中派生用户选择的引用并验证归属、大小和格式；本版没有开放通用附件读取权限。

`assetRoot` 仍指向外部完整图库，包内不复制图库；受限远程素材不镜像、不打包。现有 owner admission、代理 origin/path/DNS 校验、同源检查和许可证收集保留。
