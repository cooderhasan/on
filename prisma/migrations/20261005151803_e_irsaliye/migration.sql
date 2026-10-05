-- AlterTable
ALTER TABLE "EInvoiceSettings" ADD COLUMN     "despatchSenderAlias" TEXT,
ADD COLUMN     "despatchSeries" TEXT;

-- AlterTable
ALTER TABLE "Waybill" ADD COLUMN     "carrierTaxNumber" TEXT,
ADD COLUMN     "carrierTitle" TEXT,
ADD COLUMN     "dispatchTime" TEXT,
ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "driverTckn" TEXT,
ADD COLUMN     "eDocAnswer" TEXT,
ADD COLUMN     "eDocCheckedAt" TIMESTAMP(3),
ADD COLUMN     "eDocError" TEXT,
ADD COLUMN     "eDocSentAt" TIMESTAMP(3),
ADD COLUMN     "eDocStatus" "EDocStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "eDocUuid" TEXT,
ADD COLUMN     "trailerPlate" TEXT,
ADD COLUMN     "vehiclePlate" TEXT;

-- CreateTable
CREATE TABLE "IncomingDespatch" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "documentNumber" TEXT,
    "issueDate" DATE NOT NULL,
    "senderTaxNumber" TEXT,
    "senderTitle" TEXT NOT NULL,
    "answer" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" "IncomingStatus" NOT NULL DEFAULT 'NEW',
    "waybillId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomingDespatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomingDespatch_uuid_key" ON "IncomingDespatch"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingDespatch_waybillId_key" ON "IncomingDespatch"("waybillId");

-- CreateIndex
CREATE INDEX "IncomingDespatch_status_receivedAt_idx" ON "IncomingDespatch"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Waybill_eDocUuid_key" ON "Waybill"("eDocUuid");

-- AddForeignKey
ALTER TABLE "IncomingDespatch" ADD CONSTRAINT "IncomingDespatch_waybillId_fkey" FOREIGN KEY ("waybillId") REFERENCES "Waybill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

