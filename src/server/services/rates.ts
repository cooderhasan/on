import "server-only";
import Decimal from "decimal.js";
import { XMLParser } from "fast-xml-parser";
import { db } from "@/server/db";
import { AppError } from "@/lib/errors";

/**
 * TCMB döviz kurları. Belge tarihi D için kullanılan kur: D'den önceki son iş gününün bülteni
 * (TCMB her iş günü 15:30'da ertesi gün kullanılacak kuru yayımlar). Hafta sonu / tatilde geriye gidilir.
 * Kurlar veritabanında önbelleğe alınır; TCMB'ye ulaşılamazsa kullanıcı kuru elle girer.
 */

const BASE = "https://www.tcmb.gov.tr/kurlar";
const TIMEOUT_MS = 8000;

export interface TcmbBulletin { bulletinDate: string; rates: Map<string, { buying: Decimal; selling: Decimal }> }

/** TCMB kur XML'i → birim başına alış / satış (JPY gibi 100 birimlik kurlar bölünür) */
export function parseTcmbXml(xml: string): TcmbBulletin {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false }).parse(xml);
  const root = doc?.Tarih_Date;
  if (!root) throw new AppError("EXTERNAL", "TCMB yanıtı okunamadı.");
  const [d, m, y] = String(root["@Tarih"] ?? "").split(".");
  const list = Array.isArray(root.Currency) ? root.Currency : root.Currency ? [root.Currency] : [];
  const rates = new Map<string, { buying: Decimal; selling: Decimal }>();
  for (const c of list) {
    const code = String(c["@CurrencyCode"] ?? c["@Kod"] ?? "");
    const unit = new Decimal(String(c.Unit || "1"));
    const b = String(c.ForexBuying ?? "").trim();
    const s = String(c.ForexSelling ?? "").trim();
    if (!code || !b || !s) continue;
    rates.set(code, { buying: new Decimal(b).dividedBy(unit), selling: new Decimal(s).dividedBy(unit) });
  }
  return { bulletinDate: `${y}-${m}-${d}`, rates };
}

const pad = (n: number) => String(n).padStart(2, "0");

async function fetchBulletin(day: Date): Promise<TcmbBulletin | null> {
  const url = `${BASE}/${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}/${pad(day.getUTCDate())}${pad(day.getUTCMonth() + 1)}${day.getUTCFullYear()}.xml`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/xml" } });
  if (res.status === 404) return null; // hafta sonu / tatil
  if (!res.ok) throw new Error(`TCMB ${res.status}`);
  return parseTcmbXml(await res.text());
}

/** Bugünün en güncel bülteni (today.xml) — henüz yayımlanmamış tarihler için */
async function fetchToday(): Promise<TcmbBulletin> {
  const res = await fetch(`${BASE}/today.xml`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/xml" } });
  if (!res.ok) throw new Error(`TCMB ${res.status}`);
  return parseTcmbXml(await res.text());
}

/** Belge tarihi için TCMB kuru (önbellekli). `date`: YYYY-MM-DD */
export async function tcmbRate(currency: string, date: string): Promise<{ buying: Decimal; selling: Decimal; bulletinDate: string }> {
  if (currency === "TRY") return { buying: new Decimal(1), selling: new Decimal(1), bulletinDate: date };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("VALIDATION", "Tarih geçersiz.");
  const day = new Date(`${date}T00:00:00Z`);
  const cached = await db.exchangeRate.findUnique({ where: { date_currency: { date: day, currency } } });
  if (cached) return { buying: new Decimal(cached.buying.toString()), selling: new Decimal(cached.selling.toString()), bulletinDate: cached.bulletinDate.toISOString().slice(0, 10) };

  let bulletin: TcmbBulletin | null = null;
  try {
    const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
    if (date > todayIso) bulletin = await fetchToday();
    else {
      // Belge tarihinden önceki gün(ler): en fazla 10 gün geriye (uzun tatiller)
      for (let i = 1; i <= 10 && !bulletin; i++) {
        const d = new Date(day.getTime() - i * 86_400_000);
        bulletin = await fetchBulletin(d);
      }
      // Bugünün / dünün bülteni arşive henüz düşmediyse güncel bülten
      if (!bulletin) bulletin = await fetchToday();
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("EXTERNAL", "TCMB'ye ulaşılamadı. Kuru elle girin.");
  }
  const r = bulletin.rates.get(currency);
  if (!r) throw new AppError("EXTERNAL", `TCMB bülteninde ${currency} kuru yok. Kuru elle girin.`);
  // Gelecek tarih için alınan güncel kur önbelleğe yazılmaz (kesin bülten sonra yayımlanır)
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  if (date <= todayIso) {
    await db.exchangeRate.upsert({
      where: { date_currency: { date: day, currency } },
      create: { date: day, currency, buying: r.buying.toString(), selling: r.selling.toString(), bulletinDate: new Date(bulletin.bulletinDate) },
      update: {},
    });
  }
  return { ...r, bulletinDate: bulletin.bulletinDate };
}
