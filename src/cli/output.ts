export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printList(items: string[]): void {
  for (const item of items) console.log(item);
}

export function printError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.message);
    if (process.env.HERMES_DEBUG) console.error(error.stack);
  } else {
    console.error(String(error));
  }
}
