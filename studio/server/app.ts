import {EmploymentDates} from './employment-dates';
import {AdminPayrollBasis} from './payroll-basis';
import {PayrollConfirmations} from './payroll-confirmations';
import {Payroll} from './payroll';
import {AttendanceClosures} from './attendance-closures';
import {AttendanceMonthly} from './attendance-monthly';
import {AttendanceExceptions} from './attendance-exceptions';
import {LeaveRequests} from './leave';
import {DailyAttendance} from './daily-attendance';
import {AccountPermissions,requirePermission} from './permissions';
import {InventoryAccess} from './inventory-access';
import {Warehouse} from './warehouse';
import {Equipment} from './equipment';
import {PhoneCards} from './phone-cards';
import {PhoneCardFinance} from './phone-card-finance';
import {PhoneCardReminders} from './phone-card-reminders';
import {cardOperationReceipt} from './phone-card-operations';
import {EquipmentPurchase} from './equipment-purchase';
import {AccountLifecycle} from './account-lifecycle';
import {AccountAccess} from './account-access';
import 'reflect-metadata';
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  Res,
  ForbiddenException,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { StudioDatabase } from './database';
import path from 'node:path';
import express from 'express';
import { checkReadiness } from './readiness';
import { navigationFor, sectionFor, pageFor } from './navigation';
import { requireAdministrator, requireContributor } from './access';
import {
  requestIdentity,
  SafeExceptionFilter,
  type DiagnosticSink,
} from './diagnostics';
import { Authentication, AuthRequest } from './auth';
import { Stores } from './stores';
import { Attendance } from './attendance';
import { ShootingSamples } from './samples';
import { Members } from './registry';
import { BusinessAccounts } from './business-accounts';
import { Workflow } from './workflow';
import { Materials } from './materials';
import { Research } from './research';
import { uuid, version } from './validation';
import { PublicationAssets } from './publication-assets';
import { SnapshotImports } from './snapshot-imports';
import { Shooting } from './shooting';
import { ProductObservations } from './product-observations';
import {CommercialProducts} from './commercial-products';
import { Products } from './products';
import { Workbench } from './workbench';
import { Announcements } from './announcements';
import { Toolbox } from './toolbox';
import { Titles } from './titles';
import { PersonalTodos } from './personal-todos';
import { OperationalObservations } from './operational-observations';
import { Knowledge } from './knowledge';
import { Templates } from './templates';
import { Competitors } from './competitors';
import { Finance } from './finance';
import { labActivity } from './lab-activity';
import { MaterialLab } from './lab';
import { objectInput } from './validation';
import { Body, Patch } from '@nestjs/common';

