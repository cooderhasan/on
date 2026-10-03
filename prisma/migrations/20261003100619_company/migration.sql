-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL DEFAULT 'firma',
    "title" TEXT NOT NULL,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "address" TEXT,
    "district" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "sector" TEXT,
    "mersisNo" TEXT,
    "tradeRegNo" TEXT,
    "logoPath" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
