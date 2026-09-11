import { HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { map, type OperatorFunction } from 'rxjs';

export interface RuntimeSchema<T> {
    parse(value: unknown): T;
}

export function parseRequest<T>(schema: RuntimeSchema<T>, value: unknown): T {
    return schema.parse(value);
}

export function validateResponse<T>(schema: RuntimeSchema<T>): OperatorFunction<unknown, T> {
    return map((value) => schema.parse(value));
}

export function validateHttpEvent<T>(
    schema: RuntimeSchema<T>,
): OperatorFunction<HttpEvent<unknown>, HttpEvent<T>> {
    return map((event) => {
        if (event.type !== HttpEventType.Response) {
            return event as HttpEvent<T>;
        }

        const response = event as HttpResponse<unknown>;
        return response.clone({ body: schema.parse(response.body) });
    });
}
