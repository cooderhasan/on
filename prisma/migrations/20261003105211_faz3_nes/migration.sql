-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "eInvoiceAlias" TEXT,
ADD COLUMN     "eInvoiceCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DocumentLine" ADD COLUMN     "otvCode" TEXT,
ADD COLUMN     "vatExemptionCode" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "eDocAnswer" TEXT,
ADD COLUMN     "eDocCheckedAt" TIMESTAMP(3),
ADD COLUMN     "returnRefDate" DATE,
ADD COLUMN     "returnRefNo" TEXT;

-- CreateTable
CREATE TABLE "EInvoiceSettings" (
    "id" TEXT NOT NULL DEFAULT 'nes',
    "apiUrl" TEXT NOT NULL DEFAULT 'https://apitest.nes.com.tr/',
    "apiKeyEnc" TEXT,
    "apiKeyLast4" TEXT,
    "senderAlias" TEXT,
    "eInvoiceSeries" TEXT,
    "eArchiveSeries" TEXT,
    "defaultProfile" TEXT NOT NULL DEFAULT 'TICARIFATURA',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceSettings_pkey" PRIMARY KEY ("id")
);
