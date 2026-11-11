import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { ErrorTracker } from '../ops/error-tracker.service';
import { normaliseRoute } from '../ops/fingerprint';
import { describeError } from './describe-error';

/**
 * App-wide replacement for Nest's handler of unexpected errors, which logs `message` and `stack`
 * as they are: for a failed query that is every parameter, personal data included. HTTP
 * exceptions (4xx, deliberate 5xx) go through Nest unchanged. Anything else answers the same
 * generic 500 and logs only `describeError()`.
 */
@Catch()
export class SafeExceptionFilter extends BaseExceptionFilter {
  private readonly log = new Logger('ExceptionsHandler');

  constructor(
    applicationRef?: ConstructorParameters<typeof BaseExceptionFilter>[0],
    private readonly tracker?: ErrorTracker,
  ) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) return super.catch(exception, host);
    this.log.error(describeError(exception));
    // Filed by class, route pattern and frames (ADR 0035); the query string and the ids never leave here.
    const req = host.switchToHttp().getRequest<{
      method?: string;
      route?: { path?: string };
      originalUrl?: string;
      url?: string;
    }>();
    const path = req?.route?.path ?? req?.originalUrl ?? req?.url ?? '';
    void this.tracker?.record(exception, normaliseRoute(req?.method ?? 'GET', path));
    const adapter = this.applicationRef ?? this.httpAdapterHost?.httpAdapter;
    const response: unknown = host.getArgByIndex(1);
    if (!adapter || adapter.isHeadersSent(response)) return;
    adapter.reply(
      response,
      { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
