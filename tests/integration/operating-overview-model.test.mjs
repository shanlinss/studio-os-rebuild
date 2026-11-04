import test from 'node:test';
import assert from 'node:assert/strict';
import {operatingOverview} from '../../.build/server/operating-overview-model.js';
const month='2026-01',stores=['a','b','c'].map(id=>({id,name:id,active:true}));
const data=()=>({stores,incomes:[],expenses:[],fees:[],daily:[],dropship:[],refunds:[],movements:[],packaging:[]});
const income=(storeId,amountCents)=>({id:'income-'+storeId,storeId,amountCents,status:'confirmed',version:1,sourceReference:'原月报'});
const expense=(storeId,amountCents,extra={})=>({id:'expense-'+(storeId??'public'),storeId,amountCents,month,expenseScope:storeId?'store':'public',expenseUse:'operating',purchaseLinked:false,...extra});
test('the user example is ten minus six minus two, with no public cost allocation or active-store-count dependence',()=>{
 const d=data();d.incomes=[income('a',3000000),income('b',3000000),income('c',4000000)];d.expenses=[expense('a',1000000),expense('b',2000000),expense('c',3000000),expense(null,2000000)];
 let r=operatingOverview(d,month);assert.equal(r.summary.incomeCents,'10000000');assert.equal(r.summary.directCostCents,'6000000');assert.equal(r.summary.storeProfitCents,'4000000');assert.equal(r.publicCents,'2000000');assert.equal(r.summary.studioProfitCents,'2000000');
 d.stores=[...stores.map(s=>({...s,active:false})),{id:'new-empty',name:'新增未纳入店铺',active:true}];r=operatingOverview(d,month);assert.equal(r.rows.length,3);assert.equal(r.summary.studioProfitCents,'2000000');assert.equal(r.rows.find(s=>s.storeId==='a').profitCents,'2000000');
});
test('daily sales and refunds are reference-only, linked fees count once using the original expense month, and inventory is excluded',()=>{
 const d=data();d.incomes=[income('a',10000)];d.expenses=[expense('a',100,{id:'fee-expense'}),expense(null,9000,{id:'inventory',expenseUse:'inventory'})];d.fees=[{id:'fee',storeId:'a',amountCents:100,expenseId:'fee-expense',sourceChanged:false},{id:'standalone',storeId:'a',amountCents:50,expenseId:null}];d.daily=[{storeId:'a',kind:'sale',amountCents:99999},{storeId:'a',kind:'refund',amountCents:100}];
 const r=operatingOverview(d,month);assert.equal(r.rows[0].directCostCents,'150');assert.equal(r.rows[0].profitCents,'9850');assert.equal(r.inventoryCents,'9000');assert.equal(r.summary.incomeCents,'10000');
 d.expenses[0].month='2025-12';assert.equal(operatingOverview(d,month).rows[0].directCostCents,'50');
 d.fees[0].sourceChanged=true;assert.equal(operatingOverview(d,month).rows[0].profitCents,null);
});
test('missing, estimated and contradictory sources block profit while zero and negative confirmed incomes retain meaning',()=>{
 let d=data();d.incomes=[income('a',0)];assert.equal(operatingOverview(d,month).rows[0].profitCents,'0');d.incomes[0].amountCents=-123;assert.equal(operatingOverview(d,month).summary.studioProfitCents,'-123');
 d.expenses=[expense(null,300,{expenseScope:'unclassified'})];assert.equal(operatingOverview(d,month).rows[0].profitCents,null);assert.equal(operatingOverview(d,month).summary.studioProfitCents,null);
 d=data();d.incomes=[income('a',1000)];d.expenses=[expense('a',100,{purchaseLinked:true})];assert.equal(operatingOverview(d,month).rows[0].directCostCents,null);
 d.expenses=[];d.dropship=[{storeId:'a',basis:'reference',amountCents:'10',documentId:'doc'}];assert.equal(operatingOverview(d,month).rows[0].dropshipCents,null);
 d.dropship=[];d.packaging=[{storeId:'a',id:'pack'}];assert.equal(operatingOverview(d,month).rows[0].profitCents,null);
 assert.equal(operatingOverview(data(),month).summary.studioProfitCents,null);
});
test('actual stock costs stay exact across SKUs and supplier refunds reverse costs in their own month',()=>{
 const d=data();d.incomes=[income('a',1000)];let n=0;
 const movement=(skuId,operation,quantity,totalCents,extra={})=>({skuId,id:'m'+(++n),operation,type:operation==='shipment'?'outbound':'inbound',quantity,delta:operation==='shipment'?-quantity:quantity,totalCents,day:'2026-01-01',postedAt:new Date(Date.UTC(2026,0,1,0,0,n)).toISOString(),documentId:'doc'+n,sourceShipmentId:null,purchaseVersion:null,sourceChanged:false,snapshot:{},duplicateOpening:false,internalTransfer:false,...extra});
 d.movements=[movement('sku1','inbound',3,100),movement('sku1','shipment',1,null,{businessStoreId:'a'}),movement('sku2','inbound',3,100),movement('sku2','shipment',1,null,{businessStoreId:'a'})];
 const r=operatingOverview(d,month);assert.equal(r.rows[0].stockCents,'67');assert.equal(r.rows[0].profitCents,'933');
 d.refunds=[{storeId:'a',amountCents:123,documentId:'old-drop'}];assert.equal(operatingOverview(d,month).rows[0].dropshipCents,'-123');assert.equal(operatingOverview(d,month).rows[0].profitCents,'1056');
});
test('packaging use and explicitly attributed inventory losses charge real destination or public scope once',()=>{
 const d=data();d.incomes=[income('a',10000)];d.inventoryCosts=[{id:'pack',itemId:'item',mode:'automatic',kind:'packaging',scope:'store',storeId:'a',exact:{n:'100',d:'3'},costCents:'33',sourceChanged:false,expenseId:null},{id:'loss',itemId:'item',mode:'outflow',kind:'packaging',scope:'public',storeId:null,exact:{n:'200',d:'1'},costCents:'200',sourceChanged:false,expenseId:null}];
 let r=operatingOverview(d,month);assert.equal(r.rows[0].packagingCents,'33');assert.equal(r.rows[0].directCostCents,'33');assert.equal(r.publicCents,'200');assert.equal(r.summary.studioProfitCents,'9767');
 d.inventoryCosts[1].scope='unclassified';r=operatingOverview(d,month);assert.equal(r.summary.studioProfitCents,null);assert.equal(r.rows[0].profitCents,null);
});
test('inventory expense links count original operating expense once and flag amount, timing or competing source conflicts',()=>{
 const d=data();d.incomes=[income('a',10000)];d.expenses=[expense('a',200,{id:'original',version:2})];d.inventoryCosts=[{id:'loss',mode:'outflow',scope:'store',storeId:'a',exact:{n:'200',d:'1'},costCents:'200',expenseId:'original',expenseSnapshot:{version:2},sourceChanged:false}];
 let r=operatingOverview(d,month);assert.equal(r.rows[0].directCostCents,'200');assert.equal(r.rows[0].otherInventoryCents,'0');
 d.inventoryCosts[0].costCents='201';assert.equal(operatingOverview(d,month).rows[0].profitCents,null);
 d.inventoryCosts[0].costCents='200';d.inventoryCosts[0].expenseLinkedElsewhere=true;assert.equal(operatingOverview(d,month).rows[0].profitCents,null);
 d.inventoryCosts[0].expenseLinkedElsewhere=false;d.expenses[0].month='2025-12';assert.equal(operatingOverview(d,month).rows[0].profitCents,null);
});
test('sample transfers retain asset value without operating expense or blocking otherwise known profits',()=>{
 const d=data();d.incomes=[income('a',10000)];d.inventoryCosts=[{id:'sample',mode:'asset',scope:'unclassified',storeId:null,exact:{n:'400',d:'1'},costCents:'400',sourceChanged:false}];
 let r=operatingOverview(d,month);assert.equal(r.sampleAssetTransferCents,'400');assert.equal(r.publicCents,'0');assert.equal(r.summary.studioProfitCents,'10000');
 d.inventoryCosts[0].exact=null;r=operatingOverview(d,month);assert.equal(r.sampleAssetTransferCents,null);assert.equal(r.sampleAssetPending,1);assert.equal(r.summary.studioProfitCents,'10000');
});
test('recorded sample losses remain unresolved costs instead of being silently treated as free asset transfers',()=>{
 const d=data();d.incomes=[income('a',10000)];d.inventoryCosts=[{id:'loss-event',mode:'sample-loss',scope:'unclassified',storeId:null}];const r=operatingOverview(d,month);assert.equal(r.summary.studioProfitCents,null);assert.equal(r.rows[0].profitCents,null);assert.equal(r.publicPending[0].kind,'sample');
});
test('confirmed sample losses charge explicit public or store scope once and link back to original sample evidence',()=>{
 const d=data();d.incomes=[income('a',10000)];d.inventoryCosts=[{id:'sample-loss-a',mode:'sample-loss',sourceKind:'sample-cost',scope:'store',storeId:'a',exact:{n:'100',d:'3'},costCents:'33',sourceChanged:false},{id:'sample-loss-public',mode:'sample-loss',sourceKind:'sample-cost',scope:'public',storeId:null,exact:{n:'200',d:'1'},costCents:'200',sourceChanged:false}];
 let r=operatingOverview(d,month);assert.equal(r.rows[0].otherInventoryCents,'33');assert.equal(r.publicCents,'200');assert.equal(r.summary.studioProfitCents,'9767');assert.equal(r.rows[0].sources[0].kind,'sample-cost');d.inventoryCosts[0].sourceChanged=true;r=operatingOverview(d,month);assert.equal(r.rows[0].otherInventoryCents,null);assert.equal(r.rows[0].pending[0].kind,'sample-cost');assert.equal(r.summary.studioProfitCents,null);
});
