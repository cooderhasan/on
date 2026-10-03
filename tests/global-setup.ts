import "dotenv/config";
import { execSync } from "node:child_process";

/** Test veritabanına migration'ları uygular. Gerçek veritabanına asla dokunmaz. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL tanımlı değil (.env).");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL, DATABASE_URL ile aynı olamaz — testler veritabanını siler.");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
