import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { VaultService } from '../../core/services/vault.service';
import { EntryService } from '../../core/services/entry.service';
import { StorageService } from '../../core/services/storage.service';
import { CryptoService } from '../../core/services/crypto.service';
import { ToastService } from '../../core/services/toast.service';

describe('DashboardComponent (CRUD & Dashboard UI)', () => {
  let component: DashboardComponent;
  let vaultService: VaultService;
  let entryService: EntryService;
  let storageService: StorageService;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        VaultService,
        EntryService,
        StorageService,
        CryptoService,
        ToastService
      ]
    });

    vaultService = TestBed.inject(VaultService);
    entryService = TestBed.inject(EntryService);
    storageService = TestBed.inject(StorageService);

    await storageService.deleteVault();

    const fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the dashboard component in locked state initially', () => {
    expect(component).toBeTruthy();
    expect(vaultService.isLocked()).toBe(true);
  });

  it('should open and close the add entry modal', () => {
    expect(component.isAddModalOpen()).toBe(false);

    component.openAddModal();
    expect(component.isAddModalOpen()).toBe(true);
    expect(component.formCategory()).toBe('login');
    expect(component.formTitle()).toBe('');

    component.isAddModalOpen.set(false);
    expect(component.isAddModalOpen()).toBe(false);
  });

  it('should format display URLs correctly', () => {
    expect(component.getDisplayUrl('https://www.github.com/developer')).toBe('github.com');
    expect(component.getDisplayUrl('https://accounts.google.com/login')).toBe('accounts.google.com');
    expect(component.getDisplayUrl('invalid-url')).toBe('invalid-url');
  });

  it('should map categories to icons correctly', () => {
    expect(component.getCategoryIcon('login')).toBe('lock');
    expect(component.getCategoryIcon('secure_note')).toBe('shield');
    expect(component.getCategoryIcon('credit_card')).toBe('key');
    expect(component.getCategoryIcon('identity')).toBe('smartphone');
    expect(component.getCategoryIcon('server')).toBe('cloud');
  });

  it('should toggle sort direction', () => {
    entryService.sortDirection.set('asc');
    component.toggleSortDirection();
    expect(entryService.sortDirection()).toBe('desc');

    component.toggleSortDirection();
    expect(entryService.sortDirection()).toBe('asc');
  });

  it('should clear and reset search and filters', () => {
    entryService.searchQuery.set('search test');
    entryService.selectedCategory.set('login');

    component.clearSearch();
    expect(entryService.searchQuery()).toBe('');

    component.resetFilters();
    expect(entryService.searchQuery()).toBe('');
    expect(entryService.selectedCategory()).toBe('all');
  });

  it('should open password generator and apply generated password to form', () => {
    expect(component.isGeneratorOpen()).toBe(false);

    component.openGenerator();
    expect(component.isGeneratorOpen()).toBe(true);

    const testPassword = 'GeneratedStrongPass!99';
    component.applyGeneratedPassword(testPassword);

    expect(component.formPassword()).toBe(testPassword);
    expect(component.isGeneratorOpen()).toBe(false);
  });
});
