import { Injectable, signal } from '@angular/core';

export type ModalVariant = 'info' | 'success' | 'warning' | 'error';

export interface ModalInputOptions {
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    type?: 'text' | 'password' | 'range';
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    required?: boolean;
}

export interface ModalOptions {
    title: string;
    message?: string;
    variant?: ModalVariant;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
    closeOnBackdrop?: boolean;
    input?: ModalInputOptions;
}

export interface ModalState
    extends Required<
        Pick<
            ModalOptions,
            'title' | 'variant' | 'confirmLabel' | 'cancelLabel' | 'showCancel' | 'closeOnBackdrop'
        >
    > {
    message: string;
    input?: ModalInputOptions;
}

export interface ModalResult {
    confirmed: boolean;
    value?: string;
}

@Injectable({ providedIn: 'root' })
export class ModalService {
    readonly state = signal<ModalState | null>(null);

    private resolver: ((result: ModalResult) => void) | null = null;

    open(options: ModalOptions): Promise<ModalResult> {
        this.resolve({ confirmed: false });
        this.state.set({
            title: options.title,
            message: options.message ?? '',
            variant: options.variant ?? 'info',
            confirmLabel: options.confirmLabel ?? 'Continuar',
            cancelLabel: options.cancelLabel ?? 'Cancelar',
            showCancel: options.showCancel ?? true,
            closeOnBackdrop: options.closeOnBackdrop ?? true,
            input: options.input,
        });

        return new Promise<ModalResult>((resolve) => {
            this.resolver = resolve;
        });
    }

    async alert(message: string, title = 'Aviso', variant: ModalVariant = 'info'): Promise<void> {
        await this.open({
            title,
            message,
            variant,
            confirmLabel: 'Entendi',
            showCancel: false,
        });
    }

    async confirm(message: string, title = 'Confirme a ação'): Promise<boolean> {
        const result = await this.open({
            title,
            message,
            variant: 'warning',
            confirmLabel: 'Confirmar',
            cancelLabel: 'Cancelar',
        });
        return result.confirmed;
    }

    async prompt(
        message: string,
        defaultValue = '',
        title = 'Informe um valor',
        input: Omit<ModalInputOptions, 'defaultValue'> = {},
    ): Promise<string | null> {
        const result = await this.open({
            title,
            message,
            variant: 'info',
            confirmLabel: 'Salvar',
            cancelLabel: 'Cancelar',
            input: { ...input, defaultValue },
        });
        return result.confirmed ? (result.value ?? '') : null;
    }

    resolve(result: ModalResult): void {
        const resolver = this.resolver;
        this.resolver = null;
        this.state.set(null);
        resolver?.(result);
    }
}
