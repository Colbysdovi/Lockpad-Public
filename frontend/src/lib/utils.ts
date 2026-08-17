import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Join class names, with Tailwind conflicts resolved by LAST-one-wins.
//
// clsx flattens the conditionals ("a", cond && "b", {c: cond}); tailwind-merge then
// removes earlier classes that the later ones override, so a component can define a
// default like `px-3` and a caller can pass `px-6` and simply win, instead of both
// landing in the class list and leaving the winner up to CSS source order.
//
// This is why nearly every component here takes a `className` prop and merges it
// last — it is what makes them overridable without forking.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
