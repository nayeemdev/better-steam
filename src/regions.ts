export interface Region {
  code: string;
  name: string;
  steamCountry: string;
  currency: string;
}

export interface Currency {
  code: string;
  symbol: string;
  decimals: number;
}

export const REGIONS: Region[] = [
  { code: "US", name: "United States", steamCountry: "us", currency: "USD" },
  { code: "GB", name: "United Kingdom", steamCountry: "gb", currency: "GBP" },
  { code: "EU", name: "Europe", steamCountry: "de", currency: "EUR" },
  { code: "AU", name: "Australia", steamCountry: "au", currency: "AUD" },
  { code: "CA", name: "Canada", steamCountry: "ca", currency: "CAD" },
  { code: "NZ", name: "New Zealand", steamCountry: "nz", currency: "NZD" },
  { code: "JP", name: "Japan", steamCountry: "jp", currency: "JPY" },
  { code: "IN", name: "India", steamCountry: "in", currency: "INR" },
  { code: "BR", name: "Brazil", steamCountry: "br", currency: "BRL" },
  { code: "SG", name: "Singapore", steamCountry: "sg", currency: "SGD" },
];

export const DEFAULT_REGION = "US";

export const CURRENCIES: Currency[] = [
  { code: "USD", symbol: "US$", decimals: 2 },
  { code: "EUR", symbol: "€", decimals: 2 },
  { code: "GBP", symbol: "£", decimals: 2 },
  { code: "AUD", symbol: "A$", decimals: 2 },
  { code: "CAD", symbol: "C$", decimals: 2 },
  { code: "NZD", symbol: "NZ$", decimals: 2 },
  { code: "JPY", symbol: "¥", decimals: 0 },
  { code: "INR", symbol: "₹", decimals: 0 },
  { code: "BRL", symbol: "R$", decimals: 2 },
  { code: "SGD", symbol: "S$", decimals: 2 },
  { code: "BDT", symbol: "৳", decimals: 0 },
  { code: "PKR", symbol: "Rs", decimals: 0 },
  { code: "CNY", symbol: "CN¥", decimals: 2 },
  { code: "KRW", symbol: "₩", decimals: 0 },
  { code: "MXN", symbol: "MX$", decimals: 2 },
  { code: "ZAR", symbol: "R", decimals: 2 },
];

const EURO_COUNTRIES = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];

const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", AU: "AUD", CA: "CAD", NZ: "NZD", JP: "JPY", IN: "INR", BR: "BRL", SG: "SGD",
  BD: "BDT", PK: "PKR", CN: "CNY", KR: "KRW", MX: "MXN", ZA: "ZAR",
  ...Object.fromEntries(EURO_COUNTRIES.map(c => [c, "EUR"])),
};

export function currencyForCountry(country: string | undefined): string {
  return (country && COUNTRY_CURRENCY[country.toUpperCase()]) || "USD";
}

export function findRegion(code: string | null): Region {
  return REGIONS.find(r => r.code === code) ?? REGIONS.find(r => r.code === DEFAULT_REGION)!;
}