export async function createStudioApp(
  database: StudioDatabase,
  webRoot = path.resolve('dist/studio/web'),
  options: { diagnosticSink?: DiagnosticSink } = {},
) {
  const auth = new Authentication(database);
  const stores = new Stores(database);
  const members = new Members(database);
  const employmentDates = new EmploymentDates(database);
  const adminPayrollBasis = new AdminPayrollBasis(database);
  const attendance = new Attendance(database);
  const dailyAttendance = new DailyAttendance(database);
  const leaveRequests = new LeaveRequests(database);
  const attendanceExceptions = new AttendanceExceptions(database);
  const attendanceMonthly = new AttendanceMonthly(database);
  const attendanceClosures = new AttendanceClosures(database);
  const payroll = new Payroll(database);
  const payrollConfirmations = new PayrollConfirmations(database);
  const workbookResponse=(res:express.Response,file:any)=>res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Studio-OS-payroll-'+file.month+'-'+file.id.slice(0,8)+'.xlsx"','Cache-Control':'no-store','X-Studio-Export-Id':file.id,'X-Studio-File-Hash':file.fileHash}).send(file.buffer);
  const samples = new ShootingSamples(database);
  const businessAccounts = new BusinessAccounts(database);
  const workflow = new Workflow(database);
  const materialInbox = new Materials(database);
  const lab = new MaterialLab(database);
  const research = new Research(database);
  const publicationAssets = new PublicationAssets(database);
  const snapshotImports = new SnapshotImports(database);
  const products = new Products(database);
  const commercialProducts=new CommercialProducts(database);
  const shooting = new Shooting(database);
  const productObservations = new ProductObservations(database);
  const workbench = new Workbench(database);
  const announcements = new Announcements(database);
  const toolbox = new Toolbox(database);
  const titles = new Titles(database);
  const todos = new PersonalTodos(database);
  const observations = new OperationalObservations(database);
  const knowledge = new Knowledge(database);
  const accountAccess = new AccountAccess(database);
  const accountPermissions = new AccountPermissions(database);
  const inventoryAccess = new InventoryAccess(database);
  const phoneCards = new PhoneCards(database);
  const phoneCardFinance = new PhoneCardFinance(database);
  const phoneCardReminders = new PhoneCardReminders(database);
  const equipmentPurchase = new EquipmentPurchase(database);
  const accountLifecycle = new AccountLifecycle(database);
  const equipment = new Equipment(database);
  const warehouse = new Warehouse(database);
  const templates = new Templates(database);
  const competitors = new Competitors(database);
  const finance = new Finance(database);
  const cookie = 'studio_session';
  @Controller('api')
  class InfrastructureController {
    @Get('research/dimensions') dimensions() {
      return research.dimensions();
    }
    @Post('research/dimensions') dimensionCreate(
      @Req() r: AuthRequest,
      @Body() b: unknown,
    ) {
      return research.dimension(r.identity!, b);
    }
    @Patch('research/dimensions/:id') dimensionEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return research.dimension(r.identity!, b, id);
    }
    @Get('research/materials/:id/elements') elements(@Param('id') id: string) {
      return research.elements(id);
    }
    @Post('research/materials/:id/elements') elementCreate(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return research.element(r.identity!, id, b);
    }
    @Patch('research/materials/:id/elements/:element') elementEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('element') e: string,
      @Body() b: unknown,
    ) {
      return research.element(r.identity!, id, b, e);
    }
    @Get('research/inspirations/catalog') inspirationCatalog(
      @Req() r: AuthRequest,
      @Query() q: Record<string, unknown>,
    ) {
      return research.catalog(r.identity!, 'inspirations', q);
    }
    @Get('research/candidates/catalog') candidateCatalog(
      @Req() r: AuthRequest,
      @Query() q: Record<string, unknown>,
    ) {
      return research.catalog(r.identity!, 'candidates', q);
    }
    @Get('research/inspirations') inspirations(@Req() r: AuthRequest) {
      return research.inspirations(r.identity!);
    }
    @Post('research/inspirations') inspirationCreate(
      @Req() r: AuthRequest,
      @Body() b: unknown,
    ) {
      return research.inspiration(r.identity!, b);
    }
    @Patch('research/inspirations/:id') inspirationEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return research.inspiration(r.identity!, b, id);
    }
    @Get('research/candidates') candidates() {
      return research.candidates();
    }
    @Get('research/candidates/:id') candidate(
      @Req() r: AuthRequest,
      @Param('id') id: string,
    ) {
      return research.detail(r.identity!, id);
    }
    @Post('research/candidates') candidateCreate(
      @Req() r: AuthRequest,
      @Body() b: unknown,
    ) {
      return research.candidate(r.identity!, b);
    }
    @Patch('research/candidates/:id') candidateStatus(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return research.status(r.identity!, id, b);
    }
    @Post('research/duplicates') duplicates(@Body() b: unknown) {
      return research.duplicates(b);
    }
    @Post('research/candidates/:id/preview') candidatePreview(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      return this.arrangeCandidate(r, id, body, true);
    }
    @Post('research/candidates/:id/dispatch') candidateDispatch(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      return this.arrangeCandidate(r, id, body, false);
    }
    private arrangeCandidate(
      r: AuthRequest,
      id: string,
      body: unknown,
      preview: boolean,
    ) {
      const b = objectInput(body, [
        'expectedVersion',
        'plan',
        'sourceHash',
        'productId',
      ]);
      if (
        !preview &&
        (typeof b.sourceHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(b.sourceHash))
      )
        throw new ForbiddenException();
      return workflow.createPlan(r.identity!, b.plan, undefined, {
        origin: {
          candidateId: uuid(id),
          expectedVersion: version(b.expectedVersion),
        },
        preview,
        sourceHash: b.sourceHash as string | undefined,
        productId: b.productId ? uuid(b.productId) : null,
      });
    }
    @Get('live')
    live() {
      return { status: 'ok' };
    }
    @Get('health')
    async health() {
      try {
        const readiness = await checkReadiness(database);
        return {
          status: 'ok',
          ...readiness,
          storage: 'local-adapter-only',
        };
      } catch {
        throw new ServiceUnavailableException(
          'Local database or migrations are not ready',
        );
      }
    }
    @Post('login')
    async login(
      @Req() req: AuthRequest,
      @Res({ passthrough: true }) res: express.Response,
    ) {
      const result = await auth.login(
        req.body?.username,
        req.body?.password,
        req.socket.remoteAddress ?? 'unknown',
      );
      res.cookie(cookie, result.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: req.secure,
        path: '/api',
        maxAge: 8 * 3600 * 1000,
      });
      return { user: result.user, csrfToken: result.csrf };
    }
    @Get('session')
    session(@Req() req: AuthRequest) {
      return { user: req.identity, csrfToken: req.csrf };
    }
    @Post('logout')
    async logout(
      @Req() req: AuthRequest,
      @Res({ passthrough: true }) res: express.Response,
    ) {
      await auth.logout(req);
      res.clearCookie(cookie, {
        secure: req.secure,
        path: '/api',
        httpOnly: true,
        sameSite: 'strict',
      });
      return { ok: true };
    }
    @Get('navigation')
    navigation(@Req() req: AuthRequest) {
      return navigationFor(req.identity);
    }
    @Get('sections/:id')
    section(@Req() req: AuthRequest, @Param('id') id: string) {
      return sectionFor(req.identity, id);
    }
    @Get('sections/:id/:page')
    page(
      @Req() req: AuthRequest,
      @Param('id') id: string,
      @Param('page') page: string,
    ) {
      return pageFor(req.identity, id, page);
    }
    @Get('admin/stores')
    listStores() {
      return stores.list();
    }
    @Post('admin/stores')
    createStore(@Req() req: AuthRequest, @Body() body: unknown) {
      return stores.create(body, req.identity!.id);
    }
    @Patch('admin/stores/:id')
    updateStore(
      @Req() req: AuthRequest,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      return stores.update(id, body, req.identity!.id);
    }
    @Get('packaging-consumptions/options')
    packagingConsumptionOptions(@Req() r:AuthRequest){return warehouse.consumptionOptions(r.identity!,r.query);}
    @Get('packaging-consumptions/receipts/:key')
    packagingConsumptionReceipt(@Req() r:AuthRequest,@Param('key') key:string){return warehouse.consumptionReceipt(r.identity!,key);}
    @Get('packaging-consumptions/:id')
    packagingConsumptionDetail(@Req() r:AuthRequest,@Param('id') id:string){return warehouse.consumptionDetail(r.identity!,id);}
    @Post('packaging-consumptions')
    packagingConsumption(@Req() r:AuthRequest,@Body() b:unknown){return warehouse.consumePackaging(r.identity!,b);}
    @Get('packaging-stock')
    scopedPackaging(@Req() r:AuthRequest){return warehouse.scopedCatalog(r.identity!,r.query);}
    @Get('packaging-stock/:id')
    scopedPackagingDetail(@Req() r:AuthRequest,@Param('id') id:string){return warehouse.scopedDetail(r.identity!,id,r.query);}
    @Post('packaging-stock/:id')
    scopedPackagingMove(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return warehouse.scopedMove(r.identity!,id,b);}
    @Get('packaging-stock/:id/receipts/:key')
    scopedPackagingReceipt(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return warehouse.scopedReceipt(r.identity!,id,key);}
    @Get('warehouse/reorder-alerts')
    warehouseReorderAlerts(@Req() r:AuthRequest){return warehouse.reorderAlerts(r.identity!,r.query);}
    @Post('warehouse/items/:id/packaging-balances/:balance/reorder-threshold')
    warehouseReorderThreshold(@Req() r:AuthRequest,@Param('id') id:string,@Param('balance') balance:string,@Body() b:unknown){
      return warehouse.setReorderThreshold(r.identity!,id,balance,b);
    }
    @Get('warehouse/items') warehouseCatalog(@Req() r: AuthRequest) { return warehouse.catalog(r.identity!,r.query); }
    @Get('phone-cards') phoneCardCatalog(@Req() r:AuthRequest){return phoneCards.catalog(r.identity!,r.query);}
    @Get('phone-card-finance/:id') phoneCardFinanceState(@Req() r:AuthRequest,@Param('id') id:string){return phoneCardFinance.state(r.identity!,id);}
    @Get('phone-card-finance/:id/recharges') phoneCardRecharges(@Req() r:AuthRequest,@Param('id') id:string){return phoneCardFinance.recharges(r.identity!,id,r.query);}
    @Post('phone-card-finance/:id/recharges') phoneCardRechargeCreate(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return phoneCardFinance.recharge(r.identity!,id,b);}
    @Get('phone-card-finance/:id/recharges/:record') phoneCardRechargeDetail(@Req() r:AuthRequest,@Param('id') id:string,@Param('record') record:string){return phoneCardFinance.rechargeDetail(r.identity!,id,record);}
    @Post('phone-card-finance/:id/recharges/:record') phoneCardRechargeCorrect(@Req() r:AuthRequest,@Param('id') id:string,@Param('record') record:string,@Body() b:unknown){return phoneCardFinance.recharge(r.identity!,id,b,record);}
    @Post('phone-card-finance/:id/recharges/:record/void') phoneCardRechargeVoid(@Req() r:AuthRequest,@Param('id') id:string,@Param('record') record:string,@Body() b:unknown){return phoneCardFinance.void(r.identity!,id,record,b);}
    @Get('phone-card-finance/:id/recharges/:record/history') phoneCardRechargeHistory(@Req() r:AuthRequest,@Param('id') id:string,@Param('record') record:string){return phoneCardFinance.rechargeHistory(r.identity!,id,record,r.query);}
    @Get('phone-card-finance/:id/balances') phoneCardBalances(@Req() r:AuthRequest,@Param('id') id:string){return phoneCardFinance.balances(r.identity!,id,r.query);}
    @Post('phone-card-finance/:id/balances') phoneCardBalanceSave(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return phoneCardFinance.balance(r.identity!,id,b);}
    @Get('phone-card-reminders') phoneCardReminderCatalog(@Req() r:AuthRequest){return phoneCardReminders.catalog(r.identity!,r.query);}
    @Get('phone-card-reminders/:id') phoneCardReminderState(@Req() r:AuthRequest,@Param('id') id:string){return phoneCardReminders.state(r.identity!,id);}
    @Post('phone-card-reminders/:id') phoneCardReminderSave(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return phoneCardReminders.save(r.identity!,id,b);}
    @Get('phone-card-reminders/:id/history') phoneCardReminderHistory(@Req() r:AuthRequest,@Param('id') id:string){return phoneCardReminders.history(r.identity!,id,r.query);}
    @Get('phone-card-operations/receipts/:key') phoneCardOperationReceipt(@Req() r:AuthRequest,@Param('key') key:string){return cardOperationReceipt(database,r.identity!,key);}
    @Get('phone-cards/options') phoneCardOptions(@Req() r:AuthRequest){return phoneCards.options(r.identity!);}
    @Get('phone-cards/receipts/:key') phoneCardReceipt(@Req() r:AuthRequest,@Param('key') key:string){return phoneCards.receipt(r.identity!,key);}
    @Get('phone-cards/:id') phoneCardDetail(@Req() r:AuthRequest,@Param('id') id:string){return phoneCards.detail(r.identity!,id);}
    @Post('phone-cards') phoneCardCreate(@Req() r:AuthRequest,@Body() b:unknown){return phoneCards.save(r.identity!,b);}
    @Patch('phone-cards/:id') phoneCardEdit(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return phoneCards.save(r.identity!,b,id);}
    @Get('phone-cards/:id/history') phoneCardHistory(@Req() r:AuthRequest,@Param('id') id:string){return phoneCards.history(r.identity!,id,r.query);}
    @Get('phone-cards/:id/identity') phoneCardIdentity(@Req() r:AuthRequest,@Param('id') id:string){return phoneCards.identity(r.identity!,id,r.query);}
    @Post('phone-cards/:id/identity') phoneCardIdentityEdit(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return phoneCards.saveIdentity(r.identity!,id,b);}
    @Get('equipment/catalog/:id/purchase') equipmentPurchaseState(@Req() r:AuthRequest,@Param('id') id:string){return equipmentPurchase.state(r.identity!,id);}
    @Get('equipment/catalog/:id/handover') equipmentHandoverState(@Req() r:AuthRequest,@Param('id') id:string){return equipment.handoverState(r.identity!,id);}
    @Post('equipment/catalog/:id/handover') equipmentHandover(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return equipment.handover(r.identity!,id,b);}
    @Get('equipment/catalog/:id/handovers') equipmentHandovers(@Req() r:AuthRequest,@Param('id') id:string){return equipment.handovers(r.identity!,id,r.query);}
    @Get('equipment/catalog/:id/images/:image')
    async equipmentImage(@Req() r:AuthRequest,@Param('id') id:string,@Param('image') image:string,@Res() res:express.Response){const f=await equipment.image(r.identity!,id,image);res.setHeader('Content-Type',f.mime);res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);res.send(f.content);}
    @Post('equipment/catalog/:id/image') equipmentImageUpload(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return equipment.uploadImage(r.identity!,id,b,r.headers['x-file-name'],r.headers['content-type'],r.headers['x-expected-version'],r.headers['x-request-key']);}
    @Delete('equipment/catalog/:id/image') equipmentImageRemove(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return equipment.removeImage(r.identity!,id,b);}
    @Post('equipment/catalog/:id/purchase') equipmentPurchaseSave(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return equipmentPurchase.save(r.identity!,id,b);}
    @Get('equipment/catalog/:id/purchase/history') equipmentPurchaseHistory(@Req() r:AuthRequest,@Param('id') id:string){return equipmentPurchase.history(r.identity!,id,r.query);}
    @Get('equipment/catalog/:id/purchase/receipts/:key') equipmentPurchaseReceipt(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return equipmentPurchase.receipt(r.identity!,id,key);}
    @Get('warehouse/items/:id') warehouseDetail(@Req() r: AuthRequest,@Param('id') id: string) { return warehouse.detail(r.identity!,id); }
    @Get('warehouse/items/:id/movements') warehouseMovements(@Req() r: AuthRequest,@Param('id') id: string) { return warehouse.movements(r.identity!,id,r.query); }
    @Get('warehouse/items/:id/movements/:movement') warehouseMovement(@Req() r: AuthRequest,@Param('id') id: string,@Param('movement') movement: string) { return warehouse.movement(r.identity!,id,movement); }
    @Get('warehouse/items/:id/sample-targets') warehouseSampleTargets(@Req() r: AuthRequest,@Param('id') id: string) { return warehouse.sampleTargets(r.identity!,id,r.query); }
    @Get('warehouse/items/:id/transfers') warehouseTransfers(@Req() r: AuthRequest,@Param('id') id: string) { return warehouse.transfers(r.identity!,id,r.query); }
    @Post('warehouse/items/:id/to-samples') warehouseToSamples(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return warehouse.transfer(r.identity!,id,b); }
    @Get('warehouse/items/:id/events') warehouseEvents(@Req() r: AuthRequest,@Param('id') id: string) { return warehouse.events(r.identity!,id,r.query); }
    @Get('warehouse/receipts/:key') warehouseReceipt(@Req() r: AuthRequest,@Param('key') key: string) { return warehouse.receipt(r.identity!,key); }
    @Post('warehouse/items') warehouseCreate(@Req() r: AuthRequest,@Body() b: unknown) { return warehouse.save(r.identity!,b); }
    @Patch('warehouse/items/:id') warehouseEdit(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return warehouse.save(r.identity!,b,id); }
    @Post('warehouse/items/:id/packaging-transfers')
    packagingTransfer(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return warehouse.transferPackaging(r.identity!,id,b);}
    @Get('warehouse/items/:id/packaging-transfers/:transfer')
    packagingTransferDetail(@Req() r:AuthRequest,@Param('id') id:string,@Param('transfer') transfer:string){
      return warehouse.packagingTransferDetail(r.identity!,id,transfer);
    }
    @Get('warehouse/items/:id/packaging-purchases')
    packagingPurchaseHistory(@Req() r:AuthRequest,@Param('id') id:string){return warehouse.packagingPurchaseHistory(r.identity!,id,r.query);}
    @Post('warehouse/items/:id/packaging-purchases')
    packagingPurchase(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return warehouse.purchasePackaging(r.identity!,id,b);}
    @Get('warehouse/items/:id/packaging-purchases/receipts/:key')
    packagingPurchaseReceipt(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return warehouse.packagingPurchaseReceipt(r.identity!,id,key);}
    @Post('warehouse/items/:id/packaging-balances')
    allocatePackaging(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){
      return warehouse.allocatePackaging(r.identity!,id,b);
    }
    @Post('warehouse/items/:id/movements') warehouseMove(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return warehouse.move(r.identity!,id,b); }
    @Get('equipment/catalog') equipmentCatalog(@Req() r: AuthRequest) { return equipment.catalog(r.identity!,r.query); }
    @Get('equipment/catalog/:id') equipmentDetail(@Req() r: AuthRequest,@Param('id') id: string) { return equipment.detail(r.identity!,id); }
    @Get('equipment/catalog/:id/history') equipmentHistory(@Req() r: AuthRequest,@Param('id') id: string) { return equipment.history(r.identity!,id,r.query); }
    @Get('equipment/loans/:id') equipmentLoan(@Req() r: AuthRequest,@Param('id') id: string) { return equipment.loan(r.identity!,id); }
    @Get('equipment/loans') equipmentLoans(@Req() r: AuthRequest) { return equipment.loans(r.identity!,r.query); }
    @Get('equipment/receipts/:key') equipmentReceipt(@Req() r: AuthRequest,@Param('key') key: string) { return equipment.receipt(r.identity!,key); }
    @Post('equipment/catalog') equipmentCreate(@Req() r: AuthRequest,@Body() b: unknown) { return equipment.save(r.identity!,b); }
    @Patch('equipment/catalog/:id') equipmentEdit(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return equipment.save(r.identity!,b,id); }
    @Post('equipment/catalog/:id/borrow') equipmentBorrow(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return equipment.borrow(r.identity!,id,b); }
    @Post('equipment/catalog/:id/state') equipmentState(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return equipment.state(r.identity!,id,b); }
    @Post('equipment/loans/:id/return') equipmentReturn(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return equipment.ownLoan(r.identity!,id,b); }
    @Patch('equipment/loans/:id/location') equipmentLocation(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return equipment.ownLoan(r.identity!,id,b,true); }
    @Get('samples/state') samplesState(@Req() r: AuthRequest) { return samples.state(r.identity!); }
    @Get('samples/catalog') samplesCatalog(@Req() r: AuthRequest) { return samples.catalog(r.identity!,r.query); }
    @Get('samples/loans') samplesLoans(@Req() r: AuthRequest) { return samples.loans(r.identity!,r.query); }
    @Get('samples/receipts/:key') samplesReceipt(@Req() r: AuthRequest,@Param('key') key: string) { return samples.receipt(r.identity!,key); }
    @Get('samples/catalog/:id/transfers') sampleTransfers(@Req() r: AuthRequest,@Param('id') id: string) { return warehouse.transfers(r.identity!,id,r.query,true); }
    @Get('samples/catalog/:id/history') samplesHistory(@Req() r: AuthRequest,@Param('id') id: string) { return samples.history(r.identity!,id,r.query); }
    @Get('samples/loans/:id/history') loansHistory(@Req() r: AuthRequest,@Param('id') id: string) { return samples.history(r.identity!,id,r.query,true); }
    @Post('samples/catalog') samplesCreate(@Req() r: AuthRequest,@Body() b: unknown) { return samples.save(r.identity!,b); }
    @Patch('samples/catalog/:id') samplesEdit(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return samples.save(r.identity!,b,id); }
    @Post('samples/catalog/:id/stock-in') samplesStock(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return samples.stock(r.identity!,id,b); }
    @Post('samples/catalog/:id/stocktake') samplesCount(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return samples.stock(r.identity!,id,b,true); }
    @Post('samples/catalog/:id/borrow') samplesBorrow(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return samples.borrow(r.identity!,id,b); }
    @Post('samples/loans/:id/return') samplesReturn(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return samples.ownLoan(r.identity!,id,b); }
    @Patch('samples/loans/:id/location') samplesMove(@Req() r: AuthRequest,@Param('id') id: string,@Body() b: unknown) { return samples.ownLoan(r.identity!,id,b,true); }
    @Get('payroll/admin-reviews') adminPayrollHistory(@Req() r:AuthRequest){return adminPayrollBasis.history(r.identity!,r.query);}
    @Post('payroll/admin-reviews') adminPayrollSave(@Req() r:AuthRequest,@Body() b:unknown){return adminPayrollBasis.save(r.identity!,b);}
    @Get('payroll/admin-review-receipts/:key') adminPayrollReceipt(@Req() r:AuthRequest,@Param('key') key:string){return adminPayrollBasis.receipt(r.identity!,key);}
    @Get('payroll/confirmations') payrollConfirmationHistory(@Req() r:AuthRequest){return payrollConfirmations.history(r.identity!,r.query);}
    @Get('payroll/confirmations/:id') payrollConfirmationDetail(@Req() r:AuthRequest,@Param('id') id:string){return payrollConfirmations.detail(r.identity!,id,r.query);}
    @Post('payroll/confirmations') payrollConfirm(@Req() r:AuthRequest,@Body() b:unknown){return payrollConfirmations.save(r.identity!,b);}
    @Get('payroll/confirmation-receipts/:key') payrollConfirmReceipt(@Req() r:AuthRequest,@Param('key') key:string){return payrollConfirmations.receipt(r.identity!,key);}
    @Get('payroll/exportable') payrollExportable(@Req() r:AuthRequest){return payrollConfirmations.list(r.identity!,r.query);}
    @Get('payroll/exports') payrollExportHistory(@Req() r:AuthRequest){return payrollConfirmations.exportHistory(r.identity!,r.query);}
    @Post('payroll/exports') async payrollExport(@Req() r:AuthRequest,@Body() b:unknown,@Res() res:express.Response){return workbookResponse(res,await payrollConfirmations.export(r.identity!,b));}
    @Get('payroll/exports/:id') async payrollExportFile(@Req() r:AuthRequest,@Param('id') id:string,@Res() res:express.Response){return workbookResponse(res,await payrollConfirmations.exportFile(r.identity!,id,r.query));}
    @Get('payroll/export-receipts/:key') payrollExportReceipt(@Req() r:AuthRequest,@Param('key') key:string){return payrollConfirmations.exportReceipt(r.identity!,key);}
    @Get('payroll/state') payrollState(@Req() r:AuthRequest){return payroll.state(r.identity!,r.query);}
    @Get('payroll/salaries') salaryHistory(@Req() r:AuthRequest){return payroll.history(r.identity!,r.query,true);}
    @Post('payroll/salaries') salarySave(@Req() r:AuthRequest,@Body() b:unknown){return payroll.saveSalary(r.identity!,b);}
    @Get('payroll/drafts') payrollHistory(@Req() r:AuthRequest){return payroll.history(r.identity!,r.query);}
    @Post('payroll/drafts') payrollSave(@Req() r:AuthRequest,@Body() b:unknown){return payroll.saveDraft(r.identity!,b);}
    @Get('payroll/receipts/:key') payrollReceipt(@Req() r:AuthRequest,@Param('key') key:string){return payroll.receipt(r.identity!,key);}
    @Get('attendance/month-closures') closureState(@Req() r:AuthRequest){return attendanceClosures.state(r.identity!,r.query);}
    @Get('attendance/month-closures/history') closureHistory(@Req() r:AuthRequest){return attendanceClosures.history(r.identity!,r.query);}
    @Get('attendance/month-closures/:id') closureDetail(@Req() r:AuthRequest,@Param('id') id:string){return attendanceClosures.detail(r.identity!,id,r.query);}
    @Post('attendance/month-closures') closureSave(@Req() r:AuthRequest,@Body() b:unknown){return attendanceClosures.save(r.identity!,b);}
    @Get('attendance/month-closure-receipts/:key') closureReceipt(@Req() r:AuthRequest,@Param('key') key:string){return attendanceClosures.receipt(r.identity!,key);}
    @Get('attendance/monthly') monthlyAttendance(@Req() r:AuthRequest){return attendanceMonthly.monthly(r.identity!,r.query);}
    @Get('attendance/calendar') attendanceCalendar(@Req() r:AuthRequest){return attendanceMonthly.calendar(r.identity!,r.query);}
    @Get('attendance/calendar/:date/history') calendarHistory(@Req() r:AuthRequest,@Param('date') date:string){return attendanceMonthly.calendarHistory(r.identity!,date,r.query);}
    @Post('attendance/calendar/:date') calendarSave(@Req() r:AuthRequest,@Param('date') date:string,@Body() b:unknown){return attendanceMonthly.saveCalendar(r.identity!,date,b);}
    @Get('attendance/calendar-receipts/:key') calendarReceipt(@Req() r:AuthRequest,@Param('key') key:string){return attendanceMonthly.receipt(r.identity!,key);}
    @Get('attendance/exceptions') exceptionList(@Req() r:AuthRequest){return attendanceExceptions.list(r.identity!,r.query);}
    @Get('attendance/exception-receipts/:key') exceptionReceipt(@Req() r:AuthRequest,@Param('key') key:string){return attendanceExceptions.receipt(r.identity!,key);}
    @Get('attendance/periods/:id/exceptions') exceptionDetail(@Req() r:AuthRequest,@Param('id') id:string){return attendanceExceptions.detail(r.identity!,id,r.query);}
    @Get('attendance/periods/:id/exceptions/history') exceptionHistory(@Req() r:AuthRequest,@Param('id') id:string){return attendanceExceptions.history(r.identity!,id,r.query);}
    @Post('attendance/periods/:id/exceptions') exceptionSave(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return attendanceExceptions.save(r.identity!,id,b);}
    @Get('attendance/leaves') leaves(@Req() r:AuthRequest){return leaveRequests.list(r.identity!,r.query);}
    @Get('attendance/leave-receipts/:key') leaveReceipt(@Req() r:AuthRequest,@Param('key') key:string){return leaveRequests.receipt(r.identity!,key);}
    @Get('attendance/leaves/:id') leaveDetail(@Req() r:AuthRequest,@Param('id') id:string){return leaveRequests.detail(r.identity!,id,r.query);}
    @Get('attendance/leaves/:id/history') leaveHistory(@Req() r:AuthRequest,@Param('id') id:string){return leaveRequests.history(r.identity!,id,r.query);}
    @Post('attendance/leaves') leaveCreate(@Req() r:AuthRequest,@Body() b:unknown){return leaveRequests.save(r.identity!,b);}
    @Patch('attendance/leaves/:id') leaveEdit(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return leaveRequests.save(r.identity!,b,id);}
    @Post('attendance/leaves/:id/:action') leaveAction(@Req() r:AuthRequest,@Param('id') id:string,@Param('action') action:string,@Body() b:unknown){return leaveRequests.act(r.identity!,id,action,b);}
    @Get('attendance/daily')
    attendanceDaily(@Req() r:AuthRequest){return dailyAttendance.state(r.identity!);}
    @Post('attendance/end-work')
    async attendanceEndWork(@Req() r:AuthRequest,@Body() b:unknown,@Res({passthrough:true}) res:express.Response){const result=await dailyAttendance.end(r.identity!,r.tokenHash,b);res.clearCookie(cookie,{secure:r.secure,path:'/api',httpOnly:true,sameSite:'strict'});return result;}
    @Get('attendance/state') attendanceState(@Req() r: AuthRequest) { return attendance.state(r.identity!); }
    @Get('attendance/receipts/:key') attendanceReceipt(@Req() r: AuthRequest, @Param('key') key: string) { return attendance.receipt(r.identity!, key); }
    @Get('attendance/periods') attendancePeriods(@Req() r: AuthRequest) { return attendance.list(r.identity!, r.query); }
    @Get('attendance/periods/:id') attendancePeriodDetail(@Req() r:AuthRequest,@Param('id') id:string){return attendance.detail(r.identity!,id,r.query);}
    @Get('attendance/corrections/:id') attendanceCorrectionDetail(@Req() r:AuthRequest,@Param('id') id:string){return attendance.detail(r.identity!,id,r.query,true);}
    @Get('attendance/corrections') attendanceCorrections(@Req() r: AuthRequest) { return attendance.list(r.identity!, r.query, true); }
    @Get('attendance/periods/:id/history') attendanceHistory(@Req() r: AuthRequest, @Param('id') id: string) { return attendance.history(r.identity!, id, r.query); }
    @Get('attendance/corrections/:id/history') attendanceCorrectionHistory(@Req() r: AuthRequest, @Param('id') id: string) { return attendance.history(r.identity!, id, r.query, true); }
    @Post('attendance/studio/in') attendanceStudioIn(@Req() r: AuthRequest, @Body() b: unknown) { return attendance.studioIn(r.identity!, b); }
    @Post('attendance/field') attendanceField(@Req() r: AuthRequest, @Body() b: unknown) { return attendance.field(r.identity!, b); }
    @Post('attendance/periods/:id/in') attendanceIn(@Req() r: AuthRequest, @Param('id') id: string, @Body() b: unknown) { return attendance.clock(r.identity!, id, 'in', b); }
    @Post('attendance/periods/:id/out') attendanceOut(@Req() r: AuthRequest, @Param('id') id: string, @Body() b: unknown) { return attendance.clock(r.identity!, id, 'out', b); }
    @Post('attendance/periods/:id/decision') attendanceDecision(@Req() r: AuthRequest, @Param('id') id: string, @Body() b: unknown) { return attendance.decideField(r.identity!, id, b); }
    @Post('attendance/corrections') attendanceCorrection(@Req() r: AuthRequest, @Body() b: unknown) { return attendance.correction(r.identity!, b); }
    @Patch('attendance/corrections/:id') attendanceCorrectionEdit(@Req() r: AuthRequest, @Param('id') id: string, @Body() b: unknown) { return attendance.correction(r.identity!, b, id); }
    @Post('attendance/corrections/:id/decision') attendanceCorrectionDecision(@Req() r: AuthRequest, @Param('id') id: string, @Body() b: unknown) { return attendance.decideCorrection(r.identity!, id, b); }
    @Get('workbench/profile')
    ownMemberProfile(@Req() req: AuthRequest) {
      return members.ownProfile(req.identity!.id, req.query);
    }
    @Post('admin/members/:id/employment') employmentSave(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return employmentDates.save(r.identity!,id,b);}
    @Get('admin/members/:id/history') employmentHistory(@Req() r:AuthRequest,@Param('id') id:string){return employmentDates.history(r.identity!,id,r.query);}
    @Get('admin/employment-receipts/:key') employmentReceipt(@Req() r:AuthRequest,@Param('key') key:string){return employmentDates.receipt(r.identity!,key);}
    @Get('admin/members')
    listMembers(@Req() req:AuthRequest) {
      return members.list(req.identity!);
    }
    @Post('admin/members')
    createMember(@Req() req: AuthRequest, @Body() body: unknown) {
      return members.create(body, req.identity!.id);
    }
    @Patch('admin/members/:id')
    updateMember(
      @Req() req: AuthRequest,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      return members.update(id, body, req.identity!.id);
    }
    @Get('admin/business-accounts')
    listBusinessAccounts(@Req() r:AuthRequest) {
      return businessAccounts.list(r.identity!);
    }
    @Get('admin/business-accounts/:id/history')
    businessAccountHistory(@Req() req: AuthRequest, @Param('id') id: string) {
      return businessAccounts.history(req.identity!, id);
    }
    @Post('admin/business-accounts')
    createBusinessAccount(@Req() req: AuthRequest, @Body() body: unknown) {
      return businessAccounts.save(body, req.identity!.id);
    }
    @Patch('admin/business-accounts/:id')
    updateBusinessAccount(
      @Req() req: AuthRequest,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      return businessAccounts.save(body, req.identity!.id, id);
    }
    @Get('material-store-options')
    materialStoreOptions() {
      return database.client`SELECT s.id,s.name,s.active FROM studio_os.stores s LEFT JOIN studio_os.material_folder_positions p ON p.store_id=s.id ORDER BY s.active DESC,p.position NULLS LAST,s.name,s.id`;
    }
    @Get('admin/material-folders')
    materialFolders() {
      return stores.folders();
    }
    @Patch('admin/material-folders/:id/order')
    moveMaterialFolder(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return stores.moveFolder(r.identity!, id, b);
    }
    @Get(['admin/materials', 'materials'])
    materials(@Req() r: AuthRequest) {
      return materialInbox.list(r.identity!);
    }
    @Post(['admin/materials', 'materials'])
    addMaterial(@Req() r: AuthRequest, @Body() b: unknown) {
      return materialInbox.save(r.identity!, b);
    }
    @Get(['admin/materials/:id', 'materials/:id'])
    materialDetail(@Req() r: AuthRequest, @Param('id') id: string) {
      return materialInbox.detail(r.identity!, id);
    }
    @Patch(['admin/materials/:id', 'materials/:id'])
    editMaterial(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return materialInbox.save(r.identity!, b, id);
    }
    @Patch('materials/:id/stores')
    organizeMaterialStores(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return materialInbox.replaceStores(r.identity!, id, b);
    }
    @Delete(['admin/materials/:id', 'materials/:id'])
    deleteMaterial(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      const body = objectInput(b, ['expectedVersion']);
      return materialInbox.remove(r.identity!, id, body.expectedVersion);
    }
    @Post(['admin/materials/:id/assets', 'materials/:id/assets'])
    uploadMaterial(@Req() r: AuthRequest, @Param('id') id: string) {
      return materialInbox.upload(
        r.identity!,
        id,
        r.body,
        r.headers['x-file-name'],
        r.headers['x-asset-kind'],
        r.headers['content-type'],
      );
    }
    @Get(['admin/materials/:id/assets/:asset', 'materials/:id/assets/:asset'])
    async materialAsset(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Res() res: express.Response,
    ) {
      const file = await materialInbox.asset(r.identity!, id, asset);
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.send(file.content);
    }
    @Delete([
      'admin/materials/:id/assets/:asset',
      'materials/:id/assets/:asset',
    ])
    deleteMaterialAsset(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
    ) {
      return materialInbox.removeAsset(r.identity!, id, asset);
    }
    @Post('materials/:id/assets/:asset/downloads')
    async downloadMaterialAsset(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Res() res: express.Response,
    ) {
      objectInput(r.body ?? {}, []);
      const file = await materialInbox.download(r.identity!, id, asset);
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Studio-Download-Receipt', file.receipt);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.status(200).send(file.content);
    }
    @Post('materials/:id/assets/:asset/downloads/:receipt')
    confirmMaterialDownload(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Param('receipt') receipt: string,
    ) {
      objectInput(r.body ?? {}, []);
      return materialInbox.confirmDownload(r.identity!, id, asset, receipt);
    }
    @Get('lab/experiments')
    experiments(@Req() r: AuthRequest) {
      return lab.list(r.identity!);
    }
    @Post('lab/experiments')
    createExperimentDraft(@Req() r: AuthRequest, @Body() b: unknown) {
      return lab.createDraft(r.identity!, b);
    }
    @Post('lab/experiments/:id/rounds/:round/assignments')
    assignExperimentRound(@Req() r: AuthRequest, @Param('id') id: string, @Param('round') round: string, @Body() b: unknown) {
      return lab.dispatch(r.identity!, id, round, b);
    }
    @Get('lab/experiments/:id/rounds/:round/assignments/:key')
    experimentDispatchReceipt(@Req() r: AuthRequest, @Param('id') id: string, @Param('round') round: string, @Param('key') key: string) {
      return lab.dispatchReceipt(r.identity!, id, round, key);
    }
    @Get('lab/experiments/:id')
    experiment(@Req() r: AuthRequest, @Param('id') id: string) {
      return lab.detail(r.identity!, id);
    }
    @Get('lab/experiments/:id/activity')
    experimentActivity(@Req() r: AuthRequest, @Param('id') id: string) {
      return labActivity(database, r.identity!, id, r.query.cursor);
    }
    @Post('lab/experiments/:id/rounds')
    nextExperimentRound(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return lab.nextRound(r.identity!, id, b);
    }
    @Patch('lab/experiments/:id/product')
    experimentProduct(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return lab.linkProduct(r.identity!, id, b);
    }
    @Patch('lab/experiments/:id/priority')
    experimentPriority(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return lab.priority(r.identity!, id, b);
    }
    @Post('lab/experiments/:id/rounds/:plan/reviews')
    experimentReview(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('plan') plan: string,
      @Body() b: unknown,
    ) {
      return lab.review(r.identity!, id, plan, b);
    }
    @Post('lab/experiments/:id/conclusion')
    experimentConclusion(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return lab.finish(r.identity!, id, b);
    }
    @Get('admin/plans')
    plans(@Req() r: AuthRequest) {
      return workflow.plans(r.identity!);
    }
    @Post('admin/plans')
    addPlan(@Req() r: AuthRequest, @Body() b: unknown) {
      return workflow.createPlan(r.identity!, b);
    }
    @Patch('admin/plans/:id/conclusion')
    conclude(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return workflow.conclude(r.identity!, id, b);
    }
    @Get('tasks')
    tasks(@Req() r: AuthRequest) {
      return workflow.tasks(r.identity!);
    }
    @Get('tasks/:id')
    task(@Req() r: AuthRequest, @Param('id') id: string) {
      return workflow.detail(r.identity!, id);
    }
    @Get('tasks/:id/materials/:material/assets/:asset')
    async taskMaterialAsset(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('material') material: string,
      @Param('asset') asset: string,
      @Res() res: express.Response,
    ) {
      const file = await materialInbox.taskAsset(
        r.identity!,
        id,
        material,
        asset,
      );
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.send(file.content);
    }
    @Post('tasks/:id/publications')
    publish(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return workflow.publish(r.identity!, id, b);
    }
    @Post('tasks/:id/publications/:publicationId/assets')
    publicationUpload(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('publicationId') n: string,
      @Body() bytes: unknown,
    ) {
      return publicationAssets.upload(
        r.identity!,
        id,
        n,
        bytes,
        r.headers['x-file-name'],
        r.headers['content-type'],
      );
    }
    @Get('tasks/:id/publications/:publicationId/assets/:asset')
    async publicationFile(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('publicationId') n: string,
      @Param('asset') asset: string,
      @Res() res: express.Response,
    ) {
      const file = await publicationAssets.file(r.identity!, id, n, asset);
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.send(file.content);
    }
    @Delete('tasks/:id/publications/:publicationId/assets/:asset')
    publicationRemove(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('publicationId') n: string,
      @Param('asset') asset: string,
    ) {
      return publicationAssets.remove(r.identity!, id, n, asset);
    }
    @Post('tasks/:id/publications/:publicationId/snapshots')
    snapshot(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('publicationId') n: string,
      @Body() b: unknown,
    ) {
      return workflow.snapshot(r.identity!, id, n, b);
    }
    @Post('lab/experiments/:id/rounds/:round/import-preview')
    importPreview(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('round') round: string,
      @Body() b: unknown,
    ) {
      return snapshotImports.preview(r.identity!, id, round, b);
    }
    @Post('lab/experiments/:id/rounds/:round/imports')
    importSnapshots(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('round') round: string,
      @Body() b: unknown,
    ) {
      return snapshotImports.commit(r.identity!, id, round, b);
    }
    @Get('announcements')
    announcementsList(@Req() r: AuthRequest) {
      return announcements.list(r.identity!);
    }
    @Get('announcements/:id')
    announcementDetail(@Req() r: AuthRequest, @Param('id') id: string) {
      return announcements.detail(r.identity!, id);
    }
    @Post('announcements')
    announcementCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return announcements.save(r.identity!, b);
    }
    @Patch('announcements/:id')
    announcementUpdate(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return announcements.save(r.identity!, b, id);
    }
    @Delete('announcements/:id')
    announcementDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return announcements.remove(r.identity!, id, b);
    }
    @Get('workbench/observations/authors') obsAuthors(@Req() r: AuthRequest) {
      return observations.authors(r.identity!);
    }
    @Get('workbench/observations/replays/:key') obsReceipt(
      @Req() r: AuthRequest,
      @Param('key') key: string,
    ) {
      return observations.receipt(r.identity!, key);
    }
    @Get('workbench/observations') obsList(@Req() r: AuthRequest) {
      return observations.catalog(r.identity!, r.query);
    }
    @Get('workbench/observations/:id/history') obsHistory(
      @Req() r: AuthRequest,
      @Param('id') id: string,
    ) {
      return observations.history(r.identity!, id, r.query);
    }
    @Get('workbench/observations/:id/attachments/:asset') async obsFile(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Res() res: express.Response,
    ) {
      const f = await observations.file(r.identity!, id, asset);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', f.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      );
      res.send(f.content);
    }
    @Get('workbench/observations/:id') obsDetail(
      @Req() r: AuthRequest,
      @Param('id') id: string,
    ) {
      return observations.detail(r.identity!, id);
    }
    @Post('workbench/observations') obsCreate(
      @Req() r: AuthRequest,
      @Body() b: unknown,
    ) {
      return observations.save(r.identity!, b);
    }
    @Patch('workbench/observations/:id') obsEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return observations.save(r.identity!, b, id);
    }
    @Get('workbench/capabilities')
    workbenchCapabilities() {
      return { personalTodoSchedule: 1, materialLabDrafts: 1 };
    }
    @Get('workbench/todos')
    personalTodos(@Req() r: AuthRequest) {
      return todos.list(r.identity!, r.query);
    }
    @Post('workbench/todos')
    createTodo(@Req() r: AuthRequest, @Body() b: unknown) {
      return todos.create(r.identity!, b);
    }
    @Patch('workbench/todos/:id')
    updateTodo(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return todos.mutate(r.identity!, id, b);
    }
    @Delete('workbench/todos/:id')
    removeTodo(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return todos.mutate(r.identity!, id, b, true);
    }
    @Get('workbench/material-refills')
    materialRefills(@Req() r: AuthRequest) {
      return workbench.materialRefills(r.identity!);
    }
    @Get('workbench/activity')
    workbenchActivity(@Req() r: AuthRequest) {
      return workbench.activity(r.identity!, r.query);
    }
    @Get('workbench/completed')
    workbenchCompleted(@Req() r: AuthRequest) {
      return workbench.completed(r.identity!, r.query);
    }
    @Get('workbench/refills')
    pendingRefills(@Req() r: AuthRequest) {
      return workbench.refills(r.identity!);
    }
    @Get('titles')
    titlesList(@Req() r: AuthRequest) {
      return titles.list(r.identity!);
    }
    @Get('titles/catalog')
    titleCatalog(@Req() r: AuthRequest) {
      return titles.catalog(r.identity!, r.query);
    }
    @Get('titles/:id')
    titlesDetail(@Req() r: AuthRequest, @Param('id') id: string) {
      return titles.detail(r.identity!, id);
    }
    @Post('titles')
    titlesCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return titles.create(r.identity!, b);
    }
    @Patch('titles/:id')
    titlesRename(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return titles.mutate(r.identity!, id, 'renamed', b);
    }
    @Delete('titles/:id')
    titlesDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return titles.mutate(r.identity!, id, 'deleted', b);
    }
    @Post('titles/:id/entries')
    titlesAppend(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return titles.mutate(r.identity!, id, 'appended', b);
    }
    @Patch('titles/:id/entries/:entry')
    titlesEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('entry') entry: string,
      @Body() b: unknown,
    ) {
      return titles.mutate(r.identity!, id, 'edited', b, entry);
    }
    @Delete('titles/:id/entries/:entry')
    titlesRemove(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('entry') entry: string,
      @Body() b: unknown,
    ) {
      return titles.mutate(r.identity!, id, 'removed', b, entry);
    }
    @Post('titles/:id/copies')
    titlesCopy(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return titles.copied(r.identity!, id, b);
    }
    @Get('toolbox')
    toolboxList(@Req() r: AuthRequest) {
      return toolbox.list(r.identity!);
    }
    @Post('toolbox')
    toolboxCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return toolbox.save(r.identity!, b);
    }
    @Patch('toolbox/:id')
    toolboxEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return toolbox.save(r.identity!, b, id);
    }
    @Delete('toolbox/:id')
    toolboxRemove(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return toolbox.remove(r.identity!, id, b);
    }
    @Get('knowledge')
    knowledgeList(@Req() r: AuthRequest) {
      return knowledge.list(r.identity!);
    }
    @Get('knowledge/conclusion-sources')
    knowledgeSources(@Req() r: AuthRequest) {
      return knowledge.sources(r.identity!);
    }
    @Post('knowledge/navigation')
    knowledgeNavigationCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return knowledge.navigation(r.identity!, b);
    }
    @Patch('knowledge/:id/navigation')
    knowledgeNavigationEdit(@Req() r: AuthRequest, @Param('id') id: string, @Body() b: unknown) {
      return knowledge.navigation(r.identity!, b, id);
    }
    @Post('knowledge')
    knowledgeCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return knowledge.save(r.identity!, b);
    }
    @Patch('knowledge/:id')
    knowledgeEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return knowledge.save(r.identity!, b, id);
    }
    @Delete('knowledge/:id')
    knowledgeRemove(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return knowledge.remove(r.identity!, id, b);
    }
    @Get('knowledge/:id/cover')
    async knowledgeCover(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Res() res: express.Response,
    ) {
      const file = await knowledge.cover(r.identity!, id);
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.send(file.content);
    }
    @Post('knowledge/:id/cover')
    knowledgeUpload(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return knowledge.upload(
        r.identity!,
        id,
        b,
        r.headers['x-file-name'],
        r.headers['content-type'],
        r.headers['x-expected-version'],
      );
    }
    @Delete('knowledge/:id/cover')
    knowledgeClearCover(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return knowledge.clearCover(r.identity!, id, b);
    }

    @Get('finance')
    financeList(@Req() r: AuthRequest) {
      return finance.list(r.identity!);
    }
    @Post('finance/categories')
    financeCategoryCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return finance.category(r.identity!, b);
    }
    @Patch('finance/categories/:id')
    financeCategoryEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return finance.category(r.identity!, b, id);
    }
    @Post('finance/expenses')
    financeExpenseCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return finance.save(r.identity!, b);
    }
    @Patch('finance/expenses/:id')
    financeExpenseEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return finance.save(r.identity!, b, id);
    }
    @Delete('finance/expenses/:id')
    financeExpenseDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return finance.remove(r.identity!, id, b);
    }
    @Post('finance/settlements')
    financeSettle(@Req() r: AuthRequest, @Body() b: unknown) {
      return finance.settle(r.identity!, b);
    }
    @Post('finance/payments')
    financePay(@Req() r: AuthRequest, @Body() b: unknown) {
      return finance.pay(r.identity!, b);
    }
    @Post('finance/expenses/:id/receipts')
    financeReceiptUpload(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return finance.upload(
        r.identity!,
        id,
        b,
        r.headers['x-file-name'],
        r.headers['content-type'],
        r.headers['x-expected-version'],
      );
    }
    @Get('finance/expenses/:id/receipts/:receipt')
    async financeReceipt(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('receipt') receipt: string,
      @Res() res: express.Response,
    ) {
      const f = await finance.file(r.identity!, id, receipt);
      res.setHeader('Content-Type', f.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      );
      res.send(f.content);
    }
    @Delete('finance/expenses/:id/receipts/:receipt')
    financeReceiptDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('receipt') receipt: string,
      @Body() b: unknown,
    ) {
      return finance.removeFile(r.identity!, id, receipt, b);
    }
    @Get('finance/events/:id')
    financeEvents(@Req() r: AuthRequest, @Param('id') id: string) {
      return finance.audit(r.identity!, id);
    }
    @Get('finance/export')
    async financeExport(@Req() r: AuthRequest, @Res() res: express.Response) {
      const csv = await finance.csv(r.identity!, r.query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="studio-expenses.csv"',
      );
      res.send(csv);
    }
    @Get('competitors')
    competitorsList(@Req() r: AuthRequest) {
      return competitors.list(r.identity!);
    }
    @Post('competitors')
    competitorCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return competitors.save(r.identity!, b);
    }
    @Patch('competitors/:id')
    competitorEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return competitors.save(r.identity!, b, id);
    }
    @Delete('competitors/:id')
    competitorDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return competitors.remove(r.identity!, id, b);
    }
    @Post('competitors/:id/files')
    competitorUpload(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return competitors.upload(
        r.identity!,
        id,
        b,
        r.headers['x-file-name'],
        r.headers['content-type'],
        r.headers['x-parent-kind'],
        r.headers['x-parent-id'],
        r.headers['x-expected-version'],
      );
    }
    @Get('competitors/:id/files/:file')
    async competitorFile(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('file') fileId: string,
      @Res() res: express.Response,
    ) {
      const file = await competitors.file(r.identity!, id, fileId);
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.send(file.content);
    }
    @Delete('competitors/:id/files/:file')
    competitorFileDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('file') file: string,
      @Body() b: unknown,
    ) {
      return competitors.removeFile(r.identity!, id, file, b);
    }
    @Post('competitors/:id/:collection')
    competitorChildCreate(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('collection') collection: string,
      @Body() b: unknown,
    ) {
      return competitors.child(r.identity!, id, collection, b);
    }
    @Patch('competitors/:id/:collection/:child')
    competitorChildEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('collection') collection: string,
      @Param('child') child: string,
      @Body() b: unknown,
    ) {
      return competitors.child(r.identity!, id, collection, b, child);
    }
    @Delete('competitors/:id/:collection/:child')
    competitorChildDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('collection') collection: string,
      @Param('child') child: string,
      @Body() b: unknown,
    ) {
      return competitors.remove(r.identity!, id, b, collection, child);
    }
    @Get('templates')
    templatesList(@Req() r: AuthRequest) {
      return templates.list(r.identity!);
    }
    @Get('templates/:id')
    templateDetail(@Req() r: AuthRequest, @Param('id') id: string) {
      return templates.detail(r.identity!, id);
    }
    @Post('templates')
    templateCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return templates.save(r.identity!, b);
    }
    @Patch('templates/:id')
    templateEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return templates.save(r.identity!, b, id);
    }
    @Patch('templates/:id/archive')
    templateArchive(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return templates.archive(r.identity!, id, b);
    }
    @Delete('templates/:id')
    templateRemove(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return templates.remove(r.identity!, id, b);
    }
    @Get('template-plans/:id')
    templatePlan(@Req() r: AuthRequest, @Param('id') id: string) {
      return templates.plan(r.identity!, id);
    }
    @Patch('template-plans/:id')
    templatePlanEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return templates.editPlan(r.identity!, id, b);
    }
    @Post('template-plans')
    templateAssign(@Req() r: AuthRequest, @Body() b: unknown) {
      return templates.assign(r.identity!, b);
    }
    @Delete('templates/:id/tasks/:task')
    templateCancelTask(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('task') task: string,
      @Body() b: unknown,
    ) {
      return templates.cancelTask(r.identity!, id, task, b);
    }
    @Post('templates/:id/assets')
    templateUpload(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return templates.upload(
        r.identity!,
        id,
        b,
        r.headers['x-file-name'],
        r.headers['content-type'],
      );
    }
    @Get('templates/:id/assets/:asset')
    async templateFile(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Res() res: express.Response,
    ) {
      const file = await templates.file(r.identity!, id, asset);
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.send(file.content);
    }
    @Delete('templates/:id/assets/:asset')
    templateFileRemove(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
    ) {
      return templates.removeFile(r.identity!, id, asset);
    }
    @Patch('tasks/:id/publications/:publication')
    publicationEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('publication') publication: string,
      @Body() b: unknown,
    ) {
      return workflow.editPublication(r.identity!, id, publication, b);
    }
    @Get('shooting/assignees')
    shootingAssignees(@Req() r: AuthRequest) {
      return shooting.assignees(r.identity!);
    }
    @Get('shooting/requests')
    shootingList(@Req() r: AuthRequest) {
      return shooting.read(r.identity!);
    }
    @Get('shooting/requests/:id')
    shootingDetail(@Req() r: AuthRequest, @Param('id') id: string) {
      return shooting.detail(r.identity!, id);
    }
    @Get('shooting/requests/:id/history')
    shootingHistory(@Req() r: AuthRequest, @Param('id') id: string) {
      return shooting.history(r.identity!, id, r.query.before);
    }
    @Get('shooting/requests/:id/history/:event')
    shootingEvent(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('event') event: string,
    ) {
      return shooting.event(r.identity!, id, event);
    }
    @Post('shooting/requests')
    shootingCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return shooting.save(r.identity!, b);
    }
    @Patch('shooting/requests/:id')
    shootingEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return shooting.save(r.identity!, b, id);
    }
    @Post('shooting/requests/:id/state')
    shootingState(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return shooting.transition(r.identity!, id, b);
    }
    @Patch('shooting/requests/:id/items/:item')
    shootingProgress(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('item') item: string,
      @Body() b: unknown,
    ) {
      return shooting.item(r.identity!, id, item, b);
    }
    @Post('shooting/requests/:id/archive')
    shootingArchive(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return shooting.archive(r.identity!, id, b);
    }
    @Delete('shooting/requests/:id')
    shootingDelete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return shooting.remove(r.identity!, id, b);
    }
    @Post('shooting/requests/:id/assets')
    shootingDelivery(@Req() r: AuthRequest, @Param('id') id: string) {
      return shooting.upload(
        r.identity!,
        id,
        undefined,
        r.body,
        r.headers['x-file-name'],
        r.headers['content-type'],
        r.headers['x-expected-version'],
        r.headers['x-request-key'],
        r.headers['x-file-note'],
      );
    }
    @Post('shooting/requests/:id/items/:item/assets')
    shootingReference(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('item') item: string,
    ) {
      return shooting.upload(
        r.identity!,
        id,
        item,
        r.body,
        r.headers['x-file-name'],
        r.headers['content-type'],
        r.headers['x-expected-version'],
        r.headers['x-request-key'],
        r.headers['x-file-note'],
      );
    }
    @Get('shooting/requests/:id/assets/:asset')
    async shootingFile(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Res() res: express.Response,
    ) {
      const f = await shooting.file(r.identity!, id, asset);
      res.setHeader('Content-Type', f.mime);
      res.setHeader(
        'Content-Disposition',
        (r.query.download === '1' ? 'attachment' : 'inline') +
          "; filename*=UTF-8''" +
          encodeURIComponent(f.name),
      );
      res.send(f.content);
    }
    @Patch('shooting/requests/:id/assets/:asset')
    shootingFileNote(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Body() b: unknown,
    ) {
      return shooting.fileChange(r.identity!, id, asset, b);
    }
    @Delete('shooting/requests/:id/assets/:asset')
    shootingFileRemove(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('asset') asset: string,
      @Body() b: unknown,
    ) {
      return shooting.fileChange(r.identity!, id, asset, b, true);
    }
    @Get('products')
    productsList(@Req() r: AuthRequest) {
      return products.list(r.identity!);
    }
    @Get('commercial-products/:id')
    commercialProduct(@Req() r:AuthRequest,@Param('id') id:string){return commercialProducts.state(r.identity!,id);}
    @Get('commercial-products/:id/history')
    commercialProductHistory(@Req() r:AuthRequest,@Param('id') id:string){return commercialProducts.history(r.identity!,id,r.query);}
    @Get('commercial-products/:id/receipts/:key')
    commercialProductReceipt(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return commercialProducts.receipt(r.identity!,id,key);}
    @Post('commercial-products/:id/:action')
    commercialProductSave(@Req() r:AuthRequest,@Param('id') id:string,@Param('action') action:string,@Body() b:unknown){return commercialProducts.save(r.identity!,id,action,b);}
    @Get('products/:id')
    productDetail(@Req() r: AuthRequest, @Param('id') id: string) {
      return products.detail(r.identity!, id);
    }
    @Get('products/:id/observations')
    productObservationsList(@Req() r: AuthRequest, @Param('id') id: string) {
      return productObservations.list(r.identity!, id);
    }
    @Post('products/:id/observations')
    productObservationCreate(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return productObservations.save(r.identity!, id, b);
    }
    @Patch('products/:id/observations/:observation')
    productObservationEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('observation') observation: string,
      @Body() b: unknown,
    ) {
      return productObservations.save(r.identity!, id, b, observation);
    }
    @Post('products')
    productCreate(@Req() r: AuthRequest, @Body() b: unknown) {
      return products.save(r.identity!, b);
    }
    @Patch('products/:id')
    productEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return products.save(r.identity!, b, id);
    }
    @Patch('products/:id/stages')
    productStages(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return products.stages(r.identity!, id, b);
    }
    @Post('products/:id/reviews')
    productReview(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return products.review(r.identity!, id, b);
    }
    @Post('products/:id/plans')
    productPlan(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return products.dispatch(r.identity!, id, b);
    }
    @Patch('products/:id/plans/:plan')
    productPlanEdit(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Param('plan') plan: string,
      @Body() b: unknown,
    ) {
      return products.editPlan(r.identity!, id, plan, b);
    }
    @Get('products/:id/image')
    async productImage(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Res() res: express.Response,
    ) {
      const file = await products.image(r.identity!, id);
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.send(file.content);
    }
    @Post('products/:id/image')
    productImageUpload(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return products.upload(
        r.identity!,
        id,
        b,
        r.headers['x-file-name'],
        r.headers['content-type'],
        r.headers['x-expected-version'],
      );
    }
    @Post('tasks/:id/completion')
    actionComplete(
      @Req() r: AuthRequest,
      @Param('id') id: string,
      @Body() b: unknown,
    ) {
      return products.complete(r.identity!, id, b);
    }
    @Get('admin/accounts')
    accounts(@Req() r: AuthRequest) { return accountAccess.list(r.identity!); }
    @Post('admin/accounts')
    accountCreate(@Req() r: AuthRequest,@Body() body: unknown) { return accountLifecycle.save(r.identity!,body); }
    @Post('admin/accounts/:id/password-reset')
    accountPasswordReset(@Req() r: AuthRequest,@Param('id') id:string,@Body() body:unknown) { return accountLifecycle.save(r.identity!,body,id); }
    @Get('admin/account-operations/:key')
    accountOperation(@Req() r: AuthRequest,@Param('key') key:string) { return accountLifecycle.receipt(r.identity!,key); }
    @Patch('admin/accounts/:id/permissions')
    accountPermissionsEdit(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return accountPermissions.update(r.identity!,id,b);}
    @Get('inventory-access')
    inventoryAccessMine(@Req() r:AuthRequest){return inventoryAccess.mine(r.identity!);}
    @Get('admin/accounts/:id/inventory-access')
    inventoryAccessState(@Req() r:AuthRequest,@Param('id') id:string){return inventoryAccess.state(r.identity!,id);}
    @Post('admin/accounts/:id/inventory-access')
    inventoryAccessSave(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return inventoryAccess.save(r.identity!,id,b);}
    @Get('admin/accounts/:id/inventory-access/history')
    inventoryAccessHistory(@Req() r:AuthRequest,@Param('id') id:string){return inventoryAccess.history(r.identity!,id,r.query);}
    @Get('admin/accounts/:id/inventory-access/receipts/:key')
    inventoryAccessReceipt(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return inventoryAccess.receipt(r.identity!,id,key);}
    @Patch('admin/accounts/:id')
    accountEdit(@Req() r: AuthRequest,@Param('id') id: string,@Body() body: unknown) { return accountAccess.update(r.identity!,id,body); }
    @Get('admin/accounts/:id/history')
    accountHistory(@Req() r: AuthRequest,@Param('id') id: string) { return accountAccess.history(r.identity!,id); }
  }

  @Module({ controllers: [InfrastructureController] })
  class StudioModule {}
  const app = await NestFactory.create(StudioModule, {
    logger: false,
    bodyParser: false,
  });
  app.use(requestIdentity);
  app.useGlobalFilters(new SafeExceptionFilter(options.diagnosticSink));
  // Explicit route policy: newly introduced controllers are denied by default.
  app.useGlobalGuards({
    async canActivate(context) {
      const req = context.switchToHttp().getRequest<AuthRequest>();
      if (
        req.method === 'GET' &&
        ['/api/health', '/api/live'].includes(req.path)
      )
        return true;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.headers.origin;
        if (
          req.headers['sec-fetch-site'] === 'cross-site' ||
          (origin && origin !== `${req.protocol}://${req.headers.host}`)
        )
          throw new ForbiddenException('Same-origin request required');
      }
      if (req.method === 'POST' && req.path === '/api/login') return true;
      await auth.authenticate(req);
      if(req.path.startsWith('/api/admin/members')&&req.method!=='GET')requirePermission(req.identity,'personnel');
      if((/^\/api\/admin\/members\/[^/]+\/history$/.test(req.path))||req.path.startsWith('/api/admin/employment-receipts/'))requirePermission(req.identity,'personnel');
      if(req.path.startsWith('/api/admin/members')&&req.method!=='GET'&&req.body&&Object.hasOwn(req.body,'loginAccountId'))requirePermission(req.identity,'account_security');
      if(req.path==='/api/finance'||req.path.startsWith('/api/finance/'))requirePermission(req.identity,'finance');
      if(req.path==='/api/admin/accounts'||req.path.startsWith('/api/admin/accounts/')||req.path.startsWith('/api/admin/account-operations/'))requirePermission(req.identity,'account_security');
      if(req.method==='PATCH'&&/^\/api\/admin\/accounts\/[^/]+\/permissions$/.test(req.path)){auth.csrf(req);return true;}
      if(req.path==='/api/inventory-access'&&req.method==='GET')return true;
      if(/^\/api\/admin\/accounts\/[^/]+\/inventory-access(?:\/history|\/receipts\/[^/]+)?$/.test(req.path)){
        if(req.method==='GET')return true;
        if(req.method==='POST'&&/^\/api\/admin\/accounts\/[^/]+\/inventory-access$/.test(req.path)){auth.csrf(req);return true;}
        throw new ForbiddenException();
      }
      if (
        req.method === 'GET' &&
        ['/api/session', '/api/navigation'].includes(req.path)
      )
        return true;
      if (
        req.method === 'GET' &&
        /^\/api\/sections\/[a-z]+(?:\/[a-z-]+)?$/.test(req.path)
      ) {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ForbiddenException();
        const page = req.params.page;
        if (page !== undefined) {
          if (typeof page !== 'string') throw new ForbiddenException();
          pageFor(req.identity, id, page);
        } else sectionFor(req.identity, id);
        return true;
      }
      if(req.path.startsWith('/api/phone-card-finance/')){
        requirePermission(req.identity,'resources');requirePermission(req.identity,'finance');const route=req.path.slice('/api/phone-card-finance/'.length);
        const allowed=(req.method==='GET'&&/^[^/]+(?:\/(?:balances|recharges(?:\/[^/]+(?:\/history)?)?))?$/.test(route))||(req.method==='POST'&&/^[^/]+\/(?:balances|recharges(?:\/[^/]+(?:\/void)?)?)$/.test(route));
        if(!allowed)throw new ForbiddenException();if(req.method!=='GET')auth.csrf(req);return true;
      }
      if(req.path==='/api/phone-card-reminders'||req.path.startsWith('/api/phone-card-reminders/')){
        requirePermission(req.identity,'resources');const route=req.path.slice('/api/phone-card-reminders'.length),allowed=(req.method==='GET'&&/^(|\/[^/]+(?:\/history)?)$/.test(route))||(req.method==='POST'&&/^\/[^/]+$/.test(route));if(!allowed)throw new ForbiddenException();if(req.method!=='GET')auth.csrf(req);return true;
      }
      if(req.method==='GET'&&/^\/api\/phone-card-operations\/receipts\/[^/]+$/.test(req.path)){requirePermission(req.identity,'resources');return true;}
      if(req.path==='/api/phone-cards'||req.path.startsWith('/api/phone-cards/')){
        requirePermission(req.identity,'resources');
        const route=req.path.slice('/api/phone-cards'.length),allowed=(req.method==='GET'&&/^(|\/options|\/receipts\/[^/]+|\/[^/]+(?:\/(?:history|identity))?)$/.test(route))||(req.method==='POST'&&/^(|\/[^/]+\/identity)$/.test(route))||(req.method==='PATCH'&&/^\/[^/]+$/.test(route));
        if(!allowed)throw new ForbiddenException();if(route.endsWith('/identity'))requirePermission(req.identity,'resource_identity');if(req.method!=='GET')auth.csrf(req);return true;
      }
      if(req.path.startsWith('/api/commercial-products/')){
        requirePermission(req.identity,'resources');
        if(req.method==='GET'&&/^\/api\/commercial-products\/[^/]+(?:\/(?:history|receipts\/[^/]+))?$/.test(req.path))return true;
        if(req.method==='POST'&&/^\/api\/commercial-products\/[^/]+\/(?:formal|sku|mapping)$/.test(req.path)){auth.csrf(req);return true;}
        throw new ForbiddenException();
      }
      if(req.path==='/api/packaging-consumptions'||req.path.startsWith('/api/packaging-consumptions/')){
        requireContributor(req.identity);
        if(req.method==='GET'&&/^\/api\/packaging-consumptions\/[^/]+(?:\/[^/]+)?$/.test(req.path))return true;
        if(req.method==='POST'&&req.path==='/api/packaging-consumptions'){auth.csrf(req);return true;}
        throw new ForbiddenException();
      }
      if(req.path==='/api/packaging-stock'||req.path.startsWith('/api/packaging-stock/')){
        requireContributor(req.identity);
        if(req.method==='GET'&&/^\/api\/packaging-stock(?:\/[^/]+(?:\/receipts\/[^/]+)?)?$/.test(req.path))return true;
        if(req.method==='POST'&&/^\/api\/packaging-stock\/[^/]+$/.test(req.path)){auth.csrf(req);return true;}
        throw new ForbiddenException();
      }
      if(req.path.startsWith('/api/warehouse/')){
        requirePermission(req.identity,'resources');
        if(/^\/api\/warehouse\/items\/[^/]+\/packaging-purchases(?:\/receipts\/[^/]+)?$/.test(req.path)){
          requirePermission(req.identity,'finance');
          if(req.method==='GET')return true;
          if(req.method==='POST'&&req.path.endsWith('/packaging-purchases')){auth.csrf(req);return true;}
          throw new ForbiddenException();
        }
        const route=req.path.slice('/api/warehouse/'.length),allowed=(req.method==='GET' && /^(reorder-alerts|items|items\/[^/]+(?:\/(?:movements(?:\/[^/]+)?|events|transfers|sample-targets|packaging-transfers\/[^/]+))?|receipts\/[^/]+)$/.test(route)) ||
          (req.method==='POST' && /^(items|items\/[^/]+\/(?:movements|to-samples|packaging-balances|packaging-balances\/[^/]+\/reorder-threshold|packaging-transfers))$/.test(route)) || (req.method==='PATCH' && /^items\/[^/]+$/.test(route));
        if(!allowed)throw new ForbiddenException();if(req.method!=='GET')auth.csrf(req);return true;
      }
      if(req.path.startsWith('/api/equipment/')){
        requireContributor(req.identity);
        const route=req.path.slice('/api/equipment/'.length);
        if(/^catalog\/[^/]+\/purchase(?:\/history|\/receipts\/[^/]+)?$/.test(route)){
          requirePermission(req.identity,'finance');
          if(req.method==='GET')return true;
          if(req.method==='POST'&&/^catalog\/[^/]+\/purchase$/.test(route)){requirePermission(req.identity,'resources');auth.csrf(req);return true;}
          throw new ForbiddenException();
        }
        const allowed=(req.method==='GET' && /^(catalog|catalog\/[^/]+(?:\/(?:history|handover|handovers|images\/[^/]+))?|loans(?:\/[^/]+)?|receipts\/[^/]+)$/.test(route)) ||
          (req.method==='POST' && /^(catalog|catalog\/[^/]+\/(?:borrow|state|handover|image)|loans\/[^/]+\/return)$/.test(route)) ||
          (req.method==='DELETE' && /^catalog\/[^/]+\/image$/.test(route)) ||
          (req.method==='PATCH' && /^(catalog\/[^/]+|loans\/[^/]+\/location)$/.test(route));
        if(!allowed)throw new ForbiddenException();
        if(/\/(?:handover|handovers|image)$/.test(route))requirePermission(req.identity,'resources');
        if((req.method==='POST' && (route==='catalog'||route.endsWith('/state')))||(req.method==='PATCH' && /^catalog\/[^/]+$/.test(route))||route.endsWith('/history'))requirePermission(req.identity,'resources');
        if(req.method!=='GET')auth.csrf(req);
        return true;
      }
      if (req.path.startsWith('/api/samples/')) {
        requireContributor(req.identity);
        const route = req.path.slice('/api/samples/'.length);
        const allowed = (req.method === 'GET' && /^(state|catalog|loans|receipts\/[^/]+|(?:(?:catalog|loans)\/[^/]+\/history|catalog\/[^/]+\/transfers))$/.test(route)) ||
          (req.method === 'POST' && /^(catalog|catalog\/[^/]+\/(?:stock-in|stocktake|borrow)|loans\/[^/]+\/return)$/.test(route)) ||
          (req.method === 'PATCH' && /^(catalog\/[^/]+|loans\/[^/]+\/location)$/.test(route));
        if (!allowed) throw new ForbiddenException();
        if (/^catalog\/[^/]+\/transfers$/.test(route) || (req.method !== 'GET' && route === 'catalog') || (req.method === 'PATCH' && /^catalog\/[^/]+$/.test(route)) || /\/(stock-in|stocktake)$/.test(route) || /^catalog\/[^/]+\/history$/.test(route)) requirePermission(req.identity,'resources');
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if((req.method==='POST'&&/^\/api\/admin\/members\/[^/]+\/employment$/.test(req.path))||(req.method==='GET'&&/^\/api\/admin\/(members\/[^/]+\/history|employment-receipts\/[^/]+)$/.test(req.path))){requireAdministrator(req.identity);if(req.method!=='GET')auth.csrf(req);return true;}
      if(req.path.startsWith('/api/payroll/')){
        requirePermission(req.identity,'payroll');const route=req.path.slice('/api/payroll/'.length);if(!((req.method==='GET'&&/^(state|salaries|drafts|admin-reviews|admin-review-receipts\/[^/]+|confirmations(?:\/[^/]+)?|exportable|exports(?:\/[^/]+)?|(?:receipts|confirmation-receipts|export-receipts)\/[^/]+)$/.test(route))||(req.method==='POST'&&/^(salaries|drafts|admin-reviews|confirmations|exports)$/.test(route))))throw new ForbiddenException();if(req.method!=='GET')auth.csrf(req);return true;
      }
      if(req.method!=='GET'&&(/^\/api\/admin\/(stores|business-accounts)(?:\/[^/]+)?$/.test(req.path)||/^\/api\/admin\/material-folders\/[^/]+\/order$/.test(req.path)))requirePermission(req.identity,'resources');
      if (req.path.startsWith('/api/attendance/')) {
        requireContributor(req.identity);
        const route = req.path.slice('/api/attendance/'.length);
        const allowed = (req.method === 'GET' && /^(daily|state|(?:receipts|leave-receipts)\/[^/]+|leaves|periods|corrections|(?:leaves|periods|corrections)\/[^/]+(?:\/history)?)$/.test(route)) ||
          (req.method === 'POST' && /^(leaves(?:\/[^/]+\/(?:decision|withdraw|revoke))?|end-work|studio\/in|field|periods\/[^/]+\/(?:in|out|decision)|corrections(?:\/[^/]+\/decision)?)$/.test(route)) ||
          (req.method === 'PATCH' && /^(?:leaves|corrections)\/[^/]+$/.test(route));
        const exceptionRead=req.method==='GET'&&/^(exceptions|exception-receipts\/[^/]+|periods\/[^/]+\/exceptions(?:\/history)?)$/.test(route),exceptionWrite=req.method==='POST'&&/^periods\/[^/]+\/exceptions$/.test(route);
        const calendarRead=req.method==='GET'&&/^(monthly|calendar|calendar-receipts\/[^/]+|calendar\/[^/]+\/history)$/.test(route),calendarWrite=req.method==='POST'&&/^calendar\/[^/]+$/.test(route);
        const closureRead=req.method==='GET'&&/^(month-closures(?:\/[^/]+)?|month-closure-receipts\/[^/]+)$/.test(route),closureWrite=req.method==='POST'&&route==='month-closures';
        if(closureWrite)requirePermission(req.identity,'personnel');
        if(calendarWrite)requirePermission(req.identity,'personnel');
        if (!allowed&&!exceptionRead&&!exceptionWrite&&!calendarRead&&!calendarWrite&&!closureRead&&!closureWrite) throw new ForbiddenException();
        if(exceptionWrite)requirePermission(req.identity,'personnel');
        if (route.endsWith('/decision')) requirePermission(req.identity,'personnel');
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (req.path.startsWith('/api/research/')) {
        const route = req.path.slice('/api/research/'.length);
        const allowed =
          (req.method === 'GET' &&
            /^(dimensions|inspirations(?:\/catalog)?|candidates(?:\/[^/]+)?|materials\/[^/]+\/elements)$/.test(
              route,
            )) ||
          (req.method === 'POST' &&
            /^(dimensions|inspirations|candidates|duplicates|materials\/[^/]+\/elements|candidates\/[^/]+\/(preview|dispatch))$/.test(
              route,
            )) ||
          (req.method === 'PATCH' &&
            /^(dimensions\/[^/]+|inspirations\/[^/]+|candidates\/[^/]+|materials\/[^/]+\/elements\/[^/]+)$/.test(
              route,
            ));
        if (!allowed) throw new ForbiddenException();
        requireContributor(req.identity);
        if (
          (route.startsWith('dimensions') && req.method !== 'GET') ||
          (/^candidates\/[^/]+(?:\/(preview|dispatch))?$/.test(route) &&
            req.method !== 'GET')
        )
          requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        (req.method === 'GET' && /^\/api\/admin\/business-accounts\/[^/]+\/history$/.test(req.path)) ||
        (['GET', 'POST'].includes(req.method) &&
          [
            '/api/admin/stores',
            '/api/admin/members',
            '/api/admin/business-accounts',
          ].includes(req.path)) ||
        (req.method === 'PATCH' &&
          /^\/api\/admin\/(?:stores|members|business-accounts)\/[^/]+$/.test(
            req.path,
          ))
      ) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        req.method === 'GET' &&
        /^\/api\/lab\/experiments\/[^/]+\/activity$/.test(req.path)
      ) {
        requireAdministrator(req.identity);
        return true;
      }
      if (
        req.method === 'GET' &&
        /^\/api\/lab\/experiments(?:\/[^/]+)?$/.test(req.path)
      )
        return true;
      if ((req.method === 'POST' && (req.path === '/api/lab/experiments' || /^\/api\/lab\/experiments\/[^/]+\/rounds\/[^/]+\/assignments$/.test(req.path))) ||
          (req.method === 'GET' && /^\/api\/lab\/experiments\/[^/]+\/rounds\/[^/]+\/assignments\/[^/]+$/.test(req.path))) {
        requireAdministrator(req.identity);
        if(req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        (req.method === 'PATCH' &&
          /^\/api\/lab\/experiments\/[^/]+\/(?:priority|product)$/.test(
            req.path,
          )) ||
        (req.method === 'POST' &&
          /^\/api\/lab\/experiments\/[^/]+\/(?:rounds(?:\/[^/]+\/reviews)?|conclusion)$/.test(
            req.path,
          ))
      ) {
        requireAdministrator(req.identity);
        auth.csrf(req);
        return true;
      }
      if (
        (req.path === '/api/admin/material-folders' && req.method === 'GET') ||
        (req.method === 'PATCH' &&
          /^\/api\/admin\/material-folders\/[^/]+\/order$/.test(req.path))
      ) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        req.method === 'PATCH' &&
        /^\/api\/materials\/[^/]+\/stores$/.test(req.path)
      ) {
        auth.csrf(req);
        return true;
      }
      if (req.path === '/api/material-store-options' && req.method === 'GET')
        return true;
      if (
        /^\/api\/materials\/[^/]+\/assets\/[^/]+\/downloads(?:\/[^/]+)?$/.test(
          req.path,
        )
      ) {
        if (req.method !== 'POST') throw new ForbiddenException();
        auth.csrf(req);
        return true;
      }
      if (
        /^\/api\/materials(?:\/[^/]+(?:\/assets(?:\/[^/]+)?)?)?$/.test(req.path)
      ) {
        const root = req.path === '/api/materials';
        const item = /^\/api\/materials\/[^/]+$/.test(req.path);
        const upload = /^\/api\/materials\/[^/]+\/assets$/.test(req.path);
        const asset = /^\/api\/materials\/[^/]+\/assets\/[^/]+$/.test(req.path);
        if (!(
          (root && ['GET', 'POST'].includes(req.method)) ||
          (item && ['GET', 'PATCH', 'DELETE'].includes(req.method)) ||
          (upload && req.method === 'POST') ||
          (asset && ['GET', 'DELETE'].includes(req.method))
        ))
          throw new ForbiddenException();
        if (item && req.method === 'DELETE') requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        /^\/api\/admin\/materials\/[^/]+(?:\/assets(?:\/[^/]+)?)?$/.test(
          req.path,
        )
      ) {
        requireAdministrator(req.identity);
        const detail = /^\/api\/admin\/materials\/[^/]+$/.test(req.path);
        const upload = /^\/api\/admin\/materials\/[^/]+\/assets$/.test(
          req.path,
        );
        const asset = /^\/api\/admin\/materials\/[^/]+\/assets\/[^/]+$/.test(
          req.path,
        );
        if (!(
          (detail && ['GET', 'PATCH', 'DELETE'].includes(req.method)) ||
          (upload && req.method === 'POST') ||
          (asset && ['GET', 'DELETE'].includes(req.method))
        ))
          throw new ForbiddenException();
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        (['GET', 'POST'].includes(req.method) &&
          ['/api/admin/materials', '/api/admin/plans'].includes(req.path)) ||
        (req.method === 'PATCH' &&
          /^\/api\/admin\/plans\/[^/]+\/conclusion$/.test(req.path))
      ) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        (req.method === 'GET' && /^\/api\/tasks(?:\/[^/]+)?$/.test(req.path)) ||
        (req.method === 'POST' &&
          /^\/api\/tasks\/[^/]+\/publications(?:\/[^/]+\/snapshots)?$/.test(
            req.path,
          ))
      ) {
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        req.method === 'GET' &&
        /^\/api\/tasks\/[^/]+\/materials\/[^/]+\/assets\/[^/]+$/.test(req.path)
      )
        return true;
      if (
        (req.method === 'POST' &&
          /^\/api\/tasks\/[^/]+\/publications\/[^/]+\/assets$/.test(
            req.path,
          )) ||
        (['GET', 'DELETE'].includes(req.method) &&
          /^\/api\/tasks\/[^/]+\/publications\/[^/]+\/assets\/[^/]+$/.test(
            req.path,
          ))
      ) {
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        req.method === 'POST' &&
        /^\/api\/lab\/experiments\/[^/]+\/rounds\/[^/]+\/(?:import-preview|imports)$/.test(
          req.path,
        )
      ) {
        auth.csrf(req);
        return true;
      }
      if (
        req.path === '/api/shooting' ||
        req.path.startsWith('/api/shooting/')
      ) {
        await shooting.authorize(req.identity!);
        const read =
          req.method === 'GET' &&
          /^\/api\/shooting\/(?:assignees|requests(?:\/[^/]+(?:\/(?:history(?:\/[^/]+)?|assets\/[^/]+))?)?)$/.test(
            req.path,
          );
        const post =
          req.method === 'POST' &&
          /^\/api\/shooting\/requests(?:\/[^/]+\/(?:state|archive|assets|items\/[^/]+\/assets))?$/.test(
            req.path,
          );
        const patch =
          req.method === 'PATCH' &&
          /^\/api\/shooting\/requests\/[^/]+(?:\/(?:items|assets)\/[^/]+)?$/.test(
            req.path,
          );
        const remove =
          req.method === 'DELETE' &&
          /^\/api\/shooting\/requests\/[^/]+(?:\/assets\/[^/]+)?$/.test(
            req.path,
          );
        if (!(read || post || patch || remove)) throw new ForbiddenException();
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (/^\/api\/products\/[^/]+\/observations(?:\/[^/]+)?$/.test(req.path)) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        req.method === 'GET' &&
        /^\/api\/products(?:\/[^/]+(?:\/image)?)?$/.test(req.path)
      )
        return true;
      if (
        (req.method === 'POST' &&
          /^\/api\/products(?:\/[^/]+\/(?:plans|reviews|image))?$/.test(
            req.path,
          )) ||
        (req.method === 'PATCH' &&
          /^\/api\/products\/[^/]+(?:\/stages|\/plans\/[^/]+)?$/.test(req.path))
      ) {
        requireAdministrator(req.identity);
        auth.csrf(req);
        return true;
      }
      if (
        req.method === 'POST' &&
        /^\/api\/tasks\/[^/]+\/completion$/.test(req.path)
      ) {
        auth.csrf(req);
        return true;
      }
      if (
        (req.method === 'GET' &&
          /^\/api\/workbench\/observations(?:\/(?:authors|replays\/[^/]+|[^/]+(?:\/history|\/attachments\/[^/]+)?))?$/.test(
            req.path,
          )) ||
        (req.method === 'POST' && req.path === '/api/workbench/observations') ||
        (req.method === 'PATCH' &&
          /^\/api\/workbench\/observations\/[^/]+$/.test(req.path))
      ) {
        requireContributor(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        /^\/api\/workbench\/todos(?:\/[^/]+)?$/.test(req.path) &&
        ['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)
      ) {
        requireContributor(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        req.method === 'GET' &&
        [
          '/api/workbench/profile',
          '/api/workbench/capabilities',
          '/api/workbench/material-refills',
          '/api/workbench/refills',
          '/api/workbench/completed',
          '/api/workbench/activity',
        ].includes(req.path)
      )
        return true;
      if (
        /^\/api\/titles(?:\/[^/]+(?:\/(?:copies|entries(?:\/[^/]+)?))?)?$/.test(
          req.path,
        )
      ) {
        if (
          req.method === 'GET' ||
          (req.method === 'POST' &&
            /^\/api\/titles\/[^/]+\/copies$/.test(req.path))
        )
          requireContributor(req.identity);
        else requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if ((req.method === 'POST' && req.path === '/api/knowledge/navigation') ||
          (req.method === 'PATCH' && /^\/api\/knowledge\/[^/]+\/navigation$/.test(req.path))) {
        requireAdministrator(req.identity);
        auth.csrf(req);
        return true;
      }
      if (
        req.method === 'GET' &&
        (req.path === '/api/toolbox' ||
          req.path === '/api/knowledge' ||
          /^\/api\/knowledge\/[^/]+\/cover$/.test(req.path))
      ) {
        requireContributor(req.identity);
        return true;
      }
      if (
        (['GET', 'POST'].includes(req.method) && req.path === '/api/toolbox') ||
        (['PATCH', 'DELETE'].includes(req.method) &&
          /^\/api\/toolbox\/[^/]+$/.test(req.path))
      ) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        (req.method === 'GET' &&
          (req.path === '/api/knowledge' ||
            req.path === '/api/knowledge/conclusion-sources' ||
            /^\/api\/knowledge\/[^/]+\/cover$/.test(req.path))) ||
        (req.method === 'POST' &&
          (req.path === '/api/knowledge' ||
            /^\/api\/knowledge\/[^/]+\/cover$/.test(req.path))) ||
        (['PATCH', 'DELETE'].includes(req.method) &&
          /^\/api\/knowledge\/[^/]+$/.test(req.path)) ||
        (req.method === 'DELETE' &&
          /^\/api\/knowledge\/[^/]+\/cover$/.test(req.path))
      ) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (
        req.method === 'GET' &&
        /^\/api\/templates(?:\/[^/]+(?:\/assets\/[^/]+)?)?$/.test(req.path)
      )
        return true;
      if (
        (req.method === 'PATCH' &&
          /^\/api\/template-plans\/[^/]+$/.test(req.path)) ||
        (req.method === 'POST' &&
          (req.path === '/api/templates' ||
            req.path === '/api/template-plans' ||
            /^\/api\/templates\/[^/]+\/assets$/.test(req.path))) ||
        (req.method === 'PATCH' &&
          /^\/api\/templates\/[^/]+(?:\/archive)?$/.test(req.path)) ||
        (req.method === 'DELETE' &&
          /^\/api\/templates\/[^/]+(?:\/(?:assets|tasks)\/[^/]+)?$/.test(
            req.path,
          ))
      ) {
        requireAdministrator(req.identity);
        auth.csrf(req);
        return true;
      }
      if (
        req.method === 'PATCH' &&
        /^\/api\/tasks\/[^/]+\/publications\/[^/]+$/.test(req.path)
      ) {
        auth.csrf(req);
        return true;
      }
      if (
        req.method === 'GET' &&
        /^\/api\/template-plans\/[^/]+$/.test(req.path)
      )
        return true;
      if (
        req.method === 'GET' &&
        /^\/api\/announcements(?:\/[^/]+)?$/.test(req.path)
      )
        return true;
      if (
        (req.method === 'POST' && req.path === '/api/announcements') ||
        (['PATCH', 'DELETE'].includes(req.method) &&
          /^\/api\/announcements\/[^/]+$/.test(req.path))
      ) {
        requireAdministrator(req.identity);
        auth.csrf(req);
        return true;
      }
      if (req.method === 'POST' && req.path === '/api/logout') {
        auth.csrf(req);
        return true;
      }
      if ((req.method === 'POST' && (req.path === '/api/admin/accounts' || /^\/api\/admin\/accounts\/[^/]+\/password-reset$/.test(req.path))) || (req.method === 'GET' && /^\/api\/admin\/account-operations\/[^/]+$/.test(req.path))) {
        requireAdministrator(req.identity);if(req.method !== 'GET') auth.csrf(req);return true;
      }
      if ((req.method === 'PATCH' && /^\/api\/admin\/accounts\/[^/]+$/.test(req.path)) ||
          (req.method === 'GET' && /^\/api\/admin\/accounts\/[^/]+\/history$/.test(req.path))) {
        requireAdministrator(req.identity);
        if(req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (req.method === 'GET' && req.path === '/api/admin/accounts') {
        requireAdministrator(req.identity);
        return true;
      }
      if (
        req.path === '/api/competitors' ||
        req.path.startsWith('/api/competitors/')
      ) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      if (req.path === '/api/finance' || req.path.startsWith('/api/finance/')) {
        requireAdministrator(req.identity);
        if (req.method !== 'GET') auth.csrf(req);
        return true;
      }
      throw new ForbiddenException();
    },
  });
  app.use(
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
      );
      next();
    },
  );
  // Bounded binary body only for private material uploads; ordinary JSON remains 16kb.
  app.use(
    '/api/finance/expenses/:id/receipts',
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      limit: 10485760,
    }),
  );
  app.use(
    [
      '/api/admin/materials/:id/assets',
      '/api/materials/:id/assets',
      '/api/tasks/:id/publications/:publicationId/assets',
      '/api/products/:id/image',
      '/api/equipment/catalog/:id/image',
      '/api/knowledge/:id/cover',
      '/api/templates/:id/assets',
      '/api/shooting/requests/:id/assets',
      '/api/shooting/requests/:id/items/:item/assets',
      '/api/competitors/:id/files',
    ],
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4'],
      limit: '8mb',
    }),
  );
  app.use(
    [
      '/api/lab/experiments/:id/rounds/:round/import-preview',
      '/api/lab/experiments/:id/rounds/:round/imports',
    ],
    express.json({ limit: '256kb', strict: true }),
  );
  app.use(
    '/api/products/:id/plans',
    express.json({ limit: '2mb', strict: true }),
  );
  app.use(
    ['/api/admin/plans', '/api/lab/experiments/:id/rounds'],
    express.json({ limit: '128kb', strict: true }),
  );
  app.use('/api/research', express.json({ limit: '128kb', strict: true }));
  app.use('/api/titles', express.json({ limit: '2mb', strict: true }));
  app.use('/api/knowledge', express.json({ limit: '128kb', strict: true }));
  app.use('/api/competitors', express.json({ limit: '64kb', strict: true }));
  app.use('/api/finance', express.json({ limit: '128kb', strict: true }));
  app.use('/api/template-plans', express.json({ limit: '1mb', strict: true }));
  app.use(
    '/api/shooting/requests',
    express.json({ limit: '128kb', strict: true }),
  );
  app.use(
    '/api/workbench/observations',
    express.json({ limit: '24mb', strict: true }),
  );
  app.use(express.json({ limit: '16kb', strict: true }));

  // Express static rejects dotfiles and traversal. No catch-all API or asset fallback.
  app.use(
    express.static(webRoot, {
      dotfiles: 'deny',
      fallthrough: true,
      redirect: false,
      etag: false,
    }),
  );
  await app.init();
  return app;
}
