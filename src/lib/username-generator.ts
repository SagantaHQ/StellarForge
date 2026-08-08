import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator";
import { customAlphabet } from "nanoid";

/**
 * Generate a unique, human-friendly username.
 *
 * Format: adjective-color-animal-<4char nano>
 * Example: brave-blue-tiger-a8Kp
 *
 * The nanoid suffix ensures practical uniqueness without database loops.
 * Still check the database for collisions as a safety net.
 */

const nanoid4 = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4);

export function generateUsername(): string {
  const name = uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    length: 3,
    separator: "-",
    style: "lowerCase",
  });
  return `${name}-${nanoid4()}`;
}

/**
 * Generate a username and ensure it's unique by checking the database.
 * If the generated name is taken, append a longer suffix.
 */
export async function generateUniqueUsername(
  checkExists: (username: string) => Promise<boolean>
): Promise<string> {
  let username = generateUsername();
  let attempts = 0;

  while (await checkExists(username)) {
    attempts++;
    if (attempts > 5) {
      // Fallback: add a longer nanoid suffix
      const nanoid6 = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);
      username = `${username.split("-").slice(0, 3).join("-")}-${nanoid6()}`;
    } else {
      username = generateUsername();
    }
  }

  return username;
}
