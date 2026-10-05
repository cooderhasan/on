-- Başlangıç stoku artık "açılış" stok hareketi (varsayılan depoda). Güncel stok değişmez:
-- önceden stockQuantity = initialStock + fatura hareketleri idi, şimdi = tüm hareketlerin toplamı.
INSERT INTO "StockMovement" ("id", "productId", "warehouseId", "quantity", "date", "source", "note", "createdAt")
SELECT 'acilis_' || p."id", p."id", 'ana-depo', p."initialStock", (p."createdAt" AT TIME ZONE 'Europe/Istanbul')::date, 'OPENING', 'Başlangıç stoku', p."createdAt"
FROM "Product" p
WHERE p."trackStock" AND p."initialStock" <> 0;
