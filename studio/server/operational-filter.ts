import {Catch,ConflictException,type ArgumentsHost} from '@nestjs/common';
import {FinanceClosingExceptionFilter} from './finance-closing-filter';
@Catch()
export class OperationalExceptionFilter extends FinanceClosingExceptionFilter{
 override catch(error:unknown,host:ArgumentsHost){return super.catch((error as {code?:string})?.code==='OPS01'?new ConflictException():error,host);}
}
