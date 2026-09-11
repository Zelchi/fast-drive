import { type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ServerConfigService } from './server-config.service';

export const apiBaseUrlInterceptor: HttpInterceptorFn = (request, next) => {
    if (!request.url.startsWith('/api/')) {
        return next(request);
    }

    const serverConfig = inject(ServerConfigService);
    return next(request.clone({ url: serverConfig.apiUrl(request.url) }));
};
