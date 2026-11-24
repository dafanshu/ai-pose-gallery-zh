# 安卓版离线图库 ZIP

安卓 APK 不携带桌面图库的第三方素材。用已经在电脑上的完整图库生成 ZIP，复制到手机导入。不需要放开 Cloudflare Access 或部署服务。ZIP 是全量导出：每条索引记录都要有一张可用参考图，否则不会生成 ZIP。

## Windows 上制作

需要 Python 3.9+ 和 Pillow。在 PowerShell 进入 `export-android-gallery.py` 所在目录。将第一个参数指向含 `data`、`img`、`thumbs` 的**现有完整图库**，不是仅包含代码的工作区。完整图库必须包含六份索引。

```powershell
py -m pip install Pillow
py .\export-android-gallery.py 'D:\ai-pose-gallery-zh' "$env:USERPROFILE\Downloads\role-studio-gallery.zip" --charadb-dir 'D:\素材\CharaDB' --gia-dir 'D:\素材\Gia'
```

脚本全程只读本地文件。请把示例中的两个素材路径换成你已合法取得、并获准本地保存的目录。若原图库本身已包含所需图片，可不传这两个选项。

- CharaDB：可从[作者正式发布页](https://github.com/taki-ttt/charadb/releases/tag/v1.0)手动获取公开 ZIP；解压后把 `--charadb-dir` 指向直接包含 `img` 或 `thumb` 的目录。脚本按索引 ID 找 `img/O001.jpg`、`thumb/O001.webp`，也接受该目录直属的同 ID 图片。
- ギア动漫服装：`--gia-dir` 指向已有授权的本地图目录，按 ID 找 `png/SPR-0001.png`、`img/SPR-0001.webp`、`thumbs/SPR-0001.webp` 或目录直属的同 ID 图片。如没有整套授权素材，请向作者询问是否有获准的取得方式；[来源站](https://ai-costume-anime-gallery.pages.dev/)禁止自动批量获取图片。不能用别的来源或相似文件替代。
- 样例完整快照有 6,162 条索引（人像 1,499、服饰 3,224、姿势 1,439），实际以你本地六份索引为准。未能匹配或解码任何一条时，脚本列出文件、条目 ID 和原因，不会生成缺项包。旧版 `--download-remote` 已取消，不要使用。

核对控制台列出的人像、服饰、姿势数量，各类目录数等于导出数。把生成的 `role-studio-gallery.zip` 复制到手机「下载」，**不用解压**，也不需要另复制图片目录。App 打开「合成台」，点人像、服饰或姿势的「从图库选择」，再导入 ZIP。不在任一图库槽位把相册作为入口；只有额外参考图使用系统相册。

导入时 App 把 ZIP 作为自己的离线副本。预留足够空间容纳一份新 ZIP（替换时旧版会保留到检查成功）。确认导入后可离线打开 App 使用，建议在电脑另留一份 ZIP，供重装后重新导入。图库和「导出与还原备份」互相独立；已选中的图片会单独随配方或历史保存，替换/移除素材包不清掉它们。

## 包结构与上限

```text
role-studio-gallery.zip
├── manifest.json   # ID、类别、名称、标签，不含图片字节
├── thumbs/         # 按页加载的独立 JPEG 缩略图
└── images/         # 点选时读取的独立 JPEG 参考图
```

- 全量 ZIP 不按类别、敏感标记或原 ID 去重删行；原分类和标签按手机索引规格保留，每条记录分配独立 ZIP ID。不把外站链接、EXIF、配置或 API Key 写入包。缺失或无法解码的任一记录会使导出失败。素材许可按各来源执行，不要上传到公开仓库、Actions 或群聊。CharaDB 图片仅供参考、不得再分发、不得用于真人或未成年人，其他限制见项目的第三方声明。
- 整包上限 2 GiB，最多 10,000 项。超限时不会留下可误用的半截 ZIP，可用较小的 `--edge` 降低大小；`--per-kind` 不适用于 ZIP。不要手改 ZIP 结构或重新压缩。
- 缩略图最长边 320 像素，参考图默认 1024 像素；可用 `--edge 1280` 提高参考图尺寸（不会放大原图）。优先使用本地原图，找不到时才退到本地预览或缩略图。
- 重新导出请使用不同文件名，脚本不会覆盖已有文件。旧 `.json` 小包的导出方式仍保留给旧版使用，新版推荐 ZIP。手机不会在浏览图库时向外站请求图片；只有明确点击生成才会把所选参考图发送给本次使用的厂商。
