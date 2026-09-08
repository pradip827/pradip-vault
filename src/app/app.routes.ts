import { Routes } from '@angular/router';
import { WelcomeComponent } from './pages/welcome/welcome.component';
import { CreateVaultComponent } from './pages/create-vault/create-vault.component';
import { UnlockComponent } from './pages/unlock/unlock.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { SettingsComponent } from './pages/settings/settings.component';

export const routes: Routes = [
  { path: '', component: WelcomeComponent, pathMatch: 'full' },
  { path: 'create-vault', component: CreateVaultComponent },
  { path: 'unlock', component: UnlockComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'settings', component: SettingsComponent },
  { path: '**', redirectTo: '' }
];
