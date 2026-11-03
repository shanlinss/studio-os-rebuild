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

## 旧后端到位后的约束

2026-11-02 用户提供旧完整代码包。已有独立 PostgreSQL 后端包含 accounts/materials/lab_experiments/plans/tasks/publications/data_snapshots 等对象及 33 条迁移。本文件仅描述原型内存模型，不用于另建一套平行数据库。后续以已有服务端对象为基础，通过页面适配器接入，差异见 legacy-reuse-review.md。

## 原后端接入后的对象边界

示例原型的数据形状仅用于早期体验。真实服务复用 `studio_os` 原表：业务执行使用 `tasks`，个人安排使用 `personal_todos`，二者在首页合并显示但不相互复制；实验和轮次使用 `lab_experiments` / `plans`，参考素材使用原 `plan_materials`；发布、观察和复盘直接沿用原表及标识。

034 只在个人事项追加 `planned_on`、`due_at`、`completed_at`。035 的 `lab_dispatch_requests` 是重放回执，仅记录已创建的原任务标识，不生成第二套任务数据。原 33 个迁移文件的来源校验保持。详见 backend-compatibility.md。

### 2026-11-02 用户补充：内容与知识沉淀

- 草稿只保留本机保存，不开发多人同步。
- 知识库只做分类、查找与飞书文档导航；正文在飞书维护。
- 仅管理员维护导航的分类、名称、说明、标签与链接，操作放在当前页面，不单独设编辑板块。
- 复用现有知识条目与管理员权限；已有正文保留原数据，不新增正文编辑器或协作草稿存储。

036 的 accounts.version 仅用于已有账号权限的并发控制，account_access_events 仅记录角色/启停前后值与操作者，不存密码或会话。成员绑定沿用 members.login_account_id 的唯一外键；权限变更撤销原 sessions，未创建新的身份系统。设备对象已在 037 实现；仓库对象仍为规划，详见 assets-warehouse-plan.md。

037：equipment_assets 一物一档；equipment_loans 保存原成员/账号/可选拍摄外键及实际借还时间、归还状况与归还位置快照；equipment_events 为追加历史；equipment_receipts 仅保存幂等回执。维修与停用沿用原设备标识，归还不复制档案或执行任务。
