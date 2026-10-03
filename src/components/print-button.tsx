"use client";

import { Printer } from "lucide-react";
import { Button } from "./ui";

export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="size-4" /> Yazdır / PDF kaydet
    </Button>
  );
}
