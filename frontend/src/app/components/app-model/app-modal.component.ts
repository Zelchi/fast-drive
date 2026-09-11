import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, effect, HostListener, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalService } from '../../core/modal.service';

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule],
    selector: 'app-modal',
    templateUrl: './app-modal.component.html',
    styleUrl: './app-modal.component.css',
})
export class AppModalComponent {
    readonly modalService = inject(ModalService);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);

    inputValue = '';
    inputError = '';

    constructor() {
        effect(() => {
            const modal = this.modalService.state();
            this.inputValue = modal?.input?.defaultValue ?? '';
            this.inputError = '';
            this.changeDetectorRef.markForCheck();
        });
    }

    submit(): void {
        const modal = this.modalService.state();
        if (!modal) {
            return;
        }

        if (modal.input?.required && !this.inputValue.trim()) {
            this.inputError = 'Informe um valor para continuar.';
            return;
        }

        this.modalService.resolve({
            confirmed: true,
            value: modal.input ? this.inputValue : undefined,
        });
    }

    cancel(): void {
        this.modalService.resolve({ confirmed: false });
    }

    onBackdropPointerDown(event: PointerEvent): void {
        const modal = this.modalService.state();
        if (modal?.closeOnBackdrop && event.target === event.currentTarget) {
            this.cancel();
        }
    }

    @HostListener('document:keydown.escape', ['$event'])
    onEscape(event: Event): void {
        if (!this.modalService.state()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
    }
}
