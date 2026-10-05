-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('RECEIPT', 'SALARY', 'TAX', 'BANK_FEE');

-- CreateEnum
CREATE TYPE "IncomingStatus" AS ENUM ('NEW', 'PROCESSED', 'IGNORED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "expenseId" TEXT;

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "kind" "ExpenseKind" NOT NULL,
    "description" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "categoryId" TEXT,
    "contactId" TEXT,
    "employeeId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "netAmount" DECIMAL(18,2) NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "receiptNo" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tckn" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "iban" TEXT,
    "categoryId" TEXT,
    "startDate" DATE,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomingInvoice" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "documentNumber" TEXT,
    "issueDate" DATE NOT NULL,
    "senderTaxNumber" TEXT,
    "senderTitle" TEXT NOT NULL,
    "profile" TEXT,
    "typeCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "taxExclusive" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payableAmount" DECIMAL(18,2) NOT NULL,
    "answer" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" "IncomingStatus" NOT NULL DEFAULT 'NEW',
    "purchaseInvoiceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_kind_idx" ON "Expense"("kind");

-- CreateIndex
CREATE INDEX "Employee_isArchived_idx" ON "Employee"("isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingInvoice_uuid_key" ON "IncomingInvoice"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingInvoice_purchaseInvoiceId_key" ON "IncomingInvoice"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "IncomingInvoice_issueDate_idx" ON "IncomingInvoice"("issueDate");

-- CreateIndex
CREATE INDEX "IncomingInvoice_status_idx" ON "IncomingInvoice"("status");

-- CreateIndex
CREATE INDEX "Transaction_expenseId_idx" ON "Transaction"("expenseId");

-- CreateIndex
CREATE INDEX "Transaction_employeeId_idx" ON "Transaction"("employeeId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingInvoice" ADD CONSTRAINT "IncomingInvoice_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
