import { describe, expect, it } from "vitest";
import { parseUpi, registrationFields, typingMobile, upiLink } from "@/lib/registration";

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

describe("registration field rules", () => {
  const valid = {
    full_name: "  Rohan   Patil ",
    email: "Rohan@Example.com",
    phone: "98765 43210",
    flat_number: " b-1203 ",
    age: "29",
    gender: "men",
    role: "Batter",
    batting_style: "Right-hand bat",
    bowling_style: "Don't bowl",
    tshirt_size: "L",
    availability: "Sat 21 Nov",
    declaration: "yes",
  };
  const parse = (over: Record<string, string>) => registrationFields.safeParse({ ...valid, ...over });
  const message = (over: Record<string, string>) => {
    const r = parse(over);
    return r.success ? null : r.error.issues[0]?.message;
  };

  it("tidies valid answers", () => {
    const r = parse({});
    expect(r.success && r.data).toMatchObject({
      full_name: "Rohan Patil",
      email: "rohan@example.com",
      phone: "9876543210",
      flat_number: "B-1203",
      age: 29,
    });
  });

  it("accepts mobile numbers with +91, 91 or 0 in front", () => {
    for (const phone of ["+91 98765 43210", "+91-9876543210", "919876543210", "09876543210"]) {
      const r = parse({ phone });
      expect(r.success && r.data.phone).toBe("9876543210");
    }
  });

  it("allows only 10-digit mobile numbers", () => {
    expect(message({ phone: "98765 4321" })).toBe("Mobile number must be exactly 10 digits");
    expect(message({ phone: "98765432101" })).toBe("Mobile number must be exactly 10 digits");
    expect(message({ phone: "1234567890" })).toBe("Mobile numbers start with 6, 7, 8 or 9");
    expect(message({ phone: "" })).toBe("Enter your mobile number");
  });

  it("caps typing at 10 digits", () => {
    expect(typingMobile("98765 432109")).toBe("9876543210");
    expect(typingMobile("+91 98765 43210")).toBe("9876543210");
    expect(typingMobile("abc")).toBe("");
  });

  it("rejects digits in names, odd flat numbers and non-numeric ages", () => {
    expect(message({ full_name: "R0han" })).toBe("Use letters only in your name");
    expect(message({ full_name: "Anne-Marie D'Souza" })).toBeNull();
    expect(message({ flat_number: "#12" })).toBe("Use letters, numbers, - or / (e.g. B-1203)");
    expect(message({ flat_number: "C/404" })).toBeNull();
    expect(message({ age: "29.5" })).toBe("Enter your age in years");
    expect(message({ age: "150" })).toBe("Enter a valid age");
  });
});
