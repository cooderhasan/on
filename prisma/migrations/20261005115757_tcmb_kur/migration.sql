-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "buying" DECIMAL(18,6) NOT NULL,
    "selling" DECIMAL(18,6) NOT NULL,
    "bulletinDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_date_currency_key" ON "ExchangeRate"("date", "currency");
