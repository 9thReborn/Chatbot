"use strict";

const MENU = Object.freeze([
  {
    name: "Jollof Rice",
    options: [
      { name: "Regular", price: 250000 },
      { name: "Large", price: 350000 },
    ],
  },
  {
    name: "Fried Rice",
    options: [
      { name: "Regular", price: 250000 },
      { name: "Large", price: 350000 },
    ],
  },
  {
    name: "Chicken",
    options: [
      { name: "Fried", price: 200000 },
      { name: "Grilled", price: 220000 },
      { name: "Peppered", price: 230000 },
    ],
  },
  {
    name: "Pounded Yam & Egusi",
    options: [
      { name: "With beef", price: 300000 },
      { name: "With goat meat", price: 350000 },
      { name: "With fish", price: 380000 },
    ],
  },
  {
    name: "Small Chops Platter",
    options: [{ name: "Standard", price: 400000 }],
  },
  {
    name: "Drinks",
    options: [
      { name: "Chapman", price: 150000 },
      { name: "Zobo", price: 100000 },
      { name: "Bottled water", price: 50000 },
    ],
  },
]);

function formatNaira(kobo) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

module.exports = { MENU, formatNaira };
