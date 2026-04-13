import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe('AppController', () => {
  let appController: AppController;
  const appServiceMock = {
    getHealth: jest.fn(() => ({ ok: true })),
  };

  beforeEach(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appServiceMock }],
    });
    moduleBuilder.overrideGuard(AuthGuard).useValue({ canActivate: () => true });
    moduleBuilder.overrideGuard(RolesGuard).useValue({ canActivate: () => true });
    const app: TestingModule = await moduleBuilder.compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return health object', () => {
      expect(appController.getHealth()).toEqual({ ok: true });
    });
  });
});
