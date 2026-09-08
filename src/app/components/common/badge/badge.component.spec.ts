import { TestBed } from '@angular/core/testing';
import { BadgeComponent } from './badge.component';

describe('BadgeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BadgeComponent]
    }).compileComponents();
  });

  it('should create badge component', () => {
    const fixture = TestBed.createComponent(BadgeComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should apply variant and size classes', () => {
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.componentRef.setInput('variant', 'success');
    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.classList.contains('badge-success')).toBe(true);
    expect(badge.classList.contains('badge-sm')).toBe(true);
  });
});
