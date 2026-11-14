# 首发资料候选包

**状态：已准备候选，未提交、未生效；不能代替微信／真机／真实云验收。** 当前工作名称为“雷霆酷跑”，最终名称、图标、简介与隐私文本由负责人确认。

## 文件入口

| 内容 | 交付物 |
| --- | --- |
| 原创图标 | [512px预览](../../../../assets/branding/coastal/app-icon-512.png)、[1024母版](../../../../assets/branding/coastal/app-icon-1024.png)、[144px候选](../../../../assets/branding/coastal/app-icon-144.png) |
| 缩略辨识与制作说明 | [图标说明／64和32px](../../../../assets/branding/coastal/README.md) |
| 可编辑图标源 | [SVG分层源](../../../../art-source/branding/app-icon.svg)、[重建说明](../../../../art-source/branding/README.md) |
| 简介、玩法及审核路径 | [GAMEPLAY-REVIEW.md](GAMEPLAY-REVIEW.md) |
| 数据流与隐私底稿 | [PRIVACY-DRAFT.md](PRIVACY-DRAFT.md) |
| 负责人集中配合单 | [OWNER-INPUTS.md](OWNER-INPUTS.md) |
| 当前工程、云上传和来源核查 | [RELEASE-READINESS.md](../RELEASE-READINESS.md) |

图标只使用新写的矢量几何，无人物、旧图或字体；PNG为不透明方形，不预裁平台圆角。输出尺寸是候选和观察尺寸，正式规格以当前官方后台为准。它没有被接入客户端，也没有上传到微信后台。

## 接下来先落实什么

可优先填写配合单中的**AppID开发权限、已有云环境与预算范围**，或并行汇总原5角色／历史音频的来源记录。
已知设备暂不可配合，保留待可用时集中验收；无需反复做同一轮离线页面或重建现有模型。
主体、处理联系渠道、数据保留／删除策略明确后，再实现并验证需要补足的真实处理流程，定稿隐私文本。

客户端可导入目录仍是`apps/wx/dist`；独立云代码目录是`apps/wx/cloud-dist/thunder-api`，依赖安装与授权条件见核查文档。
当前`envId`为空，以上资料不会自动启用云服务。正式提审和公开发布分别需要负责人确认对应最终版本和操作范围。
