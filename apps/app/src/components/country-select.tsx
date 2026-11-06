"use client";

import { Select } from "@openpromoter/ui";
import { useEffect, useState } from "react";

// Intl also names groups (EU, UN), test codes and reserved areas. None are countries a partner lives in.
const SKIP = new Set("EU EZ UN QO ZZ XA XB AC CP DG EA IC TA".split(" "));

/** Every ISO region the browser can name, sorted by name. Built in the browser, so no list ships in the bundle. */
function countries(): [string, string][] {
  const dn = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  const out: [string, string][] = [];
  for (let a = 65; a < 91; a++)
    for (let b = 65; b < 91; b++) {
      const code = String.fromCharCode(a, b);
      // a retired code (DD East Germany, SU, UK...) canonicalizes to its successor: keep only the current one
      const current = Intl.getCanonicalLocales(`und-${code}`)[0] === `und-${code}`;
      const name = SKIP.has(code) || !current ? undefined : dn.of(code);
      if (name && name !== code) out.push([code, name]);
    }
  return out.sort((x, y) => x[1].localeCompare(y[1]));
}

/** A country picker that posts the 2-letter code. With no value it preselects the visitor's region. */
export function CountrySelect({
  id,
  name = "country",
  defaultValue,
  required,
}: {
  id: string;
  name?: string;
  defaultValue?: string | null;
  required?: boolean;
}) {
  const [list, setList] = useState<[string, string][]>([]);
  const [value, setValue] = useState(defaultValue?.toUpperCase() ?? "");
  useEffect(() => {
    setList(countries());
    if (!defaultValue) setValue(new Intl.Locale(navigator.language).maximize().region ?? "");
  }, [defaultValue]);
  return (
    <Select id={id} name={name} value={value} onValueChange={setValue} required={required}>
      <option value="">Choose a country</option>
      {list.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </Select>
  );
}
