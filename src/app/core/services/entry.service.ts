import { Injectable, inject, signal, computed } from '@angular/core';
import { VaultService } from './vault.service';
import { ToastService } from './toast.service';
import { VaultEntry, EntryCategory, CustomField } from '../models/vault.model';
import { sanitizeWebUrl, sanitizeDisplayText } from '../security/sanitizer';

export interface CreateEntryDto {
  category?: EntryCategory;
  title: string;
  website?: string;
  username?: string;
  password?: string;
  notes?: string;
  favorite?: boolean;
  totpSecret?: string;
  customFields?: CustomField[];
}

export interface UpdateEntryDto extends Partial<CreateEntryDto> {
  id: string;
}

export interface CategoryCounts {
  all: number;
  favorites: number;
  login: number;
  secure_note: number;
  credit_card: number;
  identity: number;
  server: number;
}

@Injectable({
  providedIn: 'root'
})
export class EntryService {
  private readonly vaultService = inject(VaultService);
  private readonly toast = inject(ToastService);

  // Filter and Search Signals
  public readonly searchQuery = signal<string>('');
  public readonly selectedCategory = signal<string>('all');
  public readonly sortBy = signal<'title' | 'updatedAt' | 'createdAt'>('title');
  public readonly sortDirection = signal<'asc' | 'desc'>('asc');

  // Vault entries reactive signal
  public readonly entries = computed(() => this.vaultService.entries());

  // Category counts computed signal
  public readonly categoryCounts = computed<CategoryCounts>(() => {
    const list = this.entries();
    const counts: CategoryCounts = {
      all: list.length,
      favorites: 0,
      login: 0,
      secure_note: 0,
      credit_card: 0,
      identity: 0,
      server: 0
    };

    for (const entry of list) {
      if (entry.favorite) counts.favorites++;
      if (entry.category in counts) {
        counts[entry.category as keyof Omit<CategoryCounts, 'all' | 'favorites'>]++;
      }
    }

    return counts;
  });

  // Filtered and sorted entries computed signal
  public readonly filteredEntries = computed<VaultEntry[]>(() => {
    const list = this.entries();
    const query = this.searchQuery().toLowerCase().trim();
    const cat = this.selectedCategory();
    const field = this.sortBy();
    const dir = this.sortDirection();

    return list
      .filter(entry => {
        // Category filtering
        if (cat === 'favorites') {
          if (!entry.favorite) return false;
        } else if (cat !== 'all') {
          if (entry.category !== cat) return false;
        }

        // Search query filtering
        if (query) {
          const matchTitle = entry.title?.toLowerCase().includes(query);
          const matchUsername = entry.username?.toLowerCase().includes(query);
          const matchWebsite = entry.website?.toLowerCase().includes(query);
          const matchNotes = entry.notes?.toLowerCase().includes(query);

          const matchCustom = entry.customFields?.some(
            cf => cf.name?.toLowerCase().includes(query) || (!cf.isSecret && cf.value?.toLowerCase().includes(query))
          );

          if (!matchTitle && !matchUsername && !matchWebsite && !matchNotes && !matchCustom) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (field === 'title') {
          cmp = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
        } else if (field === 'updatedAt') {
          cmp = new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
        } else if (field === 'createdAt') {
          cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        }

        return dir === 'desc' ? -cmp : cmp;
      });
  });

  /**
   * Generates a CSPRNG UUID v4.
   */
  private generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback compliant RFC 4122 v4 UUID
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * Adds a new entry to the active decrypted vault and persists to IndexedDB.
   */
  public async addEntry(dto: CreateEntryDto): Promise<VaultEntry> {
    const title = sanitizeDisplayText(dto.title);
    if (!title) {
      throw new Error('Entry title is required.');
    }

    const now = new Date().toISOString();
    const website = dto.website ? sanitizeWebUrl(dto.website) : '';

    const newEntry: VaultEntry = {
      id: this.generateId(),
      category: dto.category || 'login',
      title,
      website,
      username: sanitizeDisplayText(dto.username || ''),
      password: dto.password || '',
      notes: sanitizeDisplayText(dto.notes || ''),
      favorite: Boolean(dto.favorite),
      totpSecret: dto.totpSecret?.trim(),
      customFields: dto.customFields?.map(cf => ({
        id: cf.id || this.generateId(),
        name: sanitizeDisplayText(cf.name),
        value: cf.value,
        isSecret: Boolean(cf.isSecret)
      })),
      createdAt: now,
      updatedAt: now
    };

    await this.vaultService.updateVault(current => ({
      ...current,
      entries: [newEntry, ...current.entries]
    }));

    this.toast.success(`Added "${newEntry.title}" to vault`);
    return newEntry;
  }

  /**
   * Updates an existing entry in the active vault and persists to IndexedDB.
   */
  public async updateEntry(dto: UpdateEntryDto): Promise<VaultEntry> {
    if (!dto.id) {
      throw new Error('Entry ID is required for update.');
    }

    const existing = this.entries().find(e => e.id === dto.id);
    if (!existing) {
      throw new Error(`Entry with ID ${dto.id} not found.`);
    }

    const title = dto.title !== undefined ? sanitizeDisplayText(dto.title) : existing.title;
    if (!title) {
      throw new Error('Entry title cannot be empty.');
    }

    const website = dto.website !== undefined ? sanitizeWebUrl(dto.website) : existing.website;
    const now = new Date().toISOString();

    const updated: VaultEntry = {
      ...existing,
      category: dto.category ?? existing.category,
      title,
      website,
      username: dto.username !== undefined ? sanitizeDisplayText(dto.username) : existing.username,
      password: dto.password !== undefined ? dto.password : existing.password,
      notes: dto.notes !== undefined ? sanitizeDisplayText(dto.notes) : existing.notes,
      favorite: dto.favorite !== undefined ? Boolean(dto.favorite) : existing.favorite,
      totpSecret: dto.totpSecret !== undefined ? dto.totpSecret.trim() : existing.totpSecret,
      customFields: dto.customFields ?? existing.customFields,
      updatedAt: now
    };

    await this.vaultService.updateVault(current => ({
      ...current,
      entries: current.entries.map(e => (e.id === updated.id ? updated : e))
    }));

    this.toast.success(`Updated "${updated.title}"`);
    return updated;
  }

  /**
   * Deletes an entry by ID and persists to IndexedDB.
   */
  public async deleteEntry(id: string): Promise<void> {
    const existing = this.entries().find(e => e.id === id);
    if (!existing) {
      throw new Error(`Entry with ID ${id} not found.`);
    }

    await this.vaultService.updateVault(current => ({
      ...current,
      entries: current.entries.filter(e => e.id !== id)
    }));

    this.toast.info(`Deleted "${existing.title}"`);
  }

  /**
   * Toggles the favorite status of an entry and persists to IndexedDB.
   */
  public async toggleFavorite(id: string): Promise<boolean> {
    const existing = this.entries().find(e => e.id === id);
    if (!existing) {
      throw new Error(`Entry with ID ${id} not found.`);
    }

    const newFav = !existing.favorite;

    await this.vaultService.updateVault(current => ({
      ...current,
      entries: current.entries.map(e => (e.id === id ? { ...e, favorite: newFav, updatedAt: new Date().toISOString() } : e))
    }));

    this.toast.info(newFav ? `Added "${existing.title}" to favorites` : `Removed "${existing.title}" from favorites`);
    return newFav;
  }
}
