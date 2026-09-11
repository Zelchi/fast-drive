import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    inject,
    OnDestroy,
    ViewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppModalComponent } from './components/app-model/app-modal.component';

@Component({
    imports: [AppModalComponent, RouterOutlet],
    selector: 'app-root',
    templateUrl: './app.html',
    styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
    @ViewChild('appScrollViewport') private appScrollViewport?: ElementRef<HTMLElement>;

    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private mutationObserver?: MutationObserver;
    private scrollbarFrame: number | null = null;
    private removeScrollbarDragListeners: (() => void) | null = null;

    appScrollbarVisible = false;
    appScrollbarThumbHeight = 0;
    appScrollbarThumbOffset = 0;

    ngAfterViewInit(): void {
        const viewport = this.appScrollViewport?.nativeElement;
        if (viewport) {
            this.mutationObserver = new MutationObserver(() => this.scheduleAppScrollbarSync());
            this.mutationObserver.observe(viewport, {
                childList: true,
                subtree: true,
                characterData: true,
            });
        }
        this.scheduleAppScrollbarSync();
    }

    ngOnDestroy(): void {
        this.mutationObserver?.disconnect();
        if (this.scrollbarFrame !== null) {
            cancelAnimationFrame(this.scrollbarFrame);
        }
        this.removeScrollbarDragListeners?.();
    }

    @HostListener('document:contextmenu', ['$event'])
    preventBrowserContextMenu(event: MouseEvent): void {
        event.preventDefault();
    }

    scheduleAppScrollbarSync(): void {
        if (this.scrollbarFrame !== null) {
            cancelAnimationFrame(this.scrollbarFrame);
        }
        this.scrollbarFrame = requestAnimationFrame(() => {
            this.scrollbarFrame = null;
            this.syncAppScrollbar();
        });
    }

    syncAppScrollbar(): void {
        const viewport = this.appScrollViewport?.nativeElement;
        if (!viewport) {
            return;
        }

        const scrollRange = viewport.scrollHeight - viewport.clientHeight;
        if (scrollRange <= 1) {
            this.appScrollbarVisible = false;
            this.appScrollbarThumbHeight = 0;
            this.appScrollbarThumbOffset = 0;
            this.changeDetectorRef.markForCheck();
            return;
        }

        const trackHeight = Math.max(1, viewport.clientHeight - 24);
        const thumbHeight = Math.min(
            trackHeight,
            Math.max(50, (viewport.clientHeight / viewport.scrollHeight) * trackHeight),
        );
        const thumbRange = Math.max(0, trackHeight - thumbHeight);
        this.appScrollbarVisible = true;
        this.appScrollbarThumbHeight = thumbHeight;
        this.appScrollbarThumbOffset = thumbRange * (viewport.scrollTop / scrollRange);
        this.changeDetectorRef.markForCheck();
    }

    onAppWheel(event: WheelEvent): void {
        const viewport = this.appScrollViewport?.nativeElement;
        if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
            return;
        }

        event.preventDefault();
        viewport.scrollTop += event.deltaY;
        this.syncAppScrollbar();
    }

    onAppScrollbarTrackClick(event: MouseEvent): void {
        if (!this.appScrollbarVisible || event.target !== event.currentTarget) {
            return;
        }
        const viewport = this.appScrollViewport?.nativeElement;
        const track = event.currentTarget as HTMLElement;
        if (!viewport || track.clientHeight <= 0) {
            return;
        }

        const bounds = track.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
        viewport.scrollTop =
            position * (viewport.scrollHeight - viewport.clientHeight) - viewport.clientHeight / 2;
        this.syncAppScrollbar();
    }

    startAppScrollbarDrag(event: MouseEvent): void {
        const viewport = this.appScrollViewport?.nativeElement;
        if (!viewport || !this.appScrollbarVisible) {
            return;
        }

        this.removeScrollbarDragListeners?.();
        event.preventDefault();
        event.stopPropagation();
        const startY = event.clientY;
        const startScrollTop = viewport.scrollTop;
        const scrollRange = viewport.scrollHeight - viewport.clientHeight;
        const thumbRange = Math.max(1, viewport.clientHeight - 24 - this.appScrollbarThumbHeight);

        const onMove = (moveEvent: MouseEvent): void => {
            const movement = moveEvent.clientY - startY;
            viewport.scrollTop = startScrollTop + (movement / thumbRange) * scrollRange;
            this.syncAppScrollbar();
        };
        const stop = (): void => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', stop);
            this.removeScrollbarDragListeners = null;
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', stop);
        this.removeScrollbarDragListeners = stop;
    }

    onAppScrollbarKeydown(event: KeyboardEvent): void {
        const viewport = this.appScrollViewport?.nativeElement;
        if (!viewport) {
            return;
        }

        const pageSize = viewport.clientHeight * 0.85;
        const movements: Record<string, number> = {
            ArrowDown: 56,
            ArrowUp: -56,
            PageDown: pageSize,
            PageUp: -pageSize,
            End: viewport.scrollHeight,
            Home: -viewport.scrollHeight,
        };
        const movement = movements[event.key];
        if (movement === undefined) {
            return;
        }

        event.preventDefault();
        viewport.scrollTop += movement;
        this.syncAppScrollbar();
    }
}
