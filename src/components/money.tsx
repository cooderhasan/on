import { formatMoneyParts, type MoneyInput } from "@/lib/money";
import { cn } from "@/lib/cn";

/** Paraşüt tarzı tutar: 3.800<small>,00₺</small>. `unitPrice`: birim fiyat — 4 haneye kadar gösterilir. */
export function Money({ value, currency = "TRY", className, unitPrice }: { value: MoneyInput; currency?: string; className?: string; unitPrice?: boolean }) {
  const p = formatMoneyParts(value, currency, unitPrice ? 4 : 2);
  return (
    <span className={cn("money whitespace-nowrap", className)}>
      {p.sign}
      {p.int}
      <span className="kurus">
        ,{p.frac}
        {p.symbol}
      </span>
    </span>
  );
}
