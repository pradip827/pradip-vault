import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
    expect(service.toasts().length).toBe(0);
  });

  it('should add success toast to active list', () => {
    service.success('Operation succeeded', 0);
    const list = service.toasts();
    expect(list.length).toBe(1);
    expect(list[0].message).toBe('Operation succeeded');
    expect(list[0].type).toBe('success');
  });

  it('should dismiss toast by id', () => {
    const id = service.info('Test dismiss', 0);
    expect(service.toasts().length).toBe(1);
    service.dismiss(id);
    expect(service.toasts().length).toBe(0);
  });
});
