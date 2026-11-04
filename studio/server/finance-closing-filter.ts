import {Catch,type ArgumentsHost,type ExceptionFilter} from '@nestjs/common';
import type {Response} from 'express';
import {SafeExceptionFilter,type DiagnosticSink,diagnosticSink} from './diagnostics';
// Preserve the imported exception filter byte-for-byte; only the new lock conflict gets a safe public reason.
@Catch()
export class FinanceClosingExceptionFilter implements ExceptionFilter{
 private readonly fallback:SafeExceptionFilter;
 constructor(private readonly sink:DiagnosticSink=diagnosticSink){this.fallback=new SafeExceptionFilter(sink);}
 catch(error:unknown,host:ArgumentsHost){
  if((error as {code?:string})?.code!=='PFC01')return this.fallback.catch(error,host);
  const response=host.switchToHttp().getResponse<Response>(),requestId=response.locals.requestId as string;
  try{this.sink({event:'http_error',requestId,status:409});}catch{}
  if(!response.headersSent)response.status(409).json({statusCode:409,message:'Data conflict',reason:'finance_month_locked',requestId});
 }
}
