// Product catalog for the shipping checklist.
// Categories 1 & 2 REQUIRE serial numbers when quantity > 0.

export const CATEGORIES = [
  {
    id: "cat1",
    name: "Wallbox e Daze",
    subtitle: "Colonnine di ricarica",
    requiresSerial: true,
    products: [
      "Wallbox 7,4 kW - cavo 5 mt",
      "Wallbox 22 kW - cavo 5 mt",
      "Wallbox 22 kW - cavo 7 mt",
      "Daze Duo 44 kW",
    ],
  },
  {
    id: "cat2",
    name: "Meter e Misuratori",
    subtitle: "Contatori di energia",
    requiresSerial: true,
    products: ["Meter Monofase", "Meter Trifase", "Meter Daze"],
  },
  {
    id: "cat3",
    name: "Accessori e Supporti",
    subtitle: "Portacavi e stand (no seriali)",
    requiresSerial: false,
    products: [
      "Portacavo Pro Wallbox",
      "Portacavo Daze",
      "Stand Wallbox Single",
      "Stand Wallbox Dual",
      "Stand Daze Single",
    ],
  },
];

export const buildInitialState = () => {
  const state = {};
  CATEGORIES.forEach((cat) => {
    cat.products.forEach((name) => {
      state[`${cat.id}::${name}`] = { quantity: 0, serials: [] };
    });
  });
  return state;
};
