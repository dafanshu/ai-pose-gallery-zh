# 第三方代码与素材边界

本插件新增代码按仓库 MIT 协议提供；保留 `LICENSE` 中 Anhao 的原始版权与适用范围说明。

- **图库原有姿势/服装与原始数据**：根 LICENSE 明确不受代码 MIT 授权覆盖，并带非商业限制。来源为 ギア / @giaaibusi，https://ai-pose-gallery.pages.dev/ 。迁移不扩大用途或转授权。
- **人像**：仓库 README 标注原始人像为 CC0，但根 LICENSE 对图片排除范围更广。本插件不凭代码许可证放行所有素材；商用或重新分发须核对具体来源授权。https://ai-portrait-gallery.pages.dev/
- **CharaDB**：固定来源 `taki-ttt/charadb@7fe2e4b009ad6d85496101e929ac8528cb21d357`，目录 440 条。标签/名称与图片授权不同；原作者图片限制（仅参考、不得再分发、不得用于真人或未成年人）保留。只沿用原站在线图片，不复制进插件。https://github.com/taki-ttt/charadb/blob/7fe2e4b009ad6d85496101e929ac8528cb21d357/LICENSE
- **GIA 动漫服装**：固定 `hongye007/open-pose-costume@f08f2e48675caeec85f091dde308cd906582b50f`，目录 1320 条。原站远程图片，不镜像；按原来源条件使用。https://ai-costume-anime-gallery.pages.dev/
- **Shisei**：固定 `wquguru/shisei@8f61ceab10e45f8d3afd254900903733a0ba76ee`，57 套服装/227 视角；项目自有图片/数据 CC0。完整图库的 `data/shisei/LICENSE-images`、`NOTICE` 和来源清单保持原样。Shisei NOTICE 也明确其姿势目录中引用部分只是署名而非转授权；本次没有另导入该姿势目录。
- **dsh-image-gen**：架构/API 用法参考 Apache-2.0 项目 `shanliuling/dsh-image-gen@12c5e365e4015d3eeaa8b6fac51ee43eb5293cc4`；没有复制其图库、画布或供应商实现代码。https://github.com/shanliuling/dsh-image-gen
- **前端依赖**：继续使用原仓库锁定的依赖。构建后 `app/licenses/` 收集已安装依赖的许可证与 NOTICE，索引保留名称/版本/license。再分发构建产物前检查索引中缺少正文的条目，不把本插件 MIT 当成依赖或素材的统一许可证。

插件包与本次源码交付都**不包含 `data/`、`img/`、`thumbs/` 图库副本**；使用操作者已有完整目录。默认安全模式及原界面的来源/用途警示保留，迁移不取消限制。
