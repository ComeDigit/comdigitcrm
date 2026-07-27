import { describe, expect, it } from "vitest";
import { csvField, csvRow, csvDocument, slugifyForFilename } from "../src/lib/csv";

describe("csvField", () => {
  it("passes plain values through unquoted", () => {
    expect(csvField("Black Friday")).toBe("Black Friday");
    expect(csvField(42)).toBe("42");
    expect(csvField(3.5)).toBe("3.5");
  });
  it("quotes and escapes a field containing a comma — the exact bug a raw CSV builder would hit on a campaign name like this", () => {
    expect(csvField("Black Friday, 2026")).toBe('"Black Friday, 2026"');
  });
  it("quotes and doubles embedded quotes", () => {
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
  });
  it("quotes a field containing a newline", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
  it("leaves an empty string as an empty (unquoted) field", () => {
    expect(csvField("")).toBe("");
  });
  it("neutralizes a leading formula-trigger character with an apostrophe (CSV/formula injection — CWE-1236)", () => {
    // A contact literally named this is valid input today (contactSchema
    // only checks length) — must not execute as a formula when the
    // exported CSV is opened in Excel/Sheets.
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("+1 (555) 000-0000")).toBe("'+1 (555) 000-0000");
    expect(csvField("-100")).toBe("'-100");
    expect(csvField("@mention")).toBe("'@mention");
  });
  it("combines the formula guard with RFC 4180 quoting when the field also needs escaping", () => {
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
  });
  it("does not touch a field that merely contains (not starts with) a trigger character", () => {
    expect(csvField("Revenue = Spend x ROAS")).toBe("Revenue = Spend x ROAS");
  });
});

describe("csvRow", () => {
  it("joins fields with commas, escaping only where needed", () => {
    expect(csvRow(["Campaign A", 100, "spend, revenue"])).toBe('Campaign A,100,"spend, revenue"');
  });
});

describe("csvDocument", () => {
  it("joins rows with CRLF and ends with a trailing CRLF", () => {
    const doc = csvDocument(["a,b", "c,d"]);
    expect(doc).toBe("a,b\r\nc,d\r\n");
  });
  it("a single row still gets a trailing CRLF", () => {
    expect(csvDocument(["header"])).toBe("header\r\n");
  });
});

describe("slugifyForFilename", () => {
  it("lowercases and hyphenates arbitrary display text", () => {
    expect(slugifyForFilename("Evo Labs / Client Co.")).toBe("evo-labs-client-co");
  });
  it("trims leading/trailing hyphens produced by leading/trailing punctuation", () => {
    expect(slugifyForFilename("  !!Weird Name!!  ")).toBe("weird-name");
  });
  it("falls back to a safe default for input with no alphanumeric characters", () => {
    expect(slugifyForFilename("***")).toBe("export");
    expect(slugifyForFilename("")).toBe("export");
  });
});
