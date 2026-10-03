-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('SALES', 'EXPENSE', 'CONTACT', 'PRODUCT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('LEGAL', 'NATURAL');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('BUYING', 'SELLING');

-- CreateEnum
CREATE TYPE "BalanceSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK');

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#9e9e9e',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "personType" "PersonType" NOT NULL DEFAULT 'LEGAL',
    "title" TEXT NOT NULL,
    "shortName" TEXT,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "categoryId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "address" TEXT,
    "isAbroad" BOOLEAN NOT NULL DEFAULT false,
    "postalCode" TEXT,
    "district" TEXT,
    "city" TEXT,
    "country" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "rateType" "RateType" NOT NULL DEFAULT 'BUYING',
    "openingBalance" DECIMAL(18,2),
    "openingBalanceSide" "BalanceSide",
    "openingBalanceDate" DATE,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactIban" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "bankName" TEXT,

    CONSTRAINT "ContactIban_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPerson" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,

    CONSTRAINT "ContactPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "barcode" TEXT,
    "categoryId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'C62',
    "gtipCode" TEXT,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "stockQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "initialStock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "criticalStock" DECIMAL(18,4),
    "buyPrice" DECIMAL(18,6),
    "buyCurrency" TEXT NOT NULL DEFAULT 'TRY',
    "sellPrice" DECIMAL(18,6),
    "sellCurrency" TEXT NOT NULL DEFAULT 'TRY',
    "vatRate" INTEGER NOT NULL DEFAULT 20,
    "photoPath" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "bankName" TEXT,
    "branch" TEXT,
    "accountNo" TEXT,
    "iban" TEXT,
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingDate" DATE,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_type_name_key" ON "Category"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Contact_kind_isArchived_idx" ON "Contact"("kind", "isArchived");

-- CreateIndex
CREATE INDEX "Contact_taxNumber_idx" ON "Contact"("taxNumber");

-- CreateIndex
CREATE INDEX "Contact_title_idx" ON "Contact"("title");

-- CreateIndex
CREATE INDEX "ContactIban_contactId_idx" ON "ContactIban"("contactId");

-- CreateIndex
CREATE INDEX "ContactPerson_contactId_idx" ON "ContactPerson"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE INDEX "Product_isArchived_idx" ON "Product"("isArchived");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Account_type_isArchived_idx" ON "Account"("type", "isArchived");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIban" ADD CONSTRAINT "ContactIban_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPerson" ADD CONSTRAINT "ContactPerson_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
