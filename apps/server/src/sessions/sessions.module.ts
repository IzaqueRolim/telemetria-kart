import { Module } from '@nestjs/common';
import { MemoryDb } from '../prisma/memory-db';
import { PrismaService } from '../prisma/prisma.service';
import { RaceGateway } from './race.gateway';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [SessionsController],
  providers: [
    {
      provide: PrismaService,
      // DB_DRIVER=memory roda sem PostgreSQL (demonstração / simulador)
      useFactory: () => (process.env.DB_DRIVER === 'memory' ? (new MemoryDb() as unknown as PrismaService) : new PrismaService()),
    },
    SessionsService,
    RaceGateway,
  ],
})
export class SessionsModule {}
