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

036 的 accounts.version 仅用于已有账号权限的并发控制，account_access_events 仅记录角色/启停前后值与操作者，不存密码或会话。成员绑定沿用 members.login_account_id 的唯一外键；权限变更撤销原 sessions，未创建新的身份系统。设备对象已在 037 实现；仓库对象已在 038 实现，详见 assets-warehouse-plan.md。

037：equipment_assets 一物一档；equipment_loans 保存原成员/账号/可选拍摄外键及实际借还时间、归还状况与归还位置快照；equipment_events 为追加历史；equipment_receipts 仅保存幂等回执。维修与停用沿用原设备标识，归还不复制档案或执行任务。

038：warehouse_items 引用原 products，quantity=NULL 与 opening_confirmed=false 表示未登记；warehouse_movements 保存期初/出入库/实盘差异、原项目快照和可选纠错来源，禁止更新删除；warehouse_item_events 记录资料变更；warehouse_receipts 只负责幂等回放。基础单位与产品/规格在期初后锁定，汇总按类型和单位分组，不生成订单、财务或样品副本。

039：warehouse_sample_links 固定一个原样品的来源库存项目与规格/单位；warehouse_sample_transfers 只记录原出库、原样品入库事件的双向标识、数量及双方前后值/快照。两表禁止改写删除。余额仍由 warehouse_items.quantity 与 shooting_samples.available_quantity 承载，没有第三套库存；借还不回增产品数量。

040：account_lifecycle_events 记录原账号创建/重置密码的操作者、请求标识、非敏感元信息校验、原因、前后公开值和安全回执，禁止改写。密码及密码指纹不进入审计/回执；原 accounts.password_hash 是凭证存储。成员仍用 members.login_account_id，账号创建与可选绑定同一事务完成；重置不改变角色、启停或成员关联。

041：accounts 追加 superadmin 和 admin_permissions，角色仍为原 admin/employee；权限名称仅含已实现的 finance 与 account_security。account_permission_events 为不可改写的权限前后值/原因/操作者记录。新账号默认无敏感授权；旧管理员迁移显式保留原访问，不自动授予超级管理员。授权/账号状态变化与原 sessions 撤销共用账号管理事务锁。

042：attendance_daily_links 只保存 owner_id＋work_date 对原 period_id 的唯一关联及来源（登录生成/旧记录关联），原上下班时间、版本和审批历史仍在 attendance_periods。首次登录与原 sessions 同事务，签退与回执/事件/全部旧会话清理同事务。无跨日时间猜测、工资字段或第二套考勤事实。

043：leave_requests 关联原 accounts/members，存类型、起止时间、原因、状态、版本及审核/撤回/撤销信息；leave_events 追加前后快照，数据库禁止改写；leave_receipts 仅负责幂等恢复。请假独立于原打卡，不新增第二套人员/身份或任何薪资/财务数据。原批准信息在撤销后保留。时间段重叠在同员工事务锁下校验；不存猜测的计薪小时或假期余额。

044：attendance_exception_reviews 为原工作段的迟到/时长不足保存追加核实（属实/特殊说明/重新待核实）、原因、来源版本/时间快照、递增序号与前一条引用。数据库禁止改写；attendance_exception_receipts 仅负责幂等恢复。核实同步追加原 attendance_events，但不更新原打卡、原版本、工资或财务。最新核实以每工作段/异常种类的序号确定，源版本变化时旧结论仅供追溯。
