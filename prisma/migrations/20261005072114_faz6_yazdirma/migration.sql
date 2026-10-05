-- CreateTable
CREATE TABLE "PrintSettings" (
    "id" TEXT NOT NULL DEFAULT 'yazdir',
    "footerNote" TEXT,
    "bankAccountIds" TEXT[],
    "showAmountInWords" BOOLEAN NOT NULL DEFAULT true,
    "showSignature" BOOLEAN NOT NULL DEFAULT false,
    "showContactBalance" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintSettings_pkey" PRIMARY KEY ("id")
);
