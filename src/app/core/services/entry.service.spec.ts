import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EntryService } from './entry.service';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { ToastService } from './toast.service';

describe('EntryService (Password Manager CRUD & Search)', () => {
  let entryService: EntryService;
  let vaultService: VaultService;
  let storageService: StorageService;

  const testMasterPassword = 'EntryTestMasterPass123!';

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [EntryService, VaultService, StorageService, CryptoService, ToastService]
    });

    entryService = TestBed.inject(EntryService);
    vaultService = TestBed.inject(VaultService);
    storageService = TestBed.inject(StorageService);

    // Clean up IndexedDB before test
    await storageService.deleteVault();

    // Create and unlock a fresh vault
    await vaultService.createVault('Personal Test Vault', testMasterPassword);
  });

  afterEach(async () => {
    vaultService.lockVault();
    await storageService.deleteVault();
  });

  it('should add a new login entry and persist to storage with incremented revision', async () => {
    const initialRev = vaultService.revision();

    const added = await entryService.addEntry({
      category: 'login',
      title: 'GitHub Developer',
      website: 'github.com',
      username: 'dev_user827',
      password: 'SuperSecretPassword!123',
      notes: 'Main developer account',
      favorite: true
    });

    expect(added.id).toBeDefined();
    expect(added.title).toBe('GitHub Developer');
    // Website should be sanitized and normalized
    expect(added.website).toBe('https://github.com/');
    expect(added.username).toBe('dev_user827');
    expect(added.favorite).toBe(true);

    // Vault should reflect the new entry and incremented revision
    expect(vaultService.entries().length).toBe(1);
    expect(vaultService.revision()).toBe(initialRev + 1);

    // Category counts should be updated
    const counts = entryService.categoryCounts();
    expect(counts.all).toBe(1);
    expect(counts.login).toBe(1);
    expect(counts.favorites).toBe(1);
  });

  it('should sanitize dangerous URI schemes when adding or updating entries', async () => {
    const added = await entryService.addEntry({
      category: 'login',
      title: 'Dangerous Site',
      website: 'javascript:alert(document.cookie)',
      username: 'attacker'
    });

    // Dangerous URL scheme must be neutralized to empty string
    expect(added.website).toBe('');

    const updated = await entryService.updateEntry({
      id: added.id,
      website: 'data:text/html,<script>alert(1)</script>'
    });

    expect(updated.website).toBe('');
  });

  it('should update an existing entry', async () => {
    const added = await entryService.addEntry({
      category: 'login',
      title: 'Original Title',
      username: 'user1',
      password: 'pass1'
    });

    const updated = await entryService.updateEntry({
      id: added.id,
      title: 'Updated Title',
      username: 'user2'
    });

    expect(updated.title).toBe('Updated Title');
    expect(updated.username).toBe('user2');
    expect(updated.password).toBe('pass1'); // Preserved
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(added.updatedAt).getTime());
  });

  it('should toggle favorite status', async () => {
    const added = await entryService.addEntry({
      category: 'login',
      title: 'Favorite Test',
      favorite: false
    });

    expect(added.favorite).toBe(false);

    const isFavNow = await entryService.toggleFavorite(added.id);
    expect(isFavNow).toBe(true);
    expect(entryService.entries().find(e => e.id === added.id)?.favorite).toBe(true);

    const isFavAgain = await entryService.toggleFavorite(added.id);
    expect(isFavAgain).toBe(false);
    expect(entryService.entries().find(e => e.id === added.id)?.favorite).toBe(false);
  });

  it('should delete an entry and update counts', async () => {
    const entry1 = await entryService.addEntry({ category: 'login', title: 'Item 1' });
    const entry2 = await entryService.addEntry({ category: 'secure_note', title: 'Item 2' });

    expect(entryService.entries().length).toBe(2);
    expect(entryService.categoryCounts().all).toBe(2);

    await entryService.deleteEntry(entry1.id);

    expect(entryService.entries().length).toBe(1);
    expect(entryService.entries()[0].id).toBe(entry2.id);
    expect(entryService.categoryCounts().all).toBe(1);
    expect(entryService.categoryCounts().login).toBe(0);
    expect(entryService.categoryCounts().secure_note).toBe(1);
  });

  it('should filter entries by search query across fields', async () => {
    await entryService.addEntry({
      category: 'login',
      title: 'ProtonMail',
      username: 'user@proton.me',
      website: 'mail.proton.me',
      notes: 'Encrypted communication'
    });

    await entryService.addEntry({
      category: 'secure_note',
      title: 'Wi-Fi Office Key',
      notes: 'WPA3 Network Passphrase in HQ'
    });

    await entryService.addEntry({
      category: 'credit_card',
      title: 'Visa Debit',
      username: 'Standard Cardholder',
      notes: 'Card for cloud hosting subscriptions'
    });

    // Search by title
    entryService.searchQuery.set('proton');
    expect(entryService.filteredEntries().length).toBe(1);
    expect(entryService.filteredEntries()[0].title).toBe('ProtonMail');

    // Search by username
    entryService.searchQuery.set('user@proton');
    expect(entryService.filteredEntries().length).toBe(1);

    // Search by notes
    entryService.searchQuery.set('passphrase');
    expect(entryService.filteredEntries().length).toBe(1);
    expect(entryService.filteredEntries()[0].title).toBe('Wi-Fi Office Key');

    // Clear search
    entryService.searchQuery.set('');
    expect(entryService.filteredEntries().length).toBe(3);
  });

  it('should filter entries by category and favorites', async () => {
    await entryService.addEntry({ category: 'login', title: 'Login 1', favorite: true });
    await entryService.addEntry({ category: 'login', title: 'Login 2', favorite: false });
    await entryService.addEntry({ category: 'secure_note', title: 'Note 1', favorite: true });
    await entryService.addEntry({ category: 'credit_card', title: 'Card 1', favorite: false });

    // All
    entryService.selectedCategory.set('all');
    expect(entryService.filteredEntries().length).toBe(4);

    // Logins only
    entryService.selectedCategory.set('login');
    expect(entryService.filteredEntries().length).toBe(2);

    // Secure notes only
    entryService.selectedCategory.set('secure_note');
    expect(entryService.filteredEntries().length).toBe(1);

    // Favorites only
    entryService.selectedCategory.set('favorites');
    expect(entryService.filteredEntries().length).toBe(2);
  });

  it('should sort entries ascending and descending', async () => {
    await entryService.addEntry({ category: 'login', title: 'Zebra Service' });
    await entryService.addEntry({ category: 'login', title: 'Alpha Service' });
    await entryService.addEntry({ category: 'login', title: 'Beta Service' });

    entryService.sortBy.set('title');
    entryService.sortDirection.set('asc');
    const titlesAsc = entryService.filteredEntries().map(e => e.title);
    expect(titlesAsc).toEqual(['Alpha Service', 'Beta Service', 'Zebra Service']);

    entryService.sortDirection.set('desc');
    const titlesDesc = entryService.filteredEntries().map(e => e.title);
    expect(titlesDesc).toEqual(['Zebra Service', 'Beta Service', 'Alpha Service']);
  });
});
