import { randomUUID } from 'node:crypto';
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export type DiagnosticEvent = {
  event: 'http_error';
  requestId: string;
  status: number;
};
export type DiagnosticSink = (event: DiagnosticEvent) => void;
export const diagnosticSink: DiagnosticSink = (event) =>
  console.error(JSON.stringify(event));
export function requestIdentity(
  _req: Request,
  res: Response,
  next: () => void,
) {
  // Never echo an untrusted request ID or include URLs, headers, bodies or secrets.
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-Id', res.locals.requestId);
  next();
}
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  constructor(private readonly log: DiagnosticSink = diagnosticSink) {}
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const type = (error as { type?: string } | null)?.type;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : type === 'entity.parse.failed'
          ? 400
          : type === 'entity.too.large'
            ? 413
            : 500;
    const messages: Record<number, string> = {
      400: 'Invalid request',
      401: 'Authentication required',
      403: 'Access denied',
      404: 'Not found',
      409: 'Data conflict',
      413: 'Request too large',
      429: 'Try again later',
      503: 'Service unavailable',
    };
    const requestId = response.locals.requestId as string;
    // Diagnostic failures must not change authorization or leak exception text.
    try {
      this.log({ event: 'http_error', requestId, status });
    } catch {
      /* fail closed */
    }
    if (!response.headersSent)
      response.status(status).json({
        statusCode: status,
        message: messages[status] ?? 'Internal server error',
        requestId,
      });
  }
}
