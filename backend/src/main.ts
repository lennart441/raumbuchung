import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/** Lokale Standard-Origins (Vite, Docker-Frontend, 127.0.0.1); in Dev immer dabei, damit FRONTEND_ORIGIN nicht 5173 blockiert. */
const LOCAL_DEV_DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
];

function uniqueOrigins(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

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

  const corsOrigins =
    nodeEnv === 'production'
      ? (configuredOrigins as string[])
      : uniqueOrigins([...LOCAL_DEV_DEFAULT_ORIGINS, ...(configuredOrigins ?? [])]);

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: corsOrigins,
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
