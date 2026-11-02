# 本地原型的数据关系

本文件描述当前交互实现，不是正式数据库规格。后续后台使用相同标识关系，避免复制数据。

## 事项

沿用 `studio-os-daily-prototype-v1` 的 tasks，兼容已有浏览器体验数据。

- id、title、type、date（计划日期）、time、status、note。
- completedAt：新增记录实际完成时间。重新打开则清空；历史缺失时明确标记，不伪造完成时间。
- reference.entityId 指向实验 id；旧原型内的静态 reference 仍可阅读。

## 素材

`studio-os-operations-v1` 的 materials。

id、title、kind、tags、url、note、archived、createdAt、example。

归档不删除记录或引用；可恢复。当前存储文本与链接，真实文件尚未接入。

## 实验

同一 operations 数据的 tests。

id、title、materialIds、hypothesis、variants、date、state、conclusion、observations、createdAt、updatedAt、example。

- materialIds 引用素材 id。
- 从实验安排工作时建立一个关联事项；重复安排直接进入原事项。
- 实验状态与事项执行状态独立。完成事项不等于得到结论。
- 知识中心测试结论直接过滤有结论的实验，无独立副本。

## 观察记录

实验内的 observations 数组，每次追加保留历史。

id、variant、observedAt（北京时间）、window、url、note、metrics（name、value）。

指标名可按实际口径填写，数值必须非负且有限，同次观察不得重复指标名。不自动对比或判定结果，不自动合并不同观察窗口。

## 正式系统前的约束

当前本地操作不代表团队权限已生效。服务器端必须验证登录、角色、记录范围和关联完整性。产品档案、样品档案与执行记录需在后续模块中共用，而非重复录入。原型备份导出不等于生产迁移方案。
