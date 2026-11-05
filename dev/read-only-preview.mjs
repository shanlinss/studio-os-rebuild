import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ...['operational-changes.mjs', 'access-session.mjs', 'resource-profiles.mjs', 'finance-month-closures-contract.mjs', 'finance-month-closures-view.mjs', 'finance-month-closures-editors.mjs', 'finance-month-review-contract.mjs', 'finance-month-review-view.mjs', 'finance-month-review-editors.mjs', 'product-stock-corrections-contract.mjs', 'product-stock-corrections-editors.mjs', 'product-stock-corrections-view.mjs', 'cash-correspondence-contract.mjs', 'cash-correspondence-editors.mjs', 'cash-correspondence-view.mjs', 'sample-cost-contract.mjs', 'sample-cost-editors.mjs', 'sample-cost-view.mjs', 'inventory-cost-contract.mjs', 'inventory-cost-editors.mjs', 'inventory-cost-view.mjs', 'operating-overview-contract.mjs', 'operating-overview-editors.mjs', 'operating-overview-view.mjs', 'expense-attribution-view.mjs', 'expense-attribution-model.mjs', 'expense-attribution-editors.mjs', 'operating-finance-contract.mjs', 'operating-finance-editors.mjs', 'operating-finance-view.mjs', 'cost-sources-contract.mjs', 'cost-sources-editors.mjs', 'cost-sources-view.mjs', 'product-opening-contract.mjs', 'product-opening-view.mjs', 'product-opening-editors.mjs', 'product-cost-contract.mjs', 'product-cost-view.mjs', 'product-purchase-contract.mjs', 'product-purchase-editors.mjs', 'product-purchase-view.mjs', 'product-stock-contract.mjs', 'product-stock-editors.mjs', 'commercial-products-contract.mjs', 'commercial-products-editors.mjs', 'commercial-products-view.mjs', 'bootstrap.mjs', 'navigation.mjs', 'cloud-view.mjs', 'cloud-api.mjs', 'daily-layout.mjs', 'daily-attendance.mjs', 'attendance-contract.mjs', 'attendance-editors.mjs', 'attendance-view.mjs', 'leave-contract.mjs', 'leave-editors.mjs', 'leave-view.mjs', 'payroll-confirmation-contract.mjs', 'payroll-confirmation-editors.mjs', 'payroll-confirmation-view.mjs', 'personnel-contract.mjs', 'personnel-editors.mjs', 'personnel-view.mjs', 'payroll-contract.mjs', 'payroll-editors.mjs', 'payroll-view.mjs', 'closure-contract.mjs', 'closure-editors.mjs', 'closure-view.mjs', 'monthly-contract.mjs', 'monthly-editors.mjs', 'monthly-view.mjs', 'exception-contract.mjs', 'exception-editors.mjs', 'exception-view.mjs', 'cloud-contract.mjs', 'business-model.mjs', 'business-view.mjs', 'resource-model.mjs', 'resource-view.mjs', 'knowledge-navigation.mjs', 'sample-workspace.mjs', 'sample-contract.mjs', 'equipment-contract.mjs', 'phone-cards-contract.mjs', 'phone-card-finance-contract.mjs', 'phone-card-finance-editors.mjs', 'phone-card-finance-workspace.mjs', 'phone-cards-editors.mjs', 'phone-cards-workspace.mjs', 'equipment-assets-contract.mjs', 'equipment-assets-editors.mjs', 'equipment-purchase-contract.mjs', 'equipment-purchase-editors.mjs', 'equipment-workspace.mjs', 'warehouse-contract.mjs', 'warehouse-view.mjs', 'warehouse-editors.mjs', 'warehouse-transfer-editors.mjs', 'management-model.mjs', 'management-view.mjs', 'creation-model.mjs', 'planning-view.mjs', 'write-contract.mjs', 'mutation-gateway.mjs', 'record-editors.mjs', 'admin-permissions.mjs', 'inventory-access-contract.mjs', 'inventory-access-editors.mjs', 'account-lifecycle-contract.mjs', 'account-lifecycle-editors.mjs', 'operations-editors.mjs', 'workbench-model.mjs', 'page-access.mjs', 'attachments.mjs', 'media-contract.mjs', 'shooting-contract.mjs', 'shooting-editors.mjs'].map(name => ['/'+name, [name, 'text/javascript; charset=utf-8']]),
]);
const fixedRoutes = new Set(['/api/product-stock','/api/warehouse/reorder-alerts','/api/inventory-access','/api/packaging-stock','/api/phone-card-reminders','/api/phone-cards','/api/phone-cards/options','/api/live','/api/health','/api/session','/api/navigation','/api/materials','/api/lab/experiments','/api/tasks','/api/workbench/todos','/api/workbench/profile','/api/workbench/completed','/api/products','/api/shooting/requests','/api/shooting/assignees','/api/templates','/api/titles/catalog','/api/toolbox','/api/knowledge','/api/admin/members','/api/admin/business-accounts','/api/admin/stores','/api/admin/accounts','/api/finance','/api/competitors','/api/samples/catalog','/api/samples/state','/api/warehouse/items','/api/equipment/catalog','/api/equipment/loans','/api/samples/loans','/api/payroll/admin-reviews','/api/payroll/confirmations','/api/payroll/exportable','/api/payroll/state','/api/payroll/salaries','/api/payroll/drafts','/api/attendance/month-closures','/api/attendance/month-closures/history','/api/attendance/monthly','/api/attendance/calendar','/api/attendance/daily','/api/attendance/exceptions','/api/attendance/leaves','/api/attendance/corrections','/api/attendance/periods']);
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const cardFinanceRoute=new RegExp(`^/api/phone-card-finance/${uuid}(?:/(?:balances|recharges(?:/${uuid}(?:/history)?)?))?$`);
const cardReminderRoute=new RegExp(`^/api/phone-card-reminders/${uuid}(?:/history)?$`);
const phoneCardRoute=new RegExp(`^/api/phone-cards/${uuid}(?:/(?:history|identity))?$`);
const businessAccountHistoryRoute=new RegExp(`^/api/admin/business-accounts/${uuid}/history$`);
const memberHistoryRoute=new RegExp(`^/api/admin/members/${uuid}/history$`);
const payrollConfirmationRoute=new RegExp(`^/api/payroll/confirmations/${uuid}$`);
const closureDetailRoute=new RegExp(`^/api/attendance/month-closures/${uuid}$`);
const calendarHistoryRoute=/^\/api\/attendance\/calendar\/\d{4}-\d{2}-\d{2}\/history$/;
const exceptionDetailRoute=new RegExp(`^/api/attendance/periods/${uuid}/exceptions(?:/history)?$`);
const attendanceDetailRoute=new RegExp(`^/api/attendance/(?:leaves|periods|corrections)/${uuid}(?:/history)?$`);
const detailRoute = new RegExp(`^/api/(materials|lab/experiments|tasks|products|shooting/requests|templates|titles)/${uuid}$`);
const equipmentImageRoute=new RegExp(`^/api/equipment/catalog/${uuid}/images/${uuid}$`);
const expenseMediaRoute=new RegExp(`^/api/finance/expenses/${uuid}/receipts/${uuid}$`);
const operationalRoute=new RegExp(`^/api/operational-changes/(?:material-archive|task-schedule)/${uuid}$`);
const resourceProfileRoute=new RegExp(`^/api/resource-profiles/(?:equipment-store|card-plan)/${uuid}$`);
const financeClosingRoute=new RegExp(`^/api/finance/month-closures(?:/${uuid})?$`);
const monthReviewRoute=/^\/api\/finance\/(?:month-review|month-scope)$/;
const cashRoute=new RegExp(`^/api/finance/(?:cash-sources|cash-movements(?:/${uuid})?)$`);
const sampleCostRoute=new RegExp(`^/api/finance/sample-costs(?:/${uuid})?$`);
const inventoryCostRoute=new RegExp(`^/api/finance/inventory-costs(?:/${uuid})?$`);
const overviewRoute=/^\/api\/finance\/overview$/;
const monthIncomeRoute=new RegExp(`^/api/finance/month-income/${uuid}$`);
const operatingFinanceRoute=new RegExp(`^/api/finance/operating-records(?:/${uuid})?$`);
const referenceCostRoute=new RegExp(`^/api/product-reference-costs/${uuid}$`);
const dropshipCostRoute=new RegExp(`^/api/dropship-costs(?:/(?:options|${uuid}))?$`);
const openingCostRoute=new RegExp(`^/api/product-opening-costs/${uuid}(?:/history)?$`);
const productCostRoute=new RegExp(`^/api/product-costs(?:/${uuid})?$`);
const productPurchaseRoute=new RegExp(`^/api/product-purchases/${uuid}(?:/history)?$`);
const stockCorrectionRoute=new RegExp(`^/api/product-stock-documents/${uuid}/corrections$`);
const productStockRoute=new RegExp(`^/api/(?:product-stock|product-stock-documents)/${uuid}$`);
const commercialRoute=new RegExp(`^/api/commercial-products/${uuid}(?:/history)?$`);
const consumptionRoute=new RegExp(`^/api/packaging-consumptions/${uuid}$`);
const scopedWarehouseRoute=new RegExp(`^/api/packaging-stock/${uuid}$`);
const warehouseDetailRoute=new RegExp(`^/api/warehouse/items/${uuid}(?:/(?:movements(?:/${uuid})?|events|transfers|sample-targets|packaging-purchases|(?:packaging-transfers|product-transfers)/${uuid}))?$`);
const sampleTransferRoute=new RegExp(`^/api/samples/catalog/${uuid}/transfers$`);
const equipmentPurchaseRoute=new RegExp(`^/api/equipment/catalog/${uuid}/purchase(?:/history)?$`);
const equipmentDetailRoute=new RegExp(`^/api/equipment/(?:catalog/${uuid}(?:/(?:history|handover|handovers))?|loans/${uuid})$`);
const inventoryAccessRoute=new RegExp(`^/api/admin/accounts/${uuid}/inventory-access(?:/history)?$`);
const accountHistoryRoute=new RegExp(`^/api/admin/accounts/${uuid}/history$`);
const financeEventRoute=new RegExp(`^/api/finance/events/${uuid}$`);
const mediaRoute=new RegExp(`^/api/(?:equipment/catalog/${uuid}/images/${uuid}|materials/${uuid}/assets/${uuid}|shooting/requests/${uuid}/assets/${uuid}|tasks/${uuid}/publications/${uuid}/assets/${uuid}|finance/expenses/${uuid}/receipts/${uuid})$`);
const mediaTypes=new Set(['image/png','image/jpeg','image/gif','image/webp','video/mp4']);
const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));

