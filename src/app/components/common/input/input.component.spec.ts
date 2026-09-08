import { TestBed } from '@angular/core/testing';
import { InputComponent } from './input.component';

describe('InputComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputComponent]
    }).compileComponents();
  });

  it('should create input component', () => {
    const fixture = TestBed.createComponent(InputComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render label when provided', () => {
    const fixture = TestBed.createComponent(InputComponent);
    fixture.componentRef.setInput('label', 'Master Password');
    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('.input-label') as HTMLLabelElement;
    expect(label.textContent).toContain('Master Password');
  });

  it('should toggle password visibility on password toggle button click', () => {
    const fixture = TestBed.createComponent(InputComponent);
    fixture.componentRef.setInput('type', 'password');
    fixture.detectChanges();

    const inputEl = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(inputEl.type).toBe('password');

    const toggleBtn = fixture.nativeElement.querySelector('.password-toggle-btn') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();

    toggleBtn.click();
    fixture.detectChanges();
    expect(inputEl.type).toBe('text');

    toggleBtn.click();
    fixture.detectChanges();
    expect(inputEl.type).toBe('password');
  });

  it('should display error message when error is set', () => {
    const fixture = TestBed.createComponent(InputComponent);
    fixture.componentRef.setInput('error', 'Invalid credentials');
    fixture.detectChanges();

    const errorEl = fixture.nativeElement.querySelector('.input-error-msg') as HTMLElement;
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).toContain('Invalid credentials');
  });
});
