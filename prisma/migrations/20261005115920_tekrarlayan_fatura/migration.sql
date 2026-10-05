-- CreateEnum
CREATE TYPE "RecurPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "recurringId" TEXT;

-- CreateTable
CREATE TABLE "RecurringInvoice" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "period" "RecurPeriod" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "nextDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringInvoice_templateId_key" ON "RecurringInvoice"("templateId");

-- CreateIndex
CREATE INDEX "RecurringInvoice_isActive_nextDate_idx" ON "RecurringInvoice"("isActive", "nextDate");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
