import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../components/common/button/button.component';
import { InputComponent } from '../../components/common/input/input.component';
import { BadgeComponent } from '../../components/common/badge/badge.component';
import { ModalComponent } from '../../components/common/modal/modal.component';
import { IconComponent, IconName } from '../../components/common/icon/icon.component';
import { PasswordGeneratorComponent } from '../../components/common/password-generator/password-generator.component';
import { ToastService } from '../../core/services/toast.service';
import { VaultService } from '../../core/services/vault.service';
import { AutoLockService } from '../../core/services/autolock.service';
import { EntryService, CreateEntryDto } from '../../core/services/entry.service';
import { VaultEntry, EntryCategory } from '../../core/models/vault.model';
import { getSafeExternalLinkProps } from '../../core/security/sanitizer';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    BadgeComponent,
    ModalComponent,
    IconComponent,
    PasswordGeneratorComponent
  ],
  template: `
    <!-- Guard: Vault is locked view -->
    @if (vaultService.isLocked()) {
      <div class="locked-vault-card">
        <div class="locked-icon-wrap">
          <app-icon name="lock" [size]="36" />
        </div>
        <h2>Vault is Locked</h2>
        <p>Unlock your vault with your master password to view, search, and manage your credentials.</p>
        <app-button variant="primary" size="lg" (clicked)="navigateToUnlock()">
          <app-icon name="unlock" [size]="18" />
          Unlock Vault
        </app-button>
      </div>
    } @else {
      <div class="dashboard-wrap">
        <!-- Top Toolbar -->
        <div class="dashboard-toolbar">
          <div class="search-box">
            <app-icon name="search" [size]="18" class="search-icon" />
            <input
              type="search"
              class="search-input"
              placeholder="Search title, username, website, notes..."
              [value]="entryService.searchQuery()"
              (input)="handleSearchInput($event)"
              id="dashboard-search-input"
            />
            @if (entryService.searchQuery()) {
              <button
                type="button"
                class="search-clear-btn"
                (click)="clearSearch()"
                aria-label="Clear search"
              >
                <app-icon name="close" [size]="14" />
              </button>
            }
          </div>

          <div class="toolbar-actions">
            <!-- Sort Selector -->
            <div class="sort-control">
              <select
                class="sort-select"
                [value]="entryService.sortBy()"
                (change)="handleSortChange($event)"
                aria-label="Sort entries by"
              >
                <option value="title">Sort: Title</option>
                <option value="updatedAt">Sort: Recently Updated</option>
                <option value="createdAt">Sort: Date Added</option>
              </select>

              <button
                type="button"
                class="sort-dir-btn"
                (click)="toggleSortDirection()"
                [title]="entryService.sortDirection() === 'asc' ? 'Ascending' : 'Descending'"
                aria-label="Toggle sort direction"
              >
                <app-icon [name]="entryService.sortDirection() === 'asc' ? 'arrow-right' : 'arrow-right'" [size]="14" />
                <span>{{ entryService.sortDirection() === 'asc' ? 'A-Z' : 'Z-A' }}</span>
              </button>
            </div>

            <app-button variant="primary" (clicked)="openAddModal()" id="btn-add-entry">
              <app-icon name="plus" [size]="16" />
              Add Entry
            </app-button>
          </div>
        </div>

        <!-- Categories Navigation Tabs -->
        <div class="category-tabs" role="tablist">
          <button
            type="button"
            class="tab-item"
            [class.active]="entryService.selectedCategory() === 'all'"
            (click)="entryService.selectedCategory.set('all')"
            role="tab"
          >
            All Items
            <span class="tab-count">{{ entryService.categoryCounts().all }}</span>
          </button>

          <button
            type="button"
            class="tab-item"
            [class.active]="entryService.selectedCategory() === 'favorites'"
            (click)="entryService.selectedCategory.set('favorites')"
            role="tab"
          >
            <app-icon name="star" [size]="14" />
            Favorites
            <span class="tab-count">{{ entryService.categoryCounts().favorites }}</span>
          </button>

          <button
            type="button"
            class="tab-item"
            [class.active]="entryService.selectedCategory() === 'login'"
            (click)="entryService.selectedCategory.set('login')"
            role="tab"
          >
            <app-icon name="lock" [size]="14" />
            Logins
            <span class="tab-count">{{ entryService.categoryCounts().login }}</span>
          </button>

          <button
            type="button"
            class="tab-item"
            [class.active]="entryService.selectedCategory() === 'secure_note'"
            (click)="entryService.selectedCategory.set('secure_note')"
            role="tab"
          >
            <app-icon name="shield" [size]="14" />
            Secure Notes
            <span class="tab-count">{{ entryService.categoryCounts().secure_note }}</span>
          </button>

          <button
            type="button"
            class="tab-item"
            [class.active]="entryService.selectedCategory() === 'credit_card'"
            (click)="entryService.selectedCategory.set('credit_card')"
            role="tab"
          >
            <app-icon name="key" [size]="14" />
            Credit Cards
            <span class="tab-count">{{ entryService.categoryCounts().credit_card }}</span>
          </button>

          <button
            type="button"
            class="tab-item"
            [class.active]="entryService.selectedCategory() === 'identity'"
            (click)="entryService.selectedCategory.set('identity')"
            role="tab"
          >
            <app-icon name="smartphone" [size]="14" />
            Identities
            <span class="tab-count">{{ entryService.categoryCounts().identity }}</span>
          </button>

          <button
            type="button"
            class="tab-item"
            [class.active]="entryService.selectedCategory() === 'server'"
            (click)="entryService.selectedCategory.set('server')"
            role="tab"
          >
            <app-icon name="cloud" [size]="14" />
            Servers
            <span class="tab-count">{{ entryService.categoryCounts().server }}</span>
          </button>
        </div>

        <!-- Entries Grid -->
        <div class="entries-grid">
          @for (entry of entryService.filteredEntries(); track entry.id) {
            <div class="entry-card" (click)="openDetailModal(entry)">
              <div class="entry-header">
                <div class="entry-meta">
                  <div class="entry-icon">
                    <app-icon [name]="getCategoryIcon(entry.category)" [size]="20" />
                  </div>
                  <div class="entry-title-wrap">
                    <h4 class="entry-title">{{ entry.title }}</h4>
                    <span class="entry-subtitle">{{ entry.username || getCategoryLabel(entry.category) }}</span>
                  </div>
                </div>

                <button
                  type="button"
                  class="favorite-btn"
                  [class.is-fav]="entry.favorite"
                  (click)="toggleFavorite($event, entry)"
                  aria-label="Toggle favorite"
                >
                  <app-icon name="star" [size]="18" />
                </button>
              </div>

              <div class="entry-body">
                @if (entry.website) {
                  <div class="entry-website">
                    <app-icon name="external-link" [size]="12" />
                    <span>{{ getDisplayUrl(entry.website) }}</span>
                  </div>
                } @else if (entry.notes) {
                  <div class="entry-notes-preview">
                    {{ entry.notes }}
                  </div>
                }
              </div>

              <div class="entry-actions" (click)="$event.stopPropagation()">
                @if (entry.username) {
                  <app-button variant="ghost" size="sm" (clicked)="copyText($event, entry.username, 'username')">
                    <app-icon name="copy" [size]="14" />
                    Copy User
                  </app-button>
                }
                @if (entry.password) {
                  <app-button variant="secondary" size="sm" (clicked)="copyPassword($event, entry)">
                    <app-icon name="key" [size]="14" />
                    Copy Pass
                  </app-button>
                }
              </div>
            </div>
          } @empty {
            @if (entryService.entries().length === 0) {
              <!-- Empty vault: 0 entries total -->
              <div class="empty-state">
                <div class="empty-icon">
                  <app-icon name="lock" [size]="48" />
                </div>
                <h3>Your vault is empty</h3>
                <p>Start securing your credentials with zero-knowledge AES-256-GCM encryption.</p>
                <app-button variant="primary" size="md" (clicked)="openAddModal()">
                  <app-icon name="plus" [size]="16" />
                  Add First Entry
                </app-button>
              </div>
            } @else {
              <!-- Filtered empty state -->
              <div class="empty-state">
                <div class="empty-icon">
                  <app-icon name="search" [size]="40" />
                </div>
                <h3>No matching entries</h3>
                <p>No credentials match your current search or category filter.</p>
                <app-button variant="secondary" size="sm" (clicked)="resetFilters()">
                  Clear Filters
                </app-button>
              </div>
            }
          }
        </div>

        <!-- Add Entry Modal -->
        <app-modal
          [isOpen]="isAddModalOpen()"
          title="Add New Credential"
          description="Encrypted locally using AES-256-GCM with unique CSPRNG IV"
          size="md"
          (closed)="isAddModalOpen.set(false)"
        >
          <div class="modal-form-fields">
            <div class="form-group">
              <label class="form-label" for="add-category">Category</label>
              <select
                id="add-category"
                class="form-select"
                [value]="formCategory()"
                (change)="handleCategoryChange($event)"
              >
                <option value="login">Login Credentials</option>
                <option value="secure_note">Secure Note</option>
                <option value="credit_card">Credit Card</option>
                <option value="identity">Identity</option>
                <option value="server">Server / Infrastructure</option>
              </select>
            </div>

            <app-input
              label="Title"
              placeholder="e.g. GitHub, Google, Wi-Fi"
              [value]="formTitle()"
              [required]="true"
              (valueChange)="formTitle.set($event)"
            />

            @if (formCategory() === 'login' || formCategory() === 'server') {
              <app-input
                label="Website URL"
                placeholder="https://example.com"
                [value]="formWebsite()"
                (valueChange)="formWebsite.set($event)"
              />
            }

            @if (formCategory() !== 'secure_note') {
              <app-input
                [label]="formCategory() === 'credit_card' ? 'Cardholder Name / Number' : 'Username / Email'"
                [placeholder]="formCategory() === 'credit_card' ? 'Cardholder (Card ending in 1234)' : 'username or email'"
                [value]="formUsername()"
                (valueChange)="formUsername.set($event)"
              />
            }

            <div class="password-field-wrap">
              <app-input
                [label]="formCategory() === 'credit_card' ? 'PIN / CVV' : 'Password'"
                type="password"
                placeholder="Enter password or secret"
                [value]="formPassword()"
                (valueChange)="formPassword.set($event)"
              />
              <button
                type="button"
                class="btn-generator-inline"
                (click)="openGenerator()"
                title="Generate secure password or passphrase"
                aria-label="Generate secure password"
                id="btn-generate-in-add"
              >
                <app-icon name="key" [size]="12" />
                <span>Generate</span>
              </button>
            </div>

            <div class="form-group">
              <label class="form-label" for="add-notes">Notes</label>
              <textarea
                id="add-notes"
                class="form-textarea"
                rows="3"
                placeholder="Additional notes, recovery codes, or security questions..."
                [value]="formNotes()"
                (input)="handleNotesInput($event)"
              ></textarea>
            </div>

            <label class="checkbox-row">
              <input
                type="checkbox"
                [checked]="formFavorite()"
                (change)="formFavorite.set(!formFavorite())"
              />
              <span>Add to Favorites</span>
            </label>
          </div>

          <div footer>
            <app-button variant="secondary" (clicked)="isAddModalOpen.set(false)">Cancel</app-button>
            <app-button variant="primary" (clicked)="saveNewEntry()" id="btn-save-new-entry">
              Save to Vault
            </app-button>
          </div>
        </app-modal>

        <!-- View / Detail Modal -->
        <app-modal
          [isOpen]="isDetailModalOpen()"
          [title]="selectedEntry()?.title || 'Credential Details'"
          description="Encrypted Vault Item"
          size="md"
          (closed)="isDetailModalOpen.set(false)"
        >
          @if (selectedEntry(); as entry) {
            <div class="detail-fields">
              <div class="detail-top-bar">
                <app-badge variant="accent" size="sm">
                  {{ getCategoryLabel(entry.category) | uppercase }}
                </app-badge>
                <span class="detail-timestamp">Updated {{ entry.updatedAt | date:'mediumDate' }}</span>
              </div>

              @if (entry.username) {
                <div class="detail-row">
                  <span class="detail-label">{{ entry.category === 'credit_card' ? 'Cardholder / Number' : 'Username' }}</span>
                  <div class="detail-val-row">
                    <code>{{ entry.username }}</code>
                    <app-button variant="ghost" size="sm" (clicked)="copyText($event, entry.username, 'username')">
                      <app-icon name="copy" [size]="14" />
                    </app-button>
                  </div>
                </div>
              }

              @if (entry.password) {
                <div class="detail-row">
                  <span class="detail-label">{{ entry.category === 'credit_card' ? 'PIN / CVV' : 'Password' }}</span>
                  <div class="detail-val-row">
                    <code>{{ showPasswordInDetail() ? entry.password : '••••••••••••••••' }}</code>
                    <div class="val-actions">
                      <app-button
                        variant="ghost"
                        size="sm"
                        (clicked)="showPasswordInDetail.set(!showPasswordInDetail())"
                        [title]="showPasswordInDetail() ? 'Hide Password' : 'Show Password'"
                      >
                        <app-icon [name]="showPasswordInDetail() ? 'eye-off' : 'eye'" [size]="14" />
                      </app-button>
                      <app-button variant="ghost" size="sm" (clicked)="copyPassword($event, entry)">
                        <app-icon name="copy" [size]="14" />
                      </app-button>
                    </div>
                  </div>
                </div>
              }

              @if (entry.website) {
                <div class="detail-row">
                  <span class="detail-label">Website</span>
                  <div class="detail-val-row">
                    <a
                      [href]="entry.website"
                      [rel]="safeLinkProps.rel"
                      [target]="safeLinkProps.target"
                      class="detail-link"
                    >
                      {{ entry.website }}
                      <app-icon name="external-link" [size]="12" />
                    </a>
                    <app-button variant="ghost" size="sm" (clicked)="copyText($event, entry.website, 'website')">
                      <app-icon name="copy" [size]="14" />
                    </app-button>
                  </div>
                </div>
              }

              @if (entry.notes) {
                <div class="detail-row">
                  <span class="detail-label">Notes</span>
                  <div class="detail-notes-box">
                    {{ entry.notes }}
                  </div>
                </div>
              }
            </div>
          }

          <div footer class="detail-modal-footer">
            <div class="footer-left">
              <app-button variant="danger" size="sm" (clicked)="openDeleteConfirm()">
                <app-icon name="trash" [size]="14" />
                Delete
              </app-button>
            </div>
            <div class="footer-right">
              <app-button variant="secondary" (clicked)="openEditModal()">
                <app-icon name="edit" [size]="14" />
                Edit
              </app-button>
              <app-button variant="primary" (clicked)="isDetailModalOpen.set(false)">Close</app-button>
            </div>
          </div>
        </app-modal>

        <!-- Edit Entry Modal -->
        <app-modal
          [isOpen]="isEditModalOpen()"
          title="Edit Credential"
          description="Changes will be re-encrypted and saved to IndexedDB"
          size="md"
          (closed)="isEditModalOpen.set(false)"
        >
          <div class="modal-form-fields">
            <div class="form-group">
              <label class="form-label" for="edit-category">Category</label>
              <select
                id="edit-category"
                class="form-select"
                [value]="formCategory()"
                (change)="handleCategoryChange($event)"
              >
                <option value="login">Login Credentials</option>
                <option value="secure_note">Secure Note</option>
                <option value="credit_card">Credit Card</option>
                <option value="identity">Identity</option>
                <option value="server">Server / Infrastructure</option>
              </select>
            </div>

            <app-input
              label="Title"
              [value]="formTitle()"
              [required]="true"
              (valueChange)="formTitle.set($event)"
            />

            @if (formCategory() === 'login' || formCategory() === 'server') {
              <app-input
                label="Website URL"
                [value]="formWebsite()"
                (valueChange)="formWebsite.set($event)"
              />
            }

            @if (formCategory() !== 'secure_note') {
              <app-input
                [label]="formCategory() === 'credit_card' ? 'Cardholder Name / Number' : 'Username / Email'"
                [value]="formUsername()"
                (valueChange)="formUsername.set($event)"
              />
            }

            <div class="password-field-wrap">
              <app-input
                [label]="formCategory() === 'credit_card' ? 'PIN / CVV' : 'Password'"
                type="password"
                [value]="formPassword()"
                (valueChange)="formPassword.set($event)"
              />
              <button
                type="button"
                class="btn-generator-inline"
                (click)="openGenerator()"
                title="Generate secure password or passphrase"
                aria-label="Generate secure password"
                id="btn-generate-in-edit"
              >
                <app-icon name="key" [size]="12" />
                <span>Generate</span>
              </button>
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-notes">Notes</label>
              <textarea
                id="edit-notes"
                class="form-textarea"
                rows="3"
                [value]="formNotes()"
                (input)="handleNotesInput($event)"
              ></textarea>
            </div>

            <label class="checkbox-row">
              <input
                type="checkbox"
                [checked]="formFavorite()"
                (change)="formFavorite.set(!formFavorite())"
              />
              <span>Favorite</span>
            </label>
          </div>

          <div footer>
            <app-button variant="secondary" (clicked)="isEditModalOpen.set(false)">Cancel</app-button>
            <app-button variant="primary" (clicked)="saveEditedEntry()">Save Changes</app-button>
          </div>
        </app-modal>

        <!-- Delete Confirmation Modal -->
        <app-modal
          [isOpen]="isDeleteConfirmOpen()"
          title="Delete Credential"
          description="Confirm irreversible deletion"
          size="sm"
          (closed)="isDeleteConfirmOpen.set(false)"
        >
          <p class="delete-warning-text">
            Are you sure you want to permanently delete <strong>{{ selectedEntry()?.title }}</strong>?
            This will remove the entry from the encrypted vault and cannot be undone.
          </p>

          <div footer>
            <app-button variant="secondary" (clicked)="isDeleteConfirmOpen.set(false)">Cancel</app-button>
            <app-button variant="danger" (clicked)="confirmDeleteEntry()">
              <app-icon name="trash" [size]="14" />
              Delete Permanently
            </app-button>
          </div>
        </app-modal>

        <!-- Password Generator Modal -->
        <app-modal
          [isOpen]="isGeneratorOpen()"
          title="Generate Password"
          description="CSPRNG unbiased selection with Shannon entropy scoring"
          size="md"
          (closed)="isGeneratorOpen.set(false)"
        >
          <app-password-generator
            (passwordSelected)="applyGeneratedPassword($event)"
            (cancelled)="isGeneratorOpen.set(false)"
          />
        </app-modal>
      </div>
    }
  `,
  styles: [`
    .dashboard-wrap {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      width: 100%;
    }

    /* Locked state card */
    .locked-vault-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 1.25rem;
      padding: 4rem 2rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl);
      max-width: 500px;
      margin: 3rem auto;
      box-shadow: var(--shadow-lg);
    }

    .locked-icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      border-radius: var(--radius-full);
      background: var(--accent-subtle);
      color: var(--accent-primary);
    }

    .locked-vault-card h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0;
    }

    .locked-vault-card p {
      font-size: 0.9375rem;
      color: var(--text-secondary);
      line-height: 1.5;
      margin: 0;
    }

    /* Toolbar */
    .dashboard-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 260px;
      max-width: 520px;
    }

    .search-icon {
      position: absolute;
      left: 0.875rem;
      color: var(--text-muted);
      pointer-events: none;
    }

    .search-clear-btn {
      position: absolute;
      right: 0.75rem;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-full);
      transition: color var(--transition-fast);
    }

    .search-clear-btn:hover {
      color: var(--text-primary);
    }

    .search-input {
      width: 100%;
      height: 42px;
      padding: 0 2.25rem 0 2.5rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 0.875rem;
      transition: all var(--transition-fast);
      outline: none;
    }

    .search-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--accent-subtle);
    }

    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .sort-control {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 0.25rem 0.5rem;
    }

    .sort-select {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 0.8125rem;
      font-weight: 600;
      outline: none;
      cursor: pointer;
    }

    .sort-dir-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      padding: 0.2rem 0.35rem;
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }

    .sort-dir-btn:hover {
      color: var(--text-primary);
      background: var(--bg-surface-elevated);
    }

    /* Category tabs */
    .category-tabs {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.35rem;
      scrollbar-width: thin;
    }

    .tab-item {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.85rem;
      border-radius: var(--radius-md);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }

    .tab-item:hover {
      color: var(--text-primary);
      background: var(--bg-surface-hover);
    }

    .tab-item.active {
      color: var(--text-primary);
      background: var(--accent-subtle);
      border-color: var(--accent-glow);
    }

    .tab-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      padding: 0.1rem 0.4rem;
      border-radius: var(--radius-full);
      background: var(--bg-surface-elevated);
      color: var(--text-muted);
    }

    .tab-item.active .tab-count {
      background: var(--accent-primary);
      color: #ffffff;
    }

    /* Entries Grid */
    .entries-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }

    .entry-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.25rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all var(--transition-normal);
    }

    .entry-card:hover {
      border-color: var(--border-medium);
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .entry-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .entry-meta {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      overflow: hidden;
    }

    .entry-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border-radius: var(--radius-md);
      background: var(--bg-surface-elevated);
      color: var(--accent-primary);
      flex-shrink: 0;
    }

    .entry-title-wrap {
      overflow: hidden;
    }

    .entry-title {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .entry-subtitle {
      font-size: 0.8125rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }

    .favorite-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.25rem;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: color var(--transition-fast);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .favorite-btn:hover,
    .favorite-btn.is-fav {
      color: var(--status-warning);
    }

    .entry-body {
      min-height: 20px;
    }

    .entry-website {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .entry-notes-preview {
      font-size: 0.75rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .entry-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border-subtle);
    }

    /* Empty State */
    .empty-state {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.75rem;
      padding: 4rem 1.5rem;
      color: var(--text-muted);
      background: var(--bg-surface);
      border: 1px dashed var(--border-subtle);
      border-radius: var(--radius-xl);
    }

    .empty-icon {
      color: var(--text-muted);
      opacity: 0.5;
    }

    .empty-state h3 {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0;
    }

    .empty-state p {
      font-size: 0.875rem;
      color: var(--text-secondary);
      max-width: 400px;
      margin: 0;
    }

    /* Modal form fields */
    .modal-form-fields {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .form-label {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .form-select,
    .form-textarea {
      width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 0.875rem;
      padding: 0.65rem 0.85rem;
      outline: none;
      transition: all var(--transition-fast);
      font-family: inherit;
    }

    .form-select:focus,
    .form-textarea:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--accent-subtle);
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
    }

    .checkbox-row input {
      accent-color: var(--accent-primary);
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    /* Detail Modal */
    .detail-fields {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .detail-top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }

    .detail-timestamp {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .detail-row {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .detail-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .detail-val-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      background: var(--bg-surface-elevated);
      padding: 0.5rem 0.75rem;
      border-radius: var(--radius-sm);
    }

    .val-actions {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .detail-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--accent-primary);
      font-size: 0.875rem;
      word-break: break-all;
      text-decoration: none;
    }

    .detail-link:hover {
      text-decoration: underline;
    }

    .detail-notes-box {
      background: var(--bg-surface-elevated);
      padding: 0.75rem;
      border-radius: var(--radius-sm);
      font-size: 0.875rem;
      color: var(--text-primary);
      white-space: pre-wrap;
      max-height: 160px;
      overflow-y: auto;
      line-height: 1.5;
    }

    .detail-modal-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }

    .footer-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .delete-warning-text {
      font-size: 0.9375rem;
      color: var(--text-secondary);
      line-height: 1.5;
      margin: 0;
    }

    code {
      font-family: monospace;
      font-size: 0.875rem;
      color: var(--text-primary);
      word-break: break-all;
    }

    .password-field-wrap {
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .btn-generator-inline {
      position: absolute;
      top: 0;
      right: 0;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      color: var(--accent-primary);
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      cursor: pointer;
      transition: all var(--transition-fast);
      z-index: 2;
    }

    .btn-generator-inline:hover {
      background: var(--accent-subtle);
      border-color: var(--accent-glow);
    }
  `]
})
export class DashboardComponent {
  public readonly vaultService = inject(VaultService);
  public readonly entryService = inject(EntryService);
  public readonly autoLockService = inject(AutoLockService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // Safe external link attributes
  public readonly safeLinkProps = getSafeExternalLinkProps();

  // Modal display states
  public readonly isAddModalOpen = signal<boolean>(false);
  public readonly isDetailModalOpen = signal<boolean>(false);
  public readonly isEditModalOpen = signal<boolean>(false);
  public readonly isDeleteConfirmOpen = signal<boolean>(false);
  public readonly isGeneratorOpen = signal<boolean>(false);
  public readonly selectedEntry = signal<VaultEntry | null>(null);
  public readonly showPasswordInDetail = signal<boolean>(false);

  // Form fields for Add & Edit
  public readonly formCategory = signal<EntryCategory>('login');
  public readonly formTitle = signal<string>('');
  public readonly formWebsite = signal<string>('');
  public readonly formUsername = signal<string>('');
  public readonly formPassword = signal<string>('');
  public readonly formNotes = signal<string>('');
  public readonly formFavorite = signal<boolean>(false);

  public openGenerator(): void {
    this.isGeneratorOpen.set(true);
  }

  public applyGeneratedPassword(pwd: string): void {
    this.formPassword.set(pwd);
    this.isGeneratorOpen.set(false);
    this.toast.info('Secure password generated and applied');
  }

  public navigateToUnlock(): void {
    this.router.navigate(['/unlock']);
  }

  public handleSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.entryService.searchQuery.set(val);
  }

