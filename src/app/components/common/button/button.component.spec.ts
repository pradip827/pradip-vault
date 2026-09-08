import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonComponent]
    }).compileComponents();
  });

  it('should create button component', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should apply primary variant class by default', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.classList.contains('btn-primary')).toBe(true);
  });

  it('should disable button when disabled is true', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('should show spinner when loading is true', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const spinner = fixture.nativeElement.querySelector('.spinner');
    expect(spinner).toBeTruthy();
  });

  it('should emit clicked event when not disabled', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    let clicked = false;
    fixture.componentInstance.clicked.subscribe(() => {
      clicked = true;
    });
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(clicked).toBe(true);
  });
});
