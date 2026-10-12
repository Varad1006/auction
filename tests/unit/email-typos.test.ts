import { describe, expect, it } from "vitest";
import { hasImpossibleDomain, suggestEmail } from "@/lib/email-typos";

describe("email typo suggestions", () => {
  it.each([
    ["rohan@gmial.com", "rohan@gmail.com"],
    ["rohan@gamil.com", "rohan@gmail.com"],
    ["rohan@gmal.com", "rohan@gmail.com"],
    ["rohan@gnail.com", "rohan@gmail.com"],
    ["rohan@gmaill.com", "rohan@gmail.com"],
    ["rohan@gmail.con", "rohan@gmail.com"],
    ["rohan@gmail.cmo", "rohan@gmail.com"],
    ["rohan@gmail.co", "rohan@gmail.com"],
    ["rohan@gmail.co.in", "rohan@gmail.com"],
    ["rohan@gmail..com", "rohan@gmail.com"],
    ["rohan@yahooo.com", "rohan@yahoo.com"],
    ["rohan@yaho.co.in", "rohan@yahoo.co.in"],
    ["rohan@hotmial.com", "rohan@hotmail.com"],
    ["rohan@outlok.com", "rohan@outlook.com"],
    ["rohan@icould.com", "rohan@icloud.com"],
    ["rohan@rediffmal.com", "rohan@rediffmail.com"],
    ["rohan@company.con", "rohan@company.com"],
  ])("%s -> %s", (typed, expected) => {
    expect(suggestEmail(typed)).toBe(expected);
  });

  it.each(["rohan@gmail.com", "rohan@yahoo.co.in", "rohan@outlook.in", "rohan@infosys.com", "rohan@iitb.ac.in", "rohan@mail.com", "rohan@me.com", "nope"])(
    "leaves %s alone",
    (email) => {
      expect(suggestEmail(email)).toBeNull();
    },
  );

  it("only blocks endings that can never be real", () => {
    expect(hasImpossibleDomain("rohan@gmail.con")).toBe(true);
    expect(hasImpossibleDomain("rohan@gmail.co")).toBe(false); // .co is a real ending
    expect(hasImpossibleDomain("rohan@gmial.com")).toBe(false);
  });
});
