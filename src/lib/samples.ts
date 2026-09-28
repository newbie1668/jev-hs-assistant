export interface SampleDocument {
  id: string;
  title: string;
  expectedHs6Hint?: string;
  /** Multi-line documents: expected HS6 per goods line, in order. */
  expectedLines?: string[];
  text: string;
}

export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    id: "mixed-invoice",
    title: "Commercial invoice — 4-line mixed consignment",
    expectedLines: ["847130", "090121", "610910", "900691"],
    text: `COMMERCIAL INVOICE
Seller: Harbour Trade Supplies Ltd
Buyer: Contoso Retail GmbH
Invoice No: INV-2026-9120
Mode: Air
Description: Portable automatic data processing machines (14-inch business laptops) Qty 20 COUNTRY OF ORIGIN: TW UNIT VALUE: 780.00
Description: Roasted coffee, not decaffeinated, 1 kg retail bags Qty 400 COUNTRY OF ORIGIN: BR UNIT VALUE: 14.50
Description: Men's T-shirts, knitted, of cotton, crew neck Qty 1,500 COUNTRY OF ORIGIN: BD UNIT VALUE: 3.20
Description: Fujifilm X-T2 40M/130FT Underwater housing kit Qty 12 COUNTRY OF ORIGIN: HK HARMONISED CODE: HS#85171200 UNIT VALUE: 389.99
Net weight: 612 kg`,
  },
  {
    id: "laptop",
    title: "Commercial invoice — portable computers",
    expectedHs6Hint: "847130",
    text: `COMMERCIAL INVOICE
Seller: Northwind Electronics Ltd
Buyer: Contoso Retail GmbH
Invoice No: INV-2026-4412
Description of goods: Portable automatic data processing machines, weighing not more than 10 kg, consisting of at least a central processing unit, a keyboard and a display — 50 units of 14-inch business laptops (ADP machines).
HS hint from supplier (unverified): chapter 84
Net weight: 62 kg
Country of origin: TW`,
  },
  {
    id: "coffee",
    title: "Packing list — roasted coffee",
    expectedHs6Hint: "090121",
    text: `PACKING LIST
Shipment: PL-7781
Contents: Roasted coffee, not decaffeinated, in 1 kg retail bags.
Quantity: 1,200 bags
Marks: ARABICA ROAST / NOT DECAFFEINATED
Goods are roasted coffee beans for retail sale, not raw green coffee.
Gross weight: 1,280 kg`,
  },
  {
    id: "cotton-tees",
    title: "BOL excerpt — cotton T-shirts",
    expectedHs6Hint: "610910",
    text: `BILL OF LADING — excerpt
Commodity: Men's T-shirts, knitted or crocheted, of cotton, short sleeve, crew neck.
Style: basic blank tees for screen printing.
Composition: 100% cotton jersey
Quantity: 5,000 pcs
Not woven shirts; knitted cotton garments.`,
  },
  {
    id: "underwater-housing",
    title: "Commercial invoice — camera underwater housing",
    expectedHs6Hint: "900691",
    text: `COMMERCIAL INVOICE
Seller: Pacific Dive Optics Ltd
Buyer: Contoso Photo Retail
Invoice No: INV-2026-8801
Fujifilm X-T2 40M/130FT Underwater housing kit Qty 1 COUNTRY OF ORIGIN: Hong Kong HARMONISED CODE: HS#85171200 UNIT VALUE: 389.99
Net weight: 1.4 kg`,
  },
];
