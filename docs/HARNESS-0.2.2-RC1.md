# DeepSeek Harness 0.2.2-rc.1 定版核对

## 准确版本依据

用户指定版本为 **0.2.2-rc.1**。本轮不再用浮动 master 或相邻 rc.2 代替目标。

- 官方 tag：`dsh-v0.2.2-rc.1`。
- tag 对应 commit：`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。
- [官方发布记录](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)：2026-11-04 13:07:14 UTC。
- [该提交的根 package.json](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/package.json) 声明版本 `0.2.2-rc.1`，Node `>=24.9.0`。

这里只验证官方源码与包清单接口。没有读取用户机器上实际安装包，也没有下载/执行 npm tarball，不能把这些证据等同于用户安装环境已验收。

## 本轮修改

1. 插件升为 `0.1.1`；在 `package.json` 使用官方支持的 `engines.dsh: "0.2.2-rc.1"` 固定目标，保留 Node 要求并声明 `dsh.manifestVersion: 1`。没有使用不存在的 `dsh.version` 字段。
2. 新增 `compatibility.mjs` 固定 tag/commit/version，并在注册任何路由前检查 `Context.effect`、`webServer.register`、`connection.admit`。安全能力缺失直接失败，不通过免鉴权降级兼容。
3. 健康接口明确返回 `compatibilityTarget` 和 `contractSource`。它们表示源码核对目标，不伪称实时探测到的宿主版本。
4. 界面、安装说明、验收步骤与交付版本清单均改为 rc.1；增加 5 项兼容测试。

## 逐项核对

- [HTTP/WS](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/host/webserver/src/index.ts)：`register` 的 prefix/exact 路由、`registerUpgrade` 的精确升级路由及 disposer 形状与本插件一致。该文件与先前检查的 rc.2 依据 `e8f7b93a...` 完全相同。
- [鉴权](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/connection/src/rpc-host.ts)：`admit(req)` 返回 `{peer}` 或 `{rejection}`，owner 在 `peer.principal.kind`。本插件 HTTP 和 Comfy WS 均按此核验；不会把仅认证的非 owner peer 放行。该文件也与此前依据完全相同。
- [原生页面槽](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/contract/slots.ts)：`conversation.view` 为 list/session scope，所用注册形状与 owner props 不变。整个文件与 rc.2 有其他槽接口差异，因此没有笼统宣称两版本全兼容。
- [浏览器加载契约](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/modules/src/client/manifest.ts)：`window.__ModuleLoader__.load({id,factory})` 返回插件 exports；本插件 id 与包名一致，外层使用宿主 React，完整 React19 工作台保留内部隔离运行时。
- [包清单定义](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/util/package-manifest/src/types.ts) 与 [app-boot 说明](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/boot/app-boot/README.md)：`engines.dsh` 接受精确 prerelease，由宿主加载前检查。若宿主拒绝版本，不添加版本豁免来绕过。

机器可读的来源 URL 和 Git blob 指纹见同目录 `HARNESS-0.2.2-RC1.evidence.json`。

## 测试与仍未验证的部分

**105 项 Node 原生测试通过**：原站回归、运行时和备份、HTTP/WS 本地模拟、owner 鉴权及 5 项 rc.1 定版/能力测试。补丁在固定图库基线副本上通过 `git apply --check`。

仍未执行生产 TypeScript 检查、Vite 构建、lint、真实 rc.1 加载、浏览器视觉与反复操作、实际模型或 ComfyUI 生图。既有依赖安装拒绝未被重试或绕过。包检查仍会如实报告缺少 `app/index.html` 和依赖许可证索引。

本版目标仍是 **web profile、根路径部署、单用户 owner**。版本号相同不意味着 Electron 的 `file://`/IPC、反向代理子路径、ACP/headless 或多租户受支持。进入真实验收前需确认运行形态；不要求用户为了这份迁移升级到 rc.2。
