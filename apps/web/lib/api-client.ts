// Thin client for talking to @food-finder/api. Per-module functions get added
// here as those modules land, e.g.:
//   export function search(query: string) { ... }              // Module 1
//   export function getRecentSearches() { ... }                // Module 4
//   export function createCheckoutSession() { ... }            // Module 2
//
// const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
