import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
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

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) return super.catch(exception, host);
    this.log.error(describeError(exception));
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