  public clearSearch(): void {
    this.entryService.searchQuery.set('');
  }

  public resetFilters(): void {
    this.entryService.searchQuery.set('');
    this.entryService.selectedCategory.set('all');
  }

  public handleSortChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as 'title' | 'updatedAt' | 'createdAt';
    this.entryService.sortBy.set(val);
  }

  public toggleSortDirection(): void {
    const current = this.entryService.sortDirection();
    this.entryService.sortDirection.set(current === 'asc' ? 'desc' : 'asc');
  }

  public handleCategoryChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as EntryCategory;
    this.formCategory.set(val);
  }

  public handleNotesInput(event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    this.formNotes.set(val);
  }

  public getCategoryIcon(category: EntryCategory): IconName {
    switch (category) {
      case 'secure_note':
        return 'shield';
      case 'credit_card':
        return 'key';
      case 'identity':
        return 'smartphone';
      case 'server':
        return 'cloud';
      case 'login':
      default:
        return 'lock';
    }
  }

  public getCategoryLabel(category: EntryCategory): string {
    switch (category) {
      case 'secure_note':
        return 'Secure Note';
      case 'credit_card':
        return 'Credit Card';
      case 'identity':
        return 'Identity';
      case 'server':
        return 'Server';
      case 'login':
      default:
        return 'Login';
    }
  }

  public getDisplayUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  public async toggleFavorite(event: MouseEvent, entry: VaultEntry): Promise<void> {
    event.stopPropagation();
    try {
      await this.entryService.toggleFavorite(entry.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update favorite.';
      this.toast.error(msg);
    }
  }

  public async copyText(event: MouseEvent, text: string, label: string): Promise<void> {
    event.stopPropagation();
    await this.autoLockService.copyToClipboard(text, label);
  }

  public async copyPassword(event: MouseEvent, entry: VaultEntry): Promise<void> {
    event.stopPropagation();
    await this.autoLockService.copyToClipboard(entry.password, `password for ${entry.title}`);
  }

  public openAddModal(): void {
    this.formCategory.set('login');
    this.formTitle.set('');
    this.formWebsite.set('');
    this.formUsername.set('');
    this.formPassword.set('');
    this.formNotes.set('');
    this.formFavorite.set(false);
    this.isAddModalOpen.set(true);
  }

  public async saveNewEntry(): Promise<void> {
    if (!this.formTitle().trim()) {
      this.toast.warning('Title is required.');
      return;
    }

    try {
      await this.entryService.addEntry({
        category: this.formCategory(),
        title: this.formTitle(),
        website: this.formWebsite(),
        username: this.formUsername(),
        password: this.formPassword(),
        notes: this.formNotes(),
        favorite: this.formFavorite()
      });

      this.isAddModalOpen.set(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save entry.';
      this.toast.error(msg);
    }
  }

  public openDetailModal(entry: VaultEntry): void {
    this.selectedEntry.set(entry);
    this.showPasswordInDetail.set(false);
    this.isDetailModalOpen.set(true);
  }

  public openEditModal(): void {
    const entry = this.selectedEntry();
    if (!entry) return;

    this.formCategory.set(entry.category);
    this.formTitle.set(entry.title);
    this.formWebsite.set(entry.website || '');
    this.formUsername.set(entry.username || '');
    this.formPassword.set(entry.password || '');
    this.formNotes.set(entry.notes || '');
    this.formFavorite.set(Boolean(entry.favorite));

    this.isDetailModalOpen.set(false);
    this.isEditModalOpen.set(true);
  }

  public async saveEditedEntry(): Promise<void> {
    const current = this.selectedEntry();
    if (!current) return;

    if (!this.formTitle().trim()) {
      this.toast.warning('Title cannot be empty.');
      return;
    }

    try {
      const updated = await this.entryService.updateEntry({
        id: current.id,
        category: this.formCategory(),
        title: this.formTitle(),
        website: this.formWebsite(),
        username: this.formUsername(),
        password: this.formPassword(),
        notes: this.formNotes(),
        favorite: this.formFavorite()
      });

      this.selectedEntry.set(updated);
      this.isEditModalOpen.set(false);
      this.isDetailModalOpen.set(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update entry.';
      this.toast.error(msg);
    }
  }

  public openDeleteConfirm(): void {
    this.isDetailModalOpen.set(false);
    this.isDeleteConfirmOpen.set(true);
  }

  public async confirmDeleteEntry(): Promise<void> {
    const current = this.selectedEntry();
    if (!current) return;

    try {
      await this.entryService.deleteEntry(current.id);
      this.selectedEntry.set(null);
      this.isDeleteConfirmOpen.set(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete entry.';
      this.toast.error(msg);
    }
  }
}
