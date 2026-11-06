"use client";

import { Button } from "@openpromoter/ui";
import { Printer } from "@openpromoter/ui/icons";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer /> Print or save as PDF
    </Button>
  );
}
