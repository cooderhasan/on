-- CreateTable
CREATE TABLE "CompanyLogo" (
    "id" TEXT NOT NULL DEFAULT 'firma',
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyLogo_pkey" PRIMARY KEY ("id")
);
