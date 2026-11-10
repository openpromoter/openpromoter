import { describe, expect, it } from "vitest";
import { moneyAcross, otherOwed } from "@/server/ledger";

const bal = (currency: string, approved: number) => ({
  partnerId: "p",
  currency,
  approved,
  pending: 0,
  held: 0,
  paid: 0,
});

describe("balances in several currencies", () => {
  it("shows the program currency first, even at zero, then other non-zero ones", () => {
    expect(moneyAcross([], "usd")).toBe("$0.00");
    expect(
      moneyAcross(
        [
          { currency: "eur", n: 4500 },
          { currency: "usd", n: 12000 },
          { currency: "gbp", n: 0 },
        ],
        "usd",
      ),
    ).toBe("$120.00 + €45.00");
    expect(moneyAcross([{ currency: "usd", n: -500 }], "usd")).toBe("−$5.00");
  });
  it("lists only other currencies that are owed", () => {
    expect(otherOwed([bal("usd", 100)], "usd")).toBeUndefined();
    expect(otherOwed([bal("usd", 100), bal("eur", 4500), bal("gbp", 0)], "usd")).toBe("€45.00");
  });
});
