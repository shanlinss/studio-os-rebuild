export class ApiError extends Error {
  constructor(status, message) { super(message); this.name='ApiError';this.status=status; }
}
export class ContractError extends Error {
  constructor(message='这条资料暂时无法完整显示，请刷新后重试。'){super(message);this.name='ContractError';}
}

export function chinaDate(value=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
export function validDate(value){const d=new Date(value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!value.startsWith('0000')&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
