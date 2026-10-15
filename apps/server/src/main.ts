import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

// carrega apps/server/.env (Node ≥ 20.12) — funciona igual no Windows, Linux e macOS
try {
  process.loadEnvFile?.(resolve(process.cwd(), '.env'));
} catch {
  /* sem .env: usa as variáveis do ambiente */
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.useBodyParser('json', { limit: '5mb' });

  // Serve o dashboard compilado na mesma porta (opcional): http://IP:3000/s/CODIGO
  const dist = resolve(process.cwd(), process.env.DASHBOARD_DIST ?? '../dashboard/dist');
  if (existsSync(join(dist, 'index.html'))) {
    app.useStaticAssets(dist);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(join(dist, 'index.html'));
    });
    Logger.log(`Dashboard servido de ${dist}`, 'Bootstrap');
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Servidor de telemetria em http://0.0.0.0:${port}`, 'Bootstrap');
}
bootstrap();
