export interface SampleDocument {
  id: string;
  title: string;
  expectedHs6Hint?: string;
  text: string;
}

export const SAMPLE_DOCUMENTS: SampleDocument[] = [
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
];
