import { TestBed } from '@angular/core/testing';
import { PwaService } from './pwa.service';
import { ToastService } from './toast.service';

describe('PwaService', () => {
  let service: PwaService;
  let toastService: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PwaService, ToastService]
    });

    service = TestBed.inject(PwaService);
    toastService = TestBed.inject(ToastService);
  });

  it('should be created and have initial online state', () => {
    expect(service).toBeTruthy();
    expect(typeof service.isOnline()).toBe('boolean');
    expect(service.swRegistered()).toBe(false);
    expect(service.updateAvailable()).toBe(false);
  });

  it('should react to offline and online window events', () => {
    const warningSpy = vi.spyOn(toastService, 'warning');
    const successSpy = vi.spyOn(toastService, 'success');

    service.init();

    // Trigger offline
    window.dispatchEvent(new Event('offline'));
    expect(service.isOnline()).toBe(false);
    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining('Offline mode active'),
      expect.any(Number)
    );

    // Trigger online
    window.dispatchEvent(new Event('online'));
    expect(service.isOnline()).toBe(true);
    expect(successSpy).toHaveBeenCalledWith('Back online.');
  });

  it('should capture beforeinstallprompt and enable canInstall', async () => {
    service.init();
    expect(service.canInstall()).toBe(false);

    let promptCalled = false;
    const mockEvent = new Event('beforeinstallprompt') as any;
    mockEvent.prompt = vi.fn().mockImplementation(() => {
      promptCalled = true;
    });
    mockEvent.userChoice = Promise.resolve({ outcome: 'accepted' });

    window.dispatchEvent(mockEvent);
    expect(service.canInstall()).toBe(true);

    // Now call promptInstall
    const accepted = await service.promptInstall();
    expect(promptCalled).toBe(true);
    expect(accepted).toBe(true);
    expect(service.canInstall()).toBe(false);
  });

  it('should handle appinstalled event', () => {
    const successSpy = vi.spyOn(toastService, 'success');
    service.init();

    window.dispatchEvent(new Event('appinstalled'));
    expect(service.isInstalled()).toBe(true);
    expect(service.canInstall()).toBe(false);
    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('installed successfully'));
  });

  it('should return false for promptInstall when no deferredPrompt is available', async () => {
    const result = await service.promptInstall();
    expect(result).toBe(false);
  });

  it('should gracefully handle checkForUpdate when no service worker registration is active', async () => {
    const hasUpdate = await service.checkForUpdate();
    expect(hasUpdate).toBe(false);
  });
});
