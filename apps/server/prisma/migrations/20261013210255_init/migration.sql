-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('LOBBY', 'RUNNING', 'FINISHED');

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "path" JSONB,
    "line" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'LOBBY',
    "hostPilotId" TEXT,
    "targetLaps" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "line" JSONB,
    "trackPath" JSONB,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pilot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "maxSpeedMs" DOUBLE PRECISION,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pilot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsPoint" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "t" BIGINT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crossing" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "t" BIGINT NOT NULL,
    "uncertaintyMs" INTEGER NOT NULL,

    CONSTRAINT "Crossing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lap" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startT" BIGINT NOT NULL,
    "endT" BIGINT NOT NULL,
    "timeMs" INTEGER NOT NULL,
    "uncertaintyMs" INTEGER NOT NULL,

    CONSTRAINT "Lap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Track_nameKey_key" ON "Track"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Session_code_key" ON "Session"("code");

-- CreateIndex
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pilot_sessionId_number_key" ON "Pilot"("sessionId", "number");

-- CreateIndex
CREATE INDEX "GpsPoint_sessionId_t_idx" ON "GpsPoint"("sessionId", "t");

-- CreateIndex
CREATE UNIQUE INDEX "GpsPoint_pilotId_seq_key" ON "GpsPoint"("pilotId", "seq");

-- CreateIndex
CREATE INDEX "Crossing_sessionId_idx" ON "Crossing"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Crossing_pilotId_index_key" ON "Crossing"("pilotId", "index");

-- CreateIndex
CREATE INDEX "Lap_sessionId_idx" ON "Lap"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Lap_pilotId_number_key" ON "Lap"("pilotId", "number");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pilot" ADD CONSTRAINT "Pilot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsPoint" ADD CONSTRAINT "GpsPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsPoint" ADD CONSTRAINT "GpsPoint_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crossing" ADD CONSTRAINT "Crossing_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crossing" ADD CONSTRAINT "Crossing_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lap" ADD CONSTRAINT "Lap_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lap" ADD CONSTRAINT "Lap_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
