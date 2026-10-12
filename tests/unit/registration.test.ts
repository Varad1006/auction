import { describe, expect, it } from "vitest";
import { parseUpi, upiLink } from "@/lib/registration";

describe("UPI payment links", () => {
  it("reads the UPI ID and name from app-generated QR payloads", () => {
    expect(parseUpi("upi://pay?pa=someone.12@axl&pn=Some%20One&mc=0000&mode=02&purpose=00")).toEqual({
      upiId: "someone.12@axl",
      name: "Some One",
    });
    expect(parseUpi("upi://pay?pa=a.b@okicici&pn=A%20B&aid=xyz")).toEqual({ upiId: "a.b@okicici", name: "A B" });
  });

  it("rejects anything that isn't a UPI payment link", () => {
    expect(parseUpi("https://evil.example/pay?pa=x@y")).toBeNull();
    expect(parseUpi("upi://pay?pn=No%20ID")).toBeNull();
    expect(parseUpi("upi://pay?pa=not-an-id")).toBeNull();
    expect(parseUpi("hello")).toBeNull();
  });

  it("builds a link for a typed-in UPI ID that reads back the same", () => {
    const link = upiLink(" team.fund@ybl ", "PPL Fund");
    expect(link).toBe("upi://pay?pa=team.fund@ybl&pn=PPL%20Fund&cu=INR");
    expect(parseUpi(link)).toEqual({ upiId: "team.fund@ybl", name: "PPL Fund" });
  });
});
