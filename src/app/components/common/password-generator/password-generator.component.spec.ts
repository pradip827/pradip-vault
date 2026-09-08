import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PasswordGeneratorComponent } from './password-generator.component';
import { ToastService } from '../../../core/services/toast.service';

describe('PasswordGeneratorComponent', () => {
  let component: PasswordGeneratorComponent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PasswordGeneratorComponent],
      providers: [ToastService]
    });

    const fixture = TestBed.createComponent(PasswordGeneratorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and initialize with a random 20-character password', () => {
    expect(component).toBeTruthy();
    expect(component.currentPassword()).toBeDefined();
    expect(component.currentPassword().length).toBe(20);
    expect(component.mode()).toBe('password');
  });

  it('should switch between password and passphrase modes', () => {
    component.setMode('passphrase');
    expect(component.mode()).toBe('passphrase');
    // Passphrase mode should contain hyphens by default
    expect(component.currentPassword()).toContain('-');
    expect(component.currentPassword().split('-').length).toBe(5);

    component.setMode('password');
    expect(component.mode()).toBe('password');
    expect(component.currentPassword().length).toBe(20);
  });

  it('should emit passwordSelected event with current password', () => {
    let selected = '';
    component.passwordSelected.subscribe(pwd => {
      selected = pwd;
    });

    component.usePassword();
    expect(selected).toBe(component.currentPassword());
  });

  it('should emit cancelled event', () => {
    let cancelled = false;
    component.cancelled.subscribe(() => {
      cancelled = true;
    });

    component.cancel();
    expect(cancelled).toBe(true);
  });

  it('should recalculate strength percent and color dynamically', () => {
    expect(component.entropy().bits).toBeGreaterThan(50);
    expect(component.strengthPercent()).toBeGreaterThan(0);
    expect(component.strengthColor()).toBeDefined();
  });
});
