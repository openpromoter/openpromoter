import { expect, test } from "vitest";
import { safePreview } from "@/server/email";

test("the stored email copy keeps no link or token", () => {
  const out = safePreview(
    "<a href=\"https://app.x/reset?token=SECRET123\">Reset</a><form action='https://app.x/u/SECRET789'></form>" +
      "<p>or open https://app.x/r/abcdefghijklmnopqrstuvwxyz012345?t=SECRET456 now</p>" +
      '<img src="https://app.x/logo.png">',
  );
  expect(out).not.toMatch(/SECRET|abcdefghijklmnop/);
  expect(out).toContain('<a href="#">Reset</a>');
  expect(out).toContain("https://app.x/r/…");
  // images still load in the preview
  expect(out).toContain('src="https://app.x/logo.png"');
});
