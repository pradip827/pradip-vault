import { TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';

describe('ModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModalComponent]
    }).compileComponents();
  });

  it('should create modal component', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should not render backdrop when isOpen is false', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();

    const backdrop = fixture.nativeElement.querySelector('.modal-backdrop');
    expect(backdrop).toBeNull();
  });

  it('should render dialog with title when isOpen is true', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('title', 'Security Settings');
    fixture.detectChanges();

    const backdrop = fixture.nativeElement.querySelector('.modal-backdrop');
    expect(backdrop).toBeTruthy();

    const titleEl = fixture.nativeElement.querySelector('.modal-title');
    expect(titleEl?.textContent).toContain('Security Settings');
  });

  it('should emit closed event when close button is clicked', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    let closed = false;
    fixture.componentInstance.closed.subscribe(() => {
      closed = true;
    });

    const closeBtn = fixture.nativeElement.querySelector('.modal-close-btn') as HTMLButtonElement;
    closeBtn.click();
    expect(closed).toBe(true);
  });
});
