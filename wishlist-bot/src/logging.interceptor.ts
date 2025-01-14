import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
  } from '@nestjs/common';
  import { Observable } from 'rxjs';
  import { tap } from 'rxjs/operators';
  
  @Injectable()
  export class LoggingInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
      const request = context.switchToHttp().getRequest();
      const response = context.switchToHttp().getResponse();
      const startTime = Date.now();
  
      return next.handle().pipe(
        tap(() => {
          const { method, url } = request;
          const statusCode = response.statusCode;
          const duration = Date.now() - startTime;
  
          console.log(`[${method}] ${url} - ${statusCode} (${duration}ms)`);
        }),
      );
    }
  }
  