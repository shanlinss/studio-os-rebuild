import {hasPermission,requirePermission} from './permissions';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Identity } from './auth';

type Page = { id: string; title: string; management?: boolean; state?: 'partial' | 'planned' };
type Section = {
  id: string;
  title: string;
  management?: boolean;
  pages: Page[];
  groups?: string[];
};
// Names/order from the user; second level confirmed once against PRODUCT-BASELINE.
const sections: Section[] = [
  {
    id: 'workspace',
    title: '我的工作台',
    pages: [
      { id: 'today', title: '今日工作' },
      { id: 'reminders', title: '待办与提醒' },
      { id: 'history', title: '我的执行记录' },
      { id: 'attendance', title: '打卡与外勤' },
      { id: 'samples', title: '拍摄样品领还' },
    ],
  },
  {
    id: 'business',
    title: '业务中心',
    pages: [
      { id: 'product-testing', title: '测品中心' },
      { id: 'material-lab', title: '素材实验室' },
      { id: 'shooting', title: '素材拍摄' },
      { id: 'competitors', title: '竞品观测', management: true },
      { id: 'inventory', title: '库存管理', management: true },
      { id: 'overview', title: '经营总览', management: true, state: 'planned' },
    ],
  },
  {
    id: 'resources',
    title: '资源中心',
    pages: [
      { id: 'inbox', title: '素材收集箱' },
      { id: 'templates', title: '笔记模板' },
      { id: 'titles', title: '标题库' },
      { id: 'toolbox', title: '设计工具箱' },
    ],
  },
  {
    id: 'people',
    title: '人员中心',
    management: true,
    pages: [
      { id: 'members', title: '团队成员' },
      { id: 'business-accounts', title: '小红书账号管理' },
      { id: 'profiles', title: '员工档案', state: 'partial' },
      { id: 'attendance', title: '考勤记录' },
    ],
  },
  {
    id: 'finance',
    title: '财务中心',
    management: true,
    pages: [
      { id: 'ledger', title: '记账本' },
      { id: 'settlements', title: '结算与报销' },
      { id: 'lookups', title: '店铺与费用分类' },
    ],
  },
  {
    id: 'knowledge',
    title: '知识中心',
    pages: [
      { id: 'library', title: '运营知识库' },
      { id: 'conclusions', title: '测试结论' },
      { id: 'learning', title: '学习与复盘' },
    ],
  },
  {
    id: 'settings',
    title: '系统设置',
    management: true,
    pages: [],
    groups: [
      '用户与角色权限',
      '店铺基础资料',
      '业务基础配置',
      '数据与文件管理',
      '系统安全与备份',
    ],
  },
];
function knownIdentity(
  identity: Identity | undefined,
): asserts identity is Identity {
  if (!identity) throw new UnauthorizedException();
  if (!['admin', 'employee'].includes(identity.role))
    throw new ForbiddenException();
}
function accessibleSection(identity: Identity | undefined, id: string) {
  knownIdentity(identity);
  if(id==='finance')requirePermission(identity,'finance');
  const section = sections.find((section) => section.id === id);
  if (!section) throw new NotFoundException();
  if (section.management && identity.role !== 'admin')
    throw new ForbiddenException();
  return section;
}
export function navigationFor(identity: Identity | undefined) {
  knownIdentity(identity);
  return sections
    .filter((section) => (!section.management || identity.role === 'admin')&&(section.id!=='finance'||hasPermission(identity,'finance')))
    .map(({ id, title }) => ({ id, title }));
}
export function sectionFor(identity: Identity | undefined, id: string) {
  const section = accessibleSection(identity, id);
  return {
    id: section.id,
    title: section.title,
    stage: 'framework',
    secondary: section.pages
      .filter((page) => !page.management || identity!.role === 'admin')
      .map(({ id, title, state }) => ({ id, title, ...(state ? { state } : {}) })),
    groups: (section.groups ?? []).filter(g=>g!=='用户与角色权限'||hasPermission(identity,'account_security')),
  };
}
export function pageFor(
  identity: Identity | undefined,
  sectionId: string,
  pageId: string,
) {
  const section = accessibleSection(identity, sectionId);
  const page = section.pages.find((page) => page.id === pageId);
  if (!page) throw new NotFoundException();
  if (page.management && identity!.role !== 'admin')
    throw new ForbiddenException();
  return {
    id: page.id,
    title: page.title,
    sectionId: section.id,
    stage: page.state || 'framework',
  };
}