export function createPreviewServer({ root = defaultRoot, upstreamPort = 13102, forwardSession = true } = {}) {
  const server = http.createServer(async (req, res) => {
    const finish = (status, data, type='application/json; charset=utf-8') => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));
    };
    const address=server.address();
    const expectedHost=address&&typeof address!=='string'&&address.address==='::1'?`[::1]:${address.port}`:address&&typeof address!=='string'&&address.address==='127.0.0.1'?`127.0.0.1:${address.port}`:null;
    if (!expectedHost || req.headers.host !== expectedHost) { finish(403,{message:'Local preview host required'});return; }
    if(req.method!=='GET'){finish(405,{message:'This preview is read-only'});req.resume();return;}
    if(!req.url?.startsWith('/')||req.url.startsWith('//')){finish(400,{message:'Invalid path'});return;}
    let url;
    try{url=new URL(req.url,'http://'+req.headers.host);}catch{finish(400,{message:'Invalid path'});return;}
    if(url.pathname.startsWith('/api/')){
      const expected='http://'+req.headers.host;
      if ((req.headers.origin && req.headers.origin!==expected) || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) {finish(403,{message:'Same-origin request required'});return;}
      if(!fixedRoutes.has(url.pathname)&&!detailRoute.test(url.pathname)&&!attendanceDetailRoute.test(url.pathname)&&!exceptionDetailRoute.test(url.pathname)&&!calendarHistoryRoute.test(url.pathname)&&!closureDetailRoute.test(url.pathname)&&!payrollConfirmationRoute.test(url.pathname)&&!memberHistoryRoute.test(url.pathname)&&!businessAccountHistoryRoute.test(url.pathname)&&!phoneCardRoute.test(url.pathname)&&!cardFinanceRoute.test(url.pathname)&&!cardReminderRoute.test(url.pathname)&&!mediaRoute.test(url.pathname)&&!financeEventRoute.test(url.pathname)&&!accountHistoryRoute.test(url.pathname)&&!inventoryAccessRoute.test(url.pathname)&&!equipmentDetailRoute.test(url.pathname)&&!equipmentPurchaseRoute.test(url.pathname)&&!warehouseDetailRoute.test(url.pathname)&&!scopedWarehouseRoute.test(url.pathname)&&!consumptionRoute.test(url.pathname)&&!commercialRoute.test(url.pathname)&&!stockCorrectionRoute.test(url.pathname)&&!productStockRoute.test(url.pathname)&&!operationalRoute.test(url.pathname)&&!resourceProfileRoute.test(url.pathname)&&!financeClosingRoute.test(url.pathname)&&!monthReviewRoute.test(url.pathname)&&!cashRoute.test(url.pathname)&&!sampleCostRoute.test(url.pathname)&&!inventoryCostRoute.test(url.pathname)&&!overviewRoute.test(url.pathname)&&!monthIncomeRoute.test(url.pathname)&&!operatingFinanceRoute.test(url.pathname)&&!referenceCostRoute.test(url.pathname)&&!dropshipCostRoute.test(url.pathname)&&!openingCostRoute.test(url.pathname)&&!productCostRoute.test(url.pathname)&&!productPurchaseRoute.test(url.pathname)&&!sampleTransferRoute.test(url.pathname)){finish(404,{message:'Read route unavailable'});return;}
      const allowedQuery=operationalRoute.test(url.pathname)?['offset']:resourceProfileRoute.test(url.pathname)?['offset']:financeClosingRoute.test(url.pathname)?(url.pathname.endsWith('/month-closures')?['month','offset']:[]):monthReviewRoute.test(url.pathname)?(url.pathname.endsWith('/month-review')?['month','section','severity','offset']:['month','offset']):stockCorrectionRoute.test(url.pathname)?['offset']:cashRoute.test(url.pathname)?(url.pathname.endsWith('/cash-sources')?['month','kind','q','offset']:url.pathname.endsWith('/cash-movements')?['month','direction','status','q','offset']:['offset']):sampleCostRoute.test(url.pathname)?(url.pathname==='/api/finance/sample-costs'?['month','q','offset']:['offset']):inventoryCostRoute.test(url.pathname)?(url.pathname==='/api/finance/inventory-costs'?['month','kind','mode','q','offset']:['offset']):overviewRoute.test(url.pathname)?['month']:monthIncomeRoute.test(url.pathname)?['month','offset']:operatingFinanceRoute.test(url.pathname)?(url.pathname==='/api/finance/operating-records'?['month','kind','storeId','status','q','offset']:['offset']):referenceCostRoute.test(url.pathname)?['month','offset']:dropshipCostRoute.test(url.pathname)?(url.pathname.endsWith('/options')?['q','offset']:['offset']):openingCostRoute.test(url.pathname)?(url.pathname.endsWith('/history')?['offset']:[]):productCostRoute.test(url.pathname)?(url.pathname==='/api/product-costs'?['offset']:['month']):productPurchaseRoute.test(url.pathname)?(url.pathname.endsWith('/history')?['offset']:[]):url.pathname==='/api/product-stock'?['q','offset']:productStockRoute.test(url.pathname)?(url.pathname.startsWith('/api/product-stock-documents/')?[]:['offset']):commercialRoute.test(url.pathname)&&url.pathname.endsWith('/history')?['offset']:url.pathname==='/api/warehouse/reorder-alerts'?['offset']:url.pathname==='/api/packaging-stock'?['q','offset']:scopedWarehouseRoute.test(url.pathname)?['offset']:url.pathname==='/api/phone-card-reminders'?['offset','until']:cardFinanceRoute.test(url.pathname)&&url.pathname.endsWith('/recharges')?['offset','q','from','to','status','storeId']:(cardFinanceRoute.test(url.pathname)&&/\/(history|balances)$/.test(url.pathname))||(cardReminderRoute.test(url.pathname)&&url.pathname.endsWith('/history'))?['offset']:url.pathname==='/api/phone-cards'?['q','status','deviceId','accountId','storeId','offset']:phoneCardRoute.test(url.pathname)&&/\/(history|identity)$/.test(url.pathname)?['offset']:equipmentPurchaseRoute.test(url.pathname)&&url.pathname.endsWith('/history')?['offset']:inventoryAccessRoute.test(url.pathname)&&url.pathname.endsWith('/history')?['offset']:memberHistoryRoute.test(url.pathname)?['offset']:url.pathname==='/api/payroll/admin-reviews'?['month','memberId','offset']:url.pathname==='/api/payroll/confirmations'?['month','memberId','offset']:url.pathname==='/api/payroll/exportable'?['month']:url.pathname==='/api/payroll/state'?['month','memberId']:url.pathname==='/api/payroll/salaries'?['memberId','offset']:url.pathname==='/api/payroll/drafts'?['memberId','month','offset']:url.pathname==='/api/attendance/month-closures'?['month','memberId']:url.pathname==='/api/attendance/month-closures/history'?['month','memberId','offset']:url.pathname==='/api/attendance/monthly'?['month','memberId']:url.pathname==='/api/attendance/calendar'?['month']:calendarHistoryRoute.test(url.pathname)?['offset']:url.pathname==='/api/workbench/completed'?['date','source','member']:url.pathname==='/api/titles/catalog'?['q','page']:sampleTransferRoute.test(url.pathname)?['offset']:(warehouseDetailRoute.test(url.pathname)&&url.pathname.endsWith('/sample-targets'))?['q','offset']:url.pathname==='/api/warehouse/items'?['q','kind','active','offset','reorder']:(warehouseDetailRoute.test(url.pathname)&&(/\/(movements|events|transfers|packaging-purchases)$/.test(url.pathname)))?['offset']:url.pathname==='/api/equipment/catalog'?['q','all','offset','assetStatus']:url.pathname==='/api/equipment/loans'?['view','status','offset']:(equipmentDetailRoute.test(url.pathname)&&/\/(history|handovers)$/.test(url.pathname))?['offset']:url.pathname==='/api/samples/catalog'?['q','active','offset']:url.pathname==='/api/samples/loans'?['view','status','offset']:exceptionDetailRoute.test(url.pathname)?(url.pathname.endsWith('/history')?['offset']:[]):url.pathname==='/api/attendance/exceptions'?['view','from','to','kind','status','offset']:attendanceDetailRoute.test(url.pathname)?(url.pathname.endsWith('/history')?['offset']:[]):url.pathname==='/api/attendance/leaves'?['view','status','from','to','memberId','offset']:url.pathname==='/api/attendance/corrections'?['view','memberId','from','to','offset','periodId','status']:url.pathname==='/api/attendance/periods'?['view','memberId','from','to','offset']:[];
      if([...url.searchParams.keys()].some(k=>!allowedQuery.includes(k))){finish(400,{message:'Unexpected query'});return;}
      const cookies=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('studio_session='));
      const cookie=forwardSession&&cookies.length===1&&/^studio_session=[a-f0-9]{64}$/.test(cookies[0])?cookies[0]:undefined;
      const remote=http.request({hostname:'::1',port:upstreamPort,path:url.pathname+url.search,method:'GET',headers:{Accept:mediaRoute.test(url.pathname)?'image/png,image/jpeg,image/gif,image/webp,video/mp4':'application/json',...(cookie?{Cookie:cookie}:{})}},up=>{
        const chunks=[];let size=0;
        up.on('data',chunk=>{size+=chunk.length;if(size>12*1024*1024){up.destroy();finish(502,{message:'Read response too large'});}else chunks.push(chunk);});
        up.on('end',()=>{
          if (res.writableEnded)return;
          if((up.statusCode||500)>=300&&(up.statusCode||500)<400){finish(502,{message:'Upstream redirect refused'});return;}
          if(mediaRoute.test(url.pathname)&&up.statusCode===200){const mime=(up.headers['content-type']||'').split(';')[0];if(!mediaTypes.has(mime)||((expenseMediaRoute.test(url.pathname)||equipmentImageRoute.test(url.pathname))&&!mime.startsWith('image/'))||size>(expenseMediaRoute.test(url.pathname)?10485760:8388608)){finish(502,{message:'Unexpected private media response'});return;}finish(200,Buffer.concat(chunks),mime);return;}
          if(!(up.headers['content-type']||'').includes('application/json')){finish(502,{message:'Unexpected response type'});return;}
          try{
            let data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            // Read-only client does not receive mutation tokens or Set-Cookie headers.
            if(url.pathname==='/api/session'&&up.statusCode===200){const user=data.user;data={user:user&&{id:user.id,username:user.username,role:user.role,...(typeof user.superadmin==='boolean'?{superadmin:user.superadmin}:{}),...(Array.isArray(user.permissions)&&user.permissions.every(p=>['finance','account_security','payroll','personnel','resources','resource_identity'].includes(p))?{permissions:user.permissions}:{})}};}
            finish(up.statusCode||502,data);
          }catch{finish(502,{message:'Invalid JSON response'});}
        });
        up.on('error',()=>finish(502,{message:'Cloud connection interrupted'}));
      });
      remote.setTimeout(10000,()=>{remote.destroy();finish(504,{message:'Cloud connection timed out'});});
      remote.on('error',()=>finish(502,{message:'Cloud tunnel unavailable'}));
      res.on('close',()=>remote.destroy());remote.end();return;
    }
    const selected=staticFiles.get(url.pathname);
    if(!selected){finish(404,{message:'Page unavailable'});return;}
    try{
      let content=await readFile(path.join(root,selected[0]));
      if(selected[0]==='index.html')content=Buffer.from(content.toString('utf8').replace('name="studio-data-mode" content="prototype"','name="studio-data-mode" content="cloud-readonly"'));
      finish(200,content,selected[1]);
    }catch{finish(500,{message:'Preview resource unavailable'});}
  });
  return server;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createPreviewServer();
  server.on('error',()=>{console.error('Read-only preview could not start; check port 4174.');process.exitCode=1;});
  server.listen(4174,'::1',()=>console.log('Cloud read-only preview: http://[::1]:4174/'));
  const stop=()=>server.close();process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
