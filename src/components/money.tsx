import { formatMoneyParts, type MoneyInput } from "@/lib/money";
import { cn } from "@/lib/cn";

/** Paraşüt tarzı tutar: 3.800<small>,00₺</small> */
export function Money({ value, currency = "TRY", className }: { value: MoneyInput; currency?: string; className?: string }) {
  const p = formatMoneyParts(value, currency);
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
