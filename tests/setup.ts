import "dotenv/config";

// Uygulama kodu DATABASE_URL okur → testlerde test veritabanına yönlendirilir (db.ts import edilmeden önce)
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
