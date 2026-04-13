import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppService } from './app.service';
import { AppController } from './app.controller';
import { PrismaService } from './prisma.service';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { MailService } from './mail.service';
import { AuthentikProfileService } from './auth/authentik-profile.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    AuthGuard,
    RolesGuard,
    MailService,
    AuthentikProfileService,
  ],
})
export class AppModule {}
