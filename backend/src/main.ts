import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const configuredOrigins = process.env.FRONTEND_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    nodeEnv === 'production' &&
    (!configuredOrigins || configuredOrigins.length === 0)
  ) {
    throw new Error('FRONTEND_ORIGIN muss in Produktion gesetzt sein');
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: configuredOrigins ?? [
      'http://localhost:5173',
      'http://localhost:8080',
    ],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
